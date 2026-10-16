import {assertProjectPresent} from './project-relocation-directory.js';
import {publicationSourceMedia} from './publication-source-media.js';
import {publicationSourceSections} from './publication-source-sections.js';
import {publicationSourcePages} from './publication-source-pages.js';
import {publicationSourcePage} from './publication-source-page.js';
import {publicationSourceHost} from './publication-source-host.js';
import {AppError} from './errors.js';
import {revisionId} from './web/revision-model.js';
import {researchId} from './web/research-reference.js';
import {LabBookDirectory} from './lab-book-directory.js';
import {projectCollectionReader} from './project-collection-reader.js';
import {WebsiteResearch} from './website-research.js';

// One request owns source credentials; a saved website owns only namespace
// references and consent. The registry resolves each namespace when it is used.
export async function publicationSourceReader(application,client,{workspaceId,scope=null,labBookId=null,signal,check=async()=>{}}){
 const {registry,directory}=await publicationSourceHost(application,{workspaceId,scope,labBookId});
 const reader=projectCollectionReader(application,client,check);
 return {
  host:{workspaceId,projectId:scope,labBookId,projectNamespaceId:scope?directory.value.projects.find(project=>project.projectId===scope).namespaceId:null},
  async use(sourceId,snapshotId,consume,{prepare}={}){
   if(!researchId(sourceId)||snapshotId!==undefined&&!revisionId(snapshotId))throw new AppError('INVALID');signal?.throwIfAborted();
   assertProjectPresent(directory.value,{namespaceId:sourceId});
   const entry=directory.value.projects.find(project=>project.namespaceId===sourceId)??(sourceId!==registry.workspaceId?await new LabBookDirectory(registry).locate(sourceId):null);
   if(!entry&&sourceId!==registry.workspaceId)throw new AppError('NOT_FOUND');
   const target={workspaceId:sourceId,projectId:entry?.projectId??null,labBookId:entry?.labBookId??null};
   const value=await reader.use(target,snapshotId,(store,snapshot,pinned)=>consume(store,snapshot,{...pinned,owner:target,projectNamespaceId:entry?directory.value.projects.find(project=>project.projectId===entry.projectId)?.namespaceId:null}),{prepare});
   signal?.throwIfAborted();return {owner:target,value};
  },
  async verify(){await reader.verify();if((await registry.read()).revision!==directory.revision)throw new AppError('RECORD_QUERY_CURSOR');signal?.throwIfAborted();},
  close:()=>reader.close()
 };
}

// Publication selectors read one explicit namespace. Locating a book neither
// opens its siblings nor borrows their credentials or publication choices.
export async function projectPublicationSource(application,client,command,{scope=null,labBookId=null,signal,check=async()=>{}}={}){
 if(!command||Object.keys(command).sort().join()!=='operation,query,sourceId,workspaceId'||!researchId(command.workspaceId)||!researchId(command.sourceId)||!['head','summary','content','record','sections','media','pages','page-sections','source-media'].includes(command.operation)||!command.query||typeof command.query!=='object'||Array.isArray(command.query))throw new AppError('INVALID');
 const {workspaceId,sourceId,operation,query}=command;
 if(operation==='head'?(Object.keys(query).some(key=>key!=='snapshotId')||query.snapshotId!==undefined&&!revisionId(query.snapshotId)):query.workspaceId!==sourceId||!(['pages','source-media'].includes(operation)&&query.snapshotId===null)&&!revisionId(query.snapshotId))throw new AppError('INVALID');
 const reader=await publicationSourceReader(application,client,{workspaceId,scope,labBookId,signal,check});
 try{
  const result=await reader.use(sourceId,query.snapshotId??undefined,async(store,snapshot,pinned)=>{
   if(operation==='source-media')return publicationSourceMedia(store,snapshot,pinned,reader.host,query,{signal});
   if(operation==='page-sections')return publicationSourceSections(store,snapshot,pinned,reader.host,query,{signal});
   if(operation==='pages')return publicationSourcePages(store,snapshot,pinned,reader.host,query,{signal});
   if(operation==='head'){
    const metadata=snapshot.metadata;
    return {workspaceId:sourceId,snapshotId:pinned.snapshotId,title:metadata.title,projects:metadata.projects.map(({id,title,parentId,share})=>({id,title,parentId:parentId??null,share})),notebooks:metadata.notebooks.map(({id,projectId,title})=>({id,projectId,title}))};
   }
   const value=await new WebsiteResearch({storageKind:async()=>'catalogue',catalogue:fn=>fn(store)}).run(operation,query,{signal});
   return operation==='record'?{...value,page:publicationSourcePage(reader.host,{...pinned.owner,projectNamespaceId:pinned.projectNamespaceId},snapshot.metadata,value.record)}:value;
  });
  await reader.verify();return result;
 }finally{await reader.close();}
}

// The host is the job-owned storage instance, whose key outlives its HTTP reply.
export function publicationSourceFactory(application,client,storage,{scope=null,labBookId=null,check=async()=>{}}={}){
 return async({signal}={})=>{
  await check();signal?.throwIfAborted();const {metadata}=await storage.outline();
  return publicationSourceReader(application,client,{workspaceId:metadata.id,scope,labBookId,signal,check});
 };
}
