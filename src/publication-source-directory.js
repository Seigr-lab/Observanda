import path from 'node:path';
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {compareTitles,compareKey} from './web/query-order.js';
import {publicationSourceHost} from './publication-source-host.js';
import {ProjectSessionOwner} from './project-session-owner.js';
import {LabBookRegistry} from './lab-book-registry.js';
const normalized=value=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('en');
// Discovery reads owner registries only. Choosing a project lists its books;
// book credentials and record databases are opened only for a selected source.
export async function publicationSourceDirectory(application,client,command,{scope=null,labBookId=null,check=async()=>{},signal}={}){
 if(!command||Object.keys(command).sort().join()!=='limit,offset,projectId,revision,search,workspaceId'||!researchId(command.workspaceId)||command.projectId!==null&&!researchId(command.projectId)||typeof command.search!=='string'||command.search.length>160||!Number.isSafeInteger(command.offset)||command.offset<0||!Number.isSafeInteger(command.limit)||command.limit<1||command.limit>50||command.revision!==null&&typeof command.revision!=='string')throw new AppError('INVALID');
 await check();signal?.throwIfAborted();const {registry,directory}=await publicationSourceHost(application,{workspaceId:command.workspaceId,scope,labBookId});
 const projects=directory.value.projects,byId=new Map(projects.map(project=>[project.projectId,project]));
 const label=entry=>entry.summary?.title??entry.projectId;
 const ancestors=entry=>{const names=[],seen=new Set([entry.projectId]);for(let parent=byId.get(entry.parentId);parent;parent=byId.get(parent.parentId)){if(seen.has(parent.projectId))throw new AppError('FORMAT');seen.add(parent.projectId);names.unshift(label(parent));}return names;};
 let rows,bookRevision=null;
 if(command.projectId===null){
  rows=projects.map(entry=>({kind:'project',workspaceId:entry.namespaceId,projectId:entry.projectId,labBookId:null,label:label(entry),ancestors:ancestors(entry)}));
  if(command.workspaceId!==registry.workspaceId)rows.unshift({kind:'workspace',workspaceId:registry.workspaceId,projectId:null,labBookId:null,label:path.basename(application.workspace.root),ancestors:[]});
 }else{
  const entry=byId.get(command.projectId);if(!entry)throw new AppError('NOT_FOUND');
  const owner=new ProjectSessionOwner(application,client,entry.projectId,{check,recoverRenames:false});
  try{rows=await owner.use(async storage=>{
   signal?.throwIfAborted();const books=new LabBookRegistry(storage),snapshot=await books.read();bookRevision=snapshot.revision;
   const values=[{kind:'content',workspaceId:entry.namespaceId,projectId:entry.projectId,labBookId:null,label:label(entry),ancestors:ancestors(entry)},...snapshot.value.books.map(book=>({kind:'book',workspaceId:book.namespaceId,projectId:entry.projectId,labBookId:book.labBookId,label:book.directory,ancestors:[...ancestors(entry),label(entry)]}))];
   if((await books.read()).revision!==bookRevision)throw new AppError('CONFLICT');return values.filter(row=>row.workspaceId!==command.workspaceId);
  },{locationOnly:true});}catch(error){if(['ACCESS_LOCKED','DEVICE_UNKNOWN','ACCESS_DENIED','AUTH'].includes(error.code))error.projectId??=entry.projectId;throw error;}finally{await owner.close();}
 }
 const revision=digest(JSON.stringify([command.workspaceId,directory.revision,command.projectId,bookRevision]));if(command.revision!==null&&command.revision!==revision)throw new AppError('CONFLICT');
 const needle=normalized(command.search.trim()),matches=rows.filter(row=>!needle||normalized([...row.ancestors,row.label].join(' ')).includes(needle)).sort((a,b)=>compareTitles(a.label,b.label)||compareKey(a.workspaceId,b.workspaceId));
 if((await registry.read()).revision!==directory.revision)throw new AppError('CONFLICT');await check();signal?.throwIfAborted();
 return {workspaceId:command.workspaceId,projectId:command.projectId,revision,items:matches.slice(command.offset,command.offset+command.limit),offset:command.offset,total:matches.length};
}
