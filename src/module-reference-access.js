import {moduleReferenceIncoming} from './module-reference-incoming.js';
import {projectRecordCollection} from './project-record-collection.js';
import {AppError} from './errors.js';
import {ownerSourceHost} from './owner-source-host.js';
import {ownerSourceDirectory} from './owner-source-directory.js';
import {projectCollectionReader} from './project-collection-reader.js';
import {LabBookDirectory} from './lab-book-directory.js';
import {referenceNamespaceMatches} from './research-reference-namespace.js';
import {moduleReferenceSummary,moduleReferenceQuery,validModuleReference,researchReferenceTypes} from './module-reference-query.js';
import {exact,uuid} from './modules/validation.js';
const unavailable=new Set(['NOT_FOUND','PROJECT_DELETED','PROJECT_MOVED','ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN','LAB_BOOK_DELETED']);
// The request owns these credentials. Saved links retain only stable identities;
// authorizing a target never adopts its writer or another client's grants.
export async function moduleReferenceAccess(application,client,workspaceId,{scope=null,labBookId=null,check=async()=>{},signal}={}){
 await check();signal?.throwIfAborted();const host=await ownerSourceHost(application,{workspaceId,scope,labBookId}),reader=projectCollectionReader(application,client,check);
 const {registry,directory}=host;
 async function locate(namespaceId,reference=null){
  if(!uuid(namespaceId))throw new AppError('INVALID');let entry;
  if(reference&&researchReferenceTypes.includes(reference.type)){
   try{entry=await registry.reference({workspaceId:namespaceId,kind:reference.type,id:reference.id});}catch(error){if(error.code!=='NOT_FOUND'||namespaceId!==registry.workspaceId)throw error;}
  }else if(namespaceId!==registry.workspaceId){
   try{entry=await registry.namespace(namespaceId);}catch(error){if(error.code!=='NOT_FOUND')throw error;entry=await new LabBookDirectory(registry).locate(namespaceId);if(!entry)throw error;}
  }
  return {workspaceId:entry?.namespaceId??namespaceId,projectId:entry?.projectId??null,labBookId:entry?.labBookId??null};
 }
 async function useReference(reference,consume){
  if(!validModuleReference(reference))throw new AppError('INVALID');signal?.throwIfAborted();const owner=await locate(reference.workspaceId,reference);
  return reader.use(owner,null,async(store,snapshot,{storage})=>{
   if(reference.type==='record'&&!await referenceNamespaceMatches(store,{...reference,kind:'record'}))throw new AppError('NOT_FOUND');
   const summary=await moduleReferenceSummary(store,snapshot,reference);
   return consume(storage,{...reference,workspaceId:owner.workspaceId},{store,snapshot,owner,summary});
  });
 }
 const service={
  async owners(data){
   if(data.workspaceId!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const result=await ownerSourceDirectory(application,client,data,{scope,labBookId,check,signal,includeHost:true});
   return {...result,items:result.items.map(item=>({...item,kind:item.kind==='content'?'project':item.kind==='book'?'lab-book':item.kind}))};
  },
  async query(data){
   if(data.workspaceId!==workspaceId)throw new AppError('WORKSPACE_CHANGED');const owner=await locate(data.sourceId);
   return reader.use(owner,null,async(store,snapshot)=>({...await moduleReferenceQuery(store,snapshot,data,{signal}),owner}));
  },
  async incoming(data){
   if(data?.workspaceId!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   return moduleReferenceIncoming(application.recordCollections,client,data,{visit:projectRecordCollection(application,client,check),collectionWorkspaceId:registry.workspaceId,resolveTarget:useReference,check,signal});
  },
  async labels(data){
   if(!exact(data,['workspaceId','references'])||data.workspaceId!==workspaceId||!Array.isArray(data.references)||data.references.length>25||!data.references.every(validModuleReference)||new Set(data.references.map(ref=>JSON.stringify([ref.workspaceId,ref.type,ref.id]))).size!==data.references.length)throw new AppError('INVALID');
   const items=[];for(const reference of data.references){
    try{items.push(await useReference(reference,(_storage,_canonical,{owner,summary})=>({reference,status:'available',owner,...summary})));}
    catch(error){if(!unavailable.has(error.code))throw error;items.push({reference,status:'unavailable',code:error.code});}
   }
   return {workspaceId,items};
  },
  async resolve(data){
   if(!exact(data,['workspaceId','target'])||data.workspaceId!==workspaceId)throw new AppError('INVALID');
   return useReference(data.target,(_storage,_canonical,{owner,summary})=>({workspaceId,reference:data.target,owner,type:data.target.type,id:data.target.id,...summary}));
  },
  async validate(reference){await useReference(reference,()=>true);return true;},useReference,
  async verify(){await reader.verify();if(await registry.version()!==directory.revision)throw new AppError('CONFLICT');signal?.throwIfAborted();},
  close:()=>reader.close()
 };
 return service;
}
export const moduleReferenceFactory=(application,client,options={})=>(workspaceId,{signal}={})=>moduleReferenceAccess(application,client,workspaceId,{...options,signal});
