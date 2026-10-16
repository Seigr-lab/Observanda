import {AppError} from './errors.js';
import {ownerSourceHost} from './owner-source-host.js';
import {projectCollectionReader} from './project-collection-reader.js';
import {LabBookDirectory} from './lab-book-directory.js';
import {readProjectDomainRegistry} from './project-domain-registry.js';
import {validTaskReference} from './web/task-prerequisite-model.js';
import {readPlanningTaskFromStore,TASK_DEPENDENCY_OWNER_LIMIT} from './planning-task-reader.js';
import {researchId} from './web/research-reference.js';


export async function planningTaskAccess(application,client,workspaceId,{scope=null,labBookId=null,check=async()=>{},signal}={}){
 await check();signal?.throwIfAborted();
 const {registry}=await ownerSourceHost(application,{workspaceId,scope,labBookId}),reader=projectCollectionReader(application,client,check),owners=new Map();let closed=false;
 const active=()=>{signal?.throwIfAborted();if(closed)throw new AppError('WORKSPACE_CHANGED');};
 async function locate(namespaceId){
  if(!researchId(namespaceId))throw new AppError('INVALID');
  if(namespaceId===registry.workspaceId)return {workspaceId:namespaceId,projectId:null,labBookId:null};
  let entry;try{entry=await registry.namespace(namespaceId);}catch(error){if(error.code!=='NOT_FOUND')throw error;entry=await new LabBookDirectory(registry).locate(namespaceId);if(!entry)throw error;}
  return {workspaceId:entry.namespaceId,projectId:entry.projectId,labBookId:entry.labBookId??null};
 }
 const sameOwner=(a,b)=>a.workspaceId===b.workspaceId&&a.projectId===b.projectId&&a.labBookId===b.labBookId;
 async function useOwner(namespaceId,consume){
  active();const owner=await locate(namespaceId),previous=owners.get(namespaceId);
  if(previous&&!sameOwner(previous,owner))throw new AppError('TASK_PREREQUISITE_CHANGED');
  if(!previous&&owners.size>=TASK_DEPENDENCY_OWNER_LIMIT)throw new AppError('TASK_DEPENDENCY_OWNER_LIMIT');
  const value=await reader.use(owner,null,async(store,_snapshot,{storage})=>{
   const domains=await readProjectDomainRegistry(store);
   if(domains?.commandVersion!==1||!domains.domains.includes('tasks'))throw new AppError('TASK_PREREQUISITE_UNSUPPORTED');
   return consume(storage,owner,{store});
  });
  owners.set(namespaceId,owner);active();return value;
 }
 return {
  workspaceId,useOwner,
  read:(reference,options)=>{if(!validTaskReference(reference))throw new AppError('INVALID');return useOwner(reference.workspaceId,async(_storage,owner,{store})=>{
   const selected=await readPlanningTaskFromStore(store,reference,options),title=options?.label?(await store.snapshot()).metadata.title:null;
   return {...selected,owner:{...owner,...(title?{[owner.labBookId?'notebookTitle':owner.projectId?'projectTitle':'workspaceTitle']:title}:{})}};
  });},
  async verify(){
   active();await reader.verify();
   for(const [id,owner] of owners){signal?.throwIfAborted();if(!sameOwner(owner,await locate(id)))throw new AppError('TASK_PREREQUISITE_CHANGED');}
   await reader.verify();
  },
  async close(){closed=true;owners.clear();await reader.close();}
 };
}
export const planningTaskAccessFactory=(application,client,options={})=>(workspaceId,{signal}={})=>planningTaskAccess(application,client,workspaceId,{...options,signal});
