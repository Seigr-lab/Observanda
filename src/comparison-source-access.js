import {AppError} from './errors.js';
import {projectCollectionReader} from './project-collection-reader.js';
import {LabBookDirectory} from './lab-book-directory.js';
import {referenceNamespaceMatches} from './research-reference-namespace.js';
import {validMaterialReference,materialReference} from './web/material-reference.js';
import {researchId} from './web/research-reference.js';
import {ProjectReferenceAliases} from './project-reference-aliases.js';
import {RetainedTableIndex} from './retained-table-index.js';
import {comparisonRouteWitness} from './comparison-route-witness.js';
// Each reader belongs to one initiating client. Immutable addresses are retained;
// source credentials live only in this reader and are cleared on close.
export async function createComparisonSourceAccess(application,client,{workspace=application.workspace,check=async()=>{},signal}={}){
 await check();signal?.throwIfAborted();
 const workspaceId=(await workspace.outline()).metadata.id,registry=await application.registry(),reader=projectCollectionReader(application,client,check),aliases=new RetainedTableIndex(new ProjectReferenceAliases(registry.workspace),{namespace:'nodes',allowSparseBranches:true});let closed=false;
 async function locate(reference){
  const target=reference.kind==='record'?{kind:'record',id:reference.id,workspaceId:reference.workspaceId}:reference;
  let entry;try{entry=await registry.reference(target);}catch(error){if(error.code!=='NOT_FOUND'||reference.workspaceId!==registry.workspaceId)throw error;}
  return {workspaceId:entry?.namespaceId??reference.workspaceId,projectId:entry?.projectId??null,labBookId:entry?.labBookId??null};
 }
 async function namespace(id){
  if(!researchId(id))throw new AppError('INVALID');if(id===registry.workspaceId)return {workspaceId:id,projectId:null,labBookId:null};
  let entry;try{entry=await registry.namespace(id);}catch(error){if(error.code!=='NOT_FOUND')throw error;entry=await new LabBookDirectory(registry).locate(id);if(!entry)throw error;}
  return {workspaceId:entry.namespaceId,projectId:entry.projectId,labBookId:entry.labBookId??null};
 }
 const routes=comparisonRouteWitness({root:await registry.inspect(view=>view.aliases??null),changes:(before,after)=>aliases.differences(before,after,{signal}),locate,signal});
 const active=()=>{signal?.throwIfAborted();if(closed)throw new AppError('WORKSPACE_CHANGED');};
 const service={workspaceId,
  async use(reference,consume){
   if(!validMaterialReference(reference))throw new AppError('MATERIAL_INVALID');active();
   const requested=materialReference({...reference,workspaceId:reference.workspaceId??workspaceId}),owner=await locate(requested);
   await routes.observe(requested,owner);
   return reader.use(owner,null,async(store,snapshot,{storage})=>{
    if(!await referenceNamespaceMatches(store,requested))throw new AppError('WORKSPACE_CHANGED');
    const value=await consume(storage,{...requested,workspaceId:owner.workspaceId},{owner,store,snapshot});signal?.throwIfAborted();
    return value;
   });
  },
  async selected(id,consume){active();const owner=await namespace(id);return reader.use(owner,null,(store,snapshot,{storage})=>consume(storage,{owner,store,snapshot}));},
  async verify(){
   active();await reader.verify();await routes.verify(await registry.inspect(view=>view.aliases??null));await reader.verify();
  },
  verifyGrants:()=>reader.verify(),
  captureRoutes:references=>{active();return routes.capture(references.map(ref=>materialReference({...ref,workspaceId:ref.workspaceId??workspaceId})));},
  assertRoutes:captured=>{active();return routes.assert(captured);},
  async close(){closed=true;try{await routes.close();}finally{await reader.close();}}
 };return service;
}
export const comparisonSourceFactory=(application,client,options={})=>(workspace,{signal}={})=>createComparisonSourceAccess(application,client,{...options,workspace,signal});
