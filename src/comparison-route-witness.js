import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {validMaterialReference,materialReference} from './web/material-reference.js';
import {researchId} from './web/research-reference.js';
import {revisionText} from './web/revision-model.js';
const key=ref=>ref.workspaceId+'/'+ref.kind+'/'+ref.id;
const same=(a,b)=>revisionText(a)===revisionText(b);
const validOwner=value=>value&&Object.keys(value).sort().join()==='labBookId,projectId,workspaceId'&&researchId(value.workspaceId)&&(value.projectId===null||researchId(value.projectId))&&(value.labBookId===null||researchId(value.labBookId));
const validReference=ref=>validMaterialReference(ref)&&researchId(ref.workspaceId);
const changed=()=>{throw new AppError('WORKSPACE_CHANGED');};

// A live dependency walk may see any number of identities. Keep its exact
// routing witnesses in encrypted temporary storage, never in a growing Map.
// Only a validated command's bounded witness list may outlive this reader.
export function comparisonRouteWitness({root,changes,locate,signal}){
 let current=structuredClone(root),closed=false,tail=Promise.resolve(),opening,finish,lifetime;
 const check=()=>{signal?.throwIfAborted();if(closed)changed();};
 const storage=()=>{
  check();if(opening)return opening;
  let ready,failed;opening=new Promise((resolve,reject)=>{ready=resolve;failed=reject;});
  const released=new Promise(resolve=>{finish=resolve;});
  lifetime=withScratch(async work=>{ready(work);await released;},{signal});
  lifetime.catch(failed);return opening;
 };
 const release=async()=>{
  signal?.removeEventListener('abort',cancelled);const running=lifetime;finish?.();
  try{await running;}finally{if(lifetime===running){opening=undefined;lifetime=undefined;finish=undefined;}}
 };
 const serial=operation=>{
  const task=tail.then(async()=>{check();return operation();}).catch(async error=>{closed=true;await release().catch(()=>{});throw error;});
  tail=task.catch(()=>{});return task;
 };
 const remember=async(work,reference,owner)=>{
  const prior=await work.get(key(reference));if(prior&&!same(prior.owner,owner))changed();
  if(!prior)await work.add(key(reference),{reference:materialReference(reference),owner:structuredClone(owner)});
 };
 const cancelled=()=>{void service.close().catch(()=>{});};
 const service={
  observe:(reference,owner)=>serial(async()=>{
   if(!validReference(reference)||!validOwner(owner))throw new AppError('INVALID');
   await remember(await storage(),reference,owner);
  }),
  verify:root=>serial(async()=>{
   if(same(root,current))return;
   if(opening){const work=await opening;for await(const entry of changes(current,root)){
    check();const saved=await work.get(entry.id);if(saved&&!same(await locate(saved.reference),saved.owner))changed();
   }}
   current=structuredClone(root);
  }),
  capture:references=>serial(async()=>{
   if(!Array.isArray(references)||references.length>196||!references.every(validReference))throw new AppError('INVALID');
   const work=await storage(),result=[];
   for(const reference of references){const saved=await work.get(key(reference));if(!saved)changed();result.push({reference:materialReference(reference),owner:saved.owner});}
   return result;
  }),
  assert:captured=>serial(async()=>{
   if(!Array.isArray(captured)||captured.length>196||captured.some(value=>!value||Object.keys(value).sort().join()!=='owner,reference'||!validReference(value.reference)||!validOwner(value.owner)))throw new AppError('INVALID');
   const work=await storage();
   for(const saved of captured){check();if(!same(await locate(saved.reference),saved.owner))changed();await remember(work,saved.reference,saved.owner);}
  }),
  async close(){if(closed){await tail;await release();return;}closed=true;signal?.removeEventListener('abort',cancelled);await tail;await release();}
 };
 signal?.addEventListener('abort',cancelled,{once:true});return service;
}
