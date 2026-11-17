import {createComparisonSourceAccess} from './comparison-source-access.js';
import {publicationSourceHost} from './publication-source-host.js';
import {AppError} from './errors.js';
import {revisionId} from './web/revision-model.js';
import {researchId} from './web/research-reference.js';
import {LabBookDirectory} from './lab-book-directory.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {projectCollectionReader} from './project-collection-reader.js';

// One request owns source credentials; a saved website owns only namespace
// references and consent. The registry resolves each namespace when it is used.
export async function publicationSourceReader(application,client,{workspaceId,scope=null,labBookId=null,signal,check=async()=>{}}){
 const {registry,directory}=await publicationSourceHost(application,{workspaceId,scope,labBookId});
 const reader=projectCollectionReader(application,client,check),host=scope?await registry.state(scope):null;
 if(scope&&(host.state!=='active'||host.revision!==directory.revision))throw new AppError('RECORD_QUERY_CURSOR');
 return {
  host:{workspaceId,projectId:scope,labBookId,projectNamespaceId:host?.entry?.namespaceId??null},
  async projectOwners(after){
   if(scope||labBookId)throw new AppError('ACCESS_DENIED');
   await check();signal?.throwIfAborted();
   return registry.inspect(async view=>{
    if(view.revision!==directory.revision)throw new AppError('RECORD_QUERY_CURSOR');
    const page=await view.page({index:'active',after,limit:32,signal});
    return {items:page.items.map(({entry})=>({projectId:entry.projectId,namespaceId:entry.namespaceId})),next:page.next};
   });
  },
  async bookOwners(projectId,namespaceId,{after,revision}){
   if(scope||labBookId)throw new AppError('ACCESS_DENIED');
   const project=await registry.state(projectId);
   if(project.revision!==directory.revision||project.state!=='active'||project.entry.namespaceId!==namespaceId)throw new AppError('RECORD_QUERY_CURSOR');
   return reader.useStorage({workspaceId:namespaceId,projectId,labBookId:null},async storage=>{
    const page=await new LabBookRegistry(storage).list({after,revision,limit:32});
    return {...page,items:page.items.map(({namespaceId})=>({namespaceId}))};
   });
  },
  async use(sourceId,snapshotId,consume,{prepare}={}){
   if(!researchId(sourceId)||snapshotId!==undefined&&!revisionId(snapshotId))throw new AppError('INVALID');signal?.throwIfAborted();
   const selected=await registry.state(sourceId,{index:'namespace'});if(selected.revision!==directory.revision)throw new AppError('RECORD_QUERY_CURSOR');registry.assertState(selected.state?selected:null);
   const entry=selected.state==='active'?selected.entry:sourceId!==registry.workspaceId?await new LabBookDirectory(registry).locate(sourceId):null;
   const parent=entry?await registry.state(entry.projectId):null;if(parent&&(parent.revision!==directory.revision||parent.state!=='active'))throw new AppError('RECORD_QUERY_CURSOR');
   if(!entry&&sourceId!==registry.workspaceId)throw new AppError('NOT_FOUND');
   const target={workspaceId:sourceId,projectId:entry?.projectId??null,labBookId:entry?.labBookId??null};
   const value=await reader.use(target,snapshotId,(store,snapshot,pinned)=>consume(store,snapshot,{...pinned,owner:target,projectNamespaceId:parent?.entry?.namespaceId??null}),{prepare});
   signal?.throwIfAborted();return {owner:target,value};
  },
  async verify(){await reader.verify();if(await registry.version()!==directory.revision)throw new AppError('RECORD_QUERY_CURSOR');signal?.throwIfAborted();},
  close:()=>reader.close()
 };
}

// The host is the job-owned storage instance, whose key outlives its HTTP reply.
export function publicationSourceFactory(application,client,storage,{scope=null,labBookId=null,check=async()=>{}}={}){
 const sourceReader=async({signal}={})=>{
  await check();signal?.throwIfAborted();const {metadata}=await storage.outline();
  return publicationSourceReader(application,client,{workspaceId:metadata.id,scope,labBookId,signal,check});
 };
 // Dependency access is independent of the edition's selected public content.
 // It retains the requesting client without borrowing the active source reader.
 sourceReader.materialAccess=({workspace=storage,signal}={})=>createComparisonSourceAccess(application,client,{workspace,check,signal});
 return sourceReader;
}
