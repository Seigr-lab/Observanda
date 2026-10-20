import path from 'node:path';
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {ownerDirectorySortKey} from './owner-directory-model.js';
import {ownerSourceHost} from './owner-source-host.js';
import {ProjectSessionOwner} from './project-session-owner.js';
import {LabBookRegistry} from './lab-book-registry.js';
const normalized=value=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('en');
const title=entry=>entry.summary?.title??entry.projectId;
// Owner namespaces and project/book identities can coincide. Place a synthetic
// host row after an exact native key, so exclusion applies only to that native row.
const extraKey=(label,id)=>ownerDirectorySortKey(label,id)+'\0';
// Merge the one optional host row and omitted current book into an indexed
// window. Rank shifts are at most one in either direction; no prefix is loaded.
async function directoryWindow(view,{offset,limit,extra=null,exclude=null,signal}){
 const start=Math.max(0,offset-(extra?1:0)),window=await view.page({index:'label',offset:start,limit:limit+(extra?1:0)+(exclude?1:0),signal}),rows=[];
 for(let i=0;i<window.items.length;i++){
  const row=window.items[i];if(row.key===exclude)continue;
  const position=start+i+(extra&&extra.key<row.key?1:0)-(exclude&&exclude<row.key?1:0);
  if(position>=offset&&position<offset+limit)rows.push({position,row});
 }
 if(extra){
  const before=window.items.findIndex(row=>extra.key<row.key);let position=null;
  if(before>=0&&(before>0||start===0))position=start+before;
  else if(before<0&&start+window.items.length===window.total)position=window.total;
  if(position!==null){position-=exclude&&exclude<extra.key?1:0;if(position>=offset&&position<offset+limit)rows.push({position,row:extra});}
 }
 rows.sort((a,b)=>a.position-b.position);return {items:rows.map(value=>value.row),total:window.total+(extra?1:0)-(exclude?1:0)};
}
async function directoryMatches(view,{offset,limit,extra,exclude,needle,project,signal}){
 const items=[];let total=0,inserted=!extra;
 const add=async row=>{if(row.key===exclude)return;signal?.throwIfAborted();const value=row.value??await project(row.entry);if(!normalized([...value.ancestors,value.label].join(' ')).includes(needle))return;if(total>=offset&&items.length<limit)items.push(value);total++;};
 for await(const row of view.entries({index:'label',signal})){if(!inserted&&extra.key<row.key){await add(extra);inserted=true;}await add(row);}
 if(!inserted)await add(extra);return {items,total};
}
// Discovery reads directory indexes only. Book credentials and record databases
// are opened only for a selected project; a page never materializes its siblings.
export async function ownerSourceDirectory(application,client,command,{scope=null,labBookId=null,check=async()=>{},signal,includeHost=false}={}){
 if(!command||Object.keys(command).sort().join()!=='limit,offset,projectId,revision,search,workspaceId'||!researchId(command.workspaceId)||command.projectId!==null&&!researchId(command.projectId)||typeof command.search!=='string'||command.search.length>160||!Number.isSafeInteger(command.offset)||command.offset<0||!Number.isSafeInteger(command.limit)||command.limit<1||command.limit>50||command.revision!==null&&typeof command.revision!=='string')throw new AppError('INVALID');
 await check();signal?.throwIfAborted();const {registry,directory}=await ownerSourceHost(application,{workspaceId:command.workspaceId,scope,labBookId}),needle=normalized(command.search.trim());
 const result=await registry.inspect(async view=>{
  if(view.revision!==directory.revision)throw new AppError('CONFLICT');
  const ancestors=async entry=>(await view.ancestors(entry.projectId)).slice(1).reverse().map(title);
  async function select(source,{extra=null,exclude=null,project,bookRevision=null}){
   const revision=digest(JSON.stringify([1,command.workspaceId,directory.revision,command.projectId,bookRevision]));if(command.revision!==null&&command.revision!==revision)throw new AppError('CONFLICT');
   const options={offset:command.offset,limit:command.limit,extra,exclude,signal};let page;
   if(needle)page=await directoryMatches(source,{...options,needle,project});
   else{page=await directoryWindow(source,options);page.items=await Promise.all(page.items.map(row=>row.value??project(row.entry)));}
   return {workspaceId:command.workspaceId,projectId:command.projectId,revision,items:page.items,offset:command.offset,total:page.total};
  }
  if(command.projectId===null){
   const label=path.basename(application.workspace.root),extra=includeHost||command.workspaceId!==registry.workspaceId?{key:extraKey(label,registry.workspaceId),value:{kind:'workspace',workspaceId:registry.workspaceId,projectId:null,labBookId:null,label,ancestors:[]}}:null;
   return select(view,{extra,project:async entry=>({kind:'project',workspaceId:entry.namespaceId,projectId:entry.projectId,labBookId:null,label:title(entry),ancestors:await ancestors(entry)})});
  }
  const selected=await view.get(command.projectId),entry=selected?.state==='active'?selected.entry:null;if(!entry)throw new AppError('NOT_FOUND');
  const parents=await ancestors(entry),owner=new ProjectSessionOwner(application,client,entry.projectId,{check,recoverRenames:false});
  try{return await owner.use(async storage=>{
   signal?.throwIfAborted();const books=new LabBookRegistry(storage);let bookRevision;
   const page=await books.inspect(async current=>{
    bookRevision=current.revision;const hidden=!includeHost?await current.get(command.workspaceId,{index:'namespace'}):null,exclude=hidden?.state==='active'?ownerDirectorySortKey(hidden.entry.directory,hidden.entry.labBookId):null;
    const extra=includeHost||entry.namespaceId!==command.workspaceId?{key:extraKey(title(entry),entry.projectId),value:{kind:'content',workspaceId:entry.namespaceId,projectId:entry.projectId,labBookId:null,label:title(entry),ancestors:parents}}:null;
    return select(current,{extra,exclude,bookRevision,project:async book=>({kind:'book',workspaceId:book.namespaceId,projectId:entry.projectId,labBookId:book.labBookId,label:book.directory,ancestors:[...parents,title(entry)]})});
   });if(await books.version()!==bookRevision)throw new AppError('CONFLICT');return page;
  },{locationOnly:true});}catch(error){if(['ACCESS_LOCKED','DEVICE_UNKNOWN','ACCESS_DENIED','AUTH'].includes(error.code))error.projectId??=entry.projectId;throw error;}finally{await owner.close();}
 });
 if(await registry.version()!==directory.revision)throw new AppError('CONFLICT');await check();signal?.throwIfAborted();return result;
}
