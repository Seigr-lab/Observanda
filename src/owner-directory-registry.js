// Shared bounded registry views. The old envelope is admitted only until its
// durable upgrade marker; native views never materialize the directory merely
// to locate one owner or select one window.
import {AppError} from './errors.js';
import {serialize} from './storage-format.js';
import {OwnerDirectoryAccess} from './owner-directory-access.js';
import {ownerDirectoryEntryId,ownerDirectoryKeys,ownerDirectoryRow} from './owner-directory-model.js';
const exact=(a,b)=>serialize(a)===serialize(b);
export class OwnerDirectoryRegistry{
 constructor(options){Object.assign(this,options);this.access=new OwnerDirectoryAccess(options);}
 async legacyProjects(store){if(this.kind!=='projects')return [];const metadata=store?(await store.snapshot()).metadata:(await this.storage.outline()).metadata;if(metadata.id!==this.ownerId)throw new AppError('WORKSPACE_CHANGED');return metadata.projects.map(value=>({projectId:value.id,parentId:value.parentId??null,summary:{title:value.title,description:value.description??'',kind:value.kind??'Project',templateName:value.labBookTemplate?.name??null},legacy:true}));}
 legacyView(current){
  const kind=this.kind,root=this.storage.root,namePolicy=process.platform==='win32'||process.platform==='darwin'?'folded':'exact';
  const rows=[...current.value[kind==='projects'?'projects':'books'].map(entry=>({state:'active',entry:{...entry,...(kind==='projects'?{summary:entry.summary??null}:{})}})),...(current.value.deleted??[]).map(entry=>({state:'deleted',entry})),...(current.value.relocated??[]).map(entry=>({state:'relocated',entry}))];
  const keys=row=>ownerDirectoryKeys(kind,ownerDirectoryRow(kind,row.state,row.entry,root),{namePolicy});
  const view={nameKey:name=>namePolicy==='folded'?name.normalize('NFC').toLowerCase():name,revision:current.revision,aliases:current.value.aliases??null,count:current.value[kind==='projects'?'projects':'books'].length,native:false,
   async get(id,{index='identity'}={}){return rows.find(row=>keys(row)[index]===id)??null;},
   async *entries({index='active',after=null,prefix=''}={}){for(const row of rows.filter(row=>keys(row)[index]!==undefined).sort((a,b)=>keys(a)[index]<keys(b)[index]?-1:1)){const key=keys(row)[index];if((after===null||key>after)&&key.startsWith(prefix))yield {key,...row};}},
   async page({index='active',after=null,offset=0,limit=50,prefix=''}={}){const all=await Array.fromAsync(view.entries({index,prefix})),eligible=all.filter(row=>after===null||row.key>after),items=eligible.slice(offset,offset+limit);return {items,total:all.length,next:eligible.length>offset+limit?items.at(-1)?.key??null:null};},
  };
  view.ancestors=async id=>{const legacy=await this.legacyProjects(),result=[],seen=new Set();for(let next=id;next!==null;){if(seen.has(next))throw new AppError('FORMAT');seen.add(next);const row=await view.get(next);if(row&&row.state!=='active')throw new AppError('FORMAT');const entry=row?.entry??legacy.find(value=>value.projectId===next);if(!entry)throw new AppError('NOT_FOUND');result.push(entry);next=entry.parentId;}return result;};return view;
 }
 inspect(operation,{legacy=false}={}){return this.access.read(async current=>{
  let view;if(current.legacy)view=this.legacyView(current.legacy);else{const {directory,value,revision}=current;
   view={nameKey:name=>value.namePolicy==='folded'?name.normalize('NFC').toLowerCase():name,revision,aliases:value.aliases,count:value.roots.active?.count??0,native:true,
    get:(id,options)=>directory.find(value,id,options),page:options=>directory.page(value,options),entries:options=>directory.rows(value,{index:'active',...options}),
    ancestors:async id=>directory.ancestors(value,id,{legacy:await this.legacyProjects(directory.store)})};
  }
  view.legacy=[];if(legacy)for(const entry of await this.legacyProjects(current.directory?.store))if(!await view.get(entry.projectId))view.legacy.push(entry);
  return operation(view);
 });}
 version(){return this.access.revision();}
 state(id,options){return this.inspect(async view=>({revision:view.revision,...(await view.get(id,options)??{state:null,entry:null})}));}
 async read(){return this.access.read(async current=>{
  if(current.legacy)return {value:current.legacy.value,revision:current.legacy.revision};
  const {directory,value:head,revision}=current,value=this.empty();value.version=this.kind==='projects'?7:2;value.deleted=[];value.relocated=[];if(this.kind==='projects')value.aliases=head.aliases;
  for await(const {state,entry} of directory.rows(head,{index:'identity'}))value[state==='active'?(this.kind==='projects'?'projects':'books'):state].push(entry);
  return {value,revision};
 });}
 // Lifecycle callers may still explicitly request a complete registry edit.
 // Current locate/list/create paths use inspect/apply instead; the native save
 // publishes only changed indexed rows and keeps the original revision guard.
 async change(expected,edit,{checkpoint,validate}={}){
  return this.access.write(expected,async(directory,head,revision,store)=>{
   const value=this.empty();value.version=this.kind==='projects'?7:2;value.deleted=[];value.relocated=[];if(this.kind==='projects')value.aliases=head.aliases;
   for await(const {state,entry} of directory.rows(head))value[state==='active'?(this.kind==='projects'?'projects':'books'):state].push(entry);
   const next=edit(structuredClone(value));await validate?.(value,next,store);this.validate(next);
   const old=new Map(),changed=[];for(const state of ['active','deleted','relocated'])for(const entry of value[state==='active'?(this.kind==='projects'?'projects':'books'):state])old.set(ownerDirectoryEntryId(this.kind,entry),{state,entry});
   for(const state of ['active','deleted','relocated'])for(const entry of next[state==='active'?(this.kind==='projects'?'projects':'books'):state]??[]){const id=ownerDirectoryEntryId(this.kind,entry),before=old.get(id);old.delete(id);if(!before||!exact(before,{state,entry}))changed.push({state,entry});}
   const removals=[...old.keys(),...changed.map(row=>ownerDirectoryEntryId(this.kind,row.entry))].map(id=>({id,remove:true}));let result=head;
   for(let i=0;i<removals.length;i+=128)result=await directory.apply(result,removals.slice(i,i+128),{validateRelations:false});
   for(let i=0;i<changed.length;i+=128)result=await directory.apply(result,changed.slice(i,i+128),{validateRelations:false});
   result.aliases=next.aliases??null;const saved=await directory.publish(result);return {value:next,revision:saved.revision};
  },{checkpoint});
 }
 applyBatch(expected,changes,{aliases,checkpoint,check,signal}={}){
  return this.access.write(expected,async(directory,head,revision,store)=>{
   await check?.(directory,head,store);const next=await directory.applyBatch(head,changes,{legacy:await this.legacyProjects(store),signal});if(aliases!==undefined)next.aliases=aliases;
   const saved=await directory.publish(next,{signal});return {revision:saved.revision};
  },{checkpoint});
 }
 apply(expected,changes,{aliases,checkpoint,check}={}){
  return this.access.write(expected,async(directory,head,revision,store)=>{
   await check?.(directory,head,store);const next=await directory.apply(head,changes,{legacy:await this.legacyProjects(store)});if(aliases!==undefined)next.aliases=aliases;
   const saved=await directory.publish(next);return {revision:saved.revision};
  },{checkpoint});
 }
}
