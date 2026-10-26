import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {materialReference,validMaterialReference} from './web/material-reference.js';
import {recordRevision} from './research.js';
import {materialRecordSummary} from './material-record-summary.js';
import {withMaterialTraversal} from './material-traversal.js';
import {withDatabaseRequest} from './database-request-context.js';
import {operationStage,operationAdvance} from './operation-progress.js';

// Browsing never waits for this recursive check. Its bounded selection belongs
// to one record; all recursive work remains cancellable and snapshot-scoped.
export async function reviewMaterialDependencies(materials,recordId,{refs,signal,dependencyReview}={}){
 if(!researchId(recordId)||!Array.isArray(refs)||refs.length>50||refs.some(ref=>!validMaterialReference(ref)||ref.kind==='record'||Object.keys(ref).some(key=>!['kind','id','revision'].includes(key)))||new Set(refs.map(ref=>ref.id)).size!==refs.length)throw new AppError('MATERIAL_INVALID');
 return withDatabaseRequest(signal,async()=>{
 signal?.throwIfAborted();await materials.assertOwner(recordId);signal?.throwIfAborted();
 if(!refs.length)return {items:[]};
 return materials.readSnapshot(async store=>{
  const book=store?null:await materials.owner(recordId),snapshot=store?await store.snapshot():null;
  const recordHeads=new Map(book?.entries.map(record=>[record.id,recordRevision(record)])??[]),heads=new Map();
  const current=async ref=>{
   signal?.throwIfAborted();
   if(ref.kind!=='record'){
    if(!heads.has(ref.id)){if(heads.size===64)heads.delete(heads.keys().next().value);heads.set(ref.id,(await materials.current(ref.id))?.revision??null);}
    return heads.get(ref.id);
   }
   if(!recordHeads.has(ref.id)){
    if(recordHeads.size===64)recordHeads.delete(recordHeads.keys().next().value);
    if(store){const member=await store.member(snapshot,ref.id);recordHeads.set(ref.id,(await materialRecordSummary(store,member))?.revision??null);}
    else{try{recordHeads.set(ref.id,recordRevision((await materials.owner(ref.id)).entries.find(record=>record.id===ref.id)));}catch(error){if(error.code!=='MATERIAL_INVALID')throw error;recordHeads.set(ref.id,null);}}
   }
   return recordHeads.get(ref.id);
  };
  return operationStage('reviewing-evidence-dependencies',{total:refs.length},()=>withMaterialTraversal(async traversal=>{
   const items=[];
   for(const ref of refs){
    signal?.throwIfAborted();const head=await materials.current(ref.id);
    if(head&&head.recordId!==recordId)throw new AppError('MATERIAL_INVALID');
    if(!head||head.kind!==ref.kind||head.revision!==ref.revision){items.push({...materialReference(ref),changed:[],changedCount:null,dependencyStatus:'stale'});operationAdvance();continue;}
    const status=await operationStage('checking-evidence-references',{unit:'references'},async()=>{
     const reviewed=await dependencyReview?.(head);signal?.throwIfAborted();if(reviewed)return reviewed;
     const changed=[];let changedCount=0;await traversal.reset();
     await traversal.walk(materials.references(head),async(input,enqueue)=>{
      signal?.throwIfAborted();const external=await materials.externalReference(input);
      if(external){changedCount++;if(changed.length<20)changed.push({...external,current:null});operationAdvance();return;}
      const now=await current(input);if(now!==input.revision){changedCount++;if(changed.length<20)changed.push({...input,current:now});}
      if(input.kind!=='record')for await(const nested of materials.index.iterInputs(input)){signal?.throwIfAborted();await enqueue(nested);}
      operationAdvance();
     });
     return {changed,changedCount,dependencyStatus:'checked'};
    });
    signal?.throwIfAborted();items.push({...materialReference(ref),...status});operationAdvance();
   }
   return {items};
  },{signal}));
 });
 });
}
