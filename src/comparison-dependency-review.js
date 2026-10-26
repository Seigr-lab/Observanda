import {withComparisonInputs} from './comparison-request-inputs.js';
import {withMaterialTraversal} from './material-traversal.js';
import {safeError} from './errors.js';
import {materialReference} from './web/material-reference.js';
import {operationAdvance} from './operation-progress.js';
const unavailable=new Set(['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN','NOT_FOUND','PROJECT_DELETED','PROJECT_MOVED','LAB_BOOK_DELETED','STORAGE_MOVING','STORAGE_DELETING']);
// A retained result remains inspectable when a live dependency is unavailable.
// Each item's review owns its grants, so a failed source cannot mislabel another
// item as checked or turn the entire local evidence list into an access error.
export async function comparisonDependencyReview(materials,head,{sourceAccess,signal}={}){
 try{return await withComparisonInputs(materials,{sourceAccess,signal},async inputs=>{
  if(!inputs)return null;
  const changed=[];let changedCount=0;
  await withMaterialTraversal(async traversal=>{
   await traversal.walk([materialReference(head)],async(ref,enqueue)=>{
    signal?.throwIfAborted();const current=await inputs.head(ref);
    if(current!==ref.revision){changedCount++;if(changed.length<20)changed.push({...ref,current});}
    if(ref.kind!=='record')for await(const nested of inputs.inputs(ref)){signal?.throwIfAborted();await enqueue(nested);}operationAdvance();
   });
  },{signal});return {changed,changedCount,dependencyStatus:'checked'};
 });}catch(error){
  if(!unavailable.has(error.code))throw error;
  const safe=safeError(error);return {changed:[],changedCount:null,dependencyStatus:'unavailable',dependencyError:{code:safe.code,...(safe.projectId?{projectId:safe.projectId}:{}),...(safe.labBookId?{labBookId:safe.labBookId}:{})}};
 }
}
