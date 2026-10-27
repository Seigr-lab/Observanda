import {withMaterialTraversal} from './material-traversal.js';
import {recordRevision} from './research.js';
import {materialRecordSummary} from './material-record-summary.js';
import {digest} from './storage-format.js';
import {createHash} from 'node:crypto';
import {withJobDiagnosticContext} from './job-diagnostics.js';
// Dependency review reads retained manifests and current heads, never table rows
// or original artifact bytes. The fingerprint includes unchanged heads as well.
export async function analysisDependencyState(materials,sources,{recordHead,signal,inputs,onItem,onCheck}={}){
 if(inputs)return routedDependencyState(inputs,sources,{recordHead,signal,onItem,onCheck});
 return materials.readSnapshot(async store=>{
  const snapshot=store?await store.snapshot():null;
  const current=async r=>{if(r.kind!=='record')return (await materials.current(r.id))?.revision??null;if(recordHead)return recordHead(r.id);if(store)return (await materialRecordSummary(store,await store.member(snapshot,r.id)))?.revision??null;try{return recordRevision((await materials.owner(r.id)).entries.find(record=>record.id===r.id));}catch(e){if(e.code!=='MATERIAL_INVALID')throw e;return null;}};
  const hash=createHash('sha256'),items=onItem?null:[];let count=0;
  return withMaterialTraversal(async traversal=>{
   for await(const source of sources)await withJobDiagnosticContext({operation:'check-analysis-inputs',recordId:source.recordId,resultId:source.resultId,figureId:source.figureId},async()=>{let changed=0;const sample=[];await traversal.reset();hash.update(JSON.stringify(source));
    await traversal.walk([source.analysis],async(r,enqueue)=>{signal?.throwIfAborted();const external=await materials.externalReference(r);if(external){hash.update(JSON.stringify([external.workspaceId,external.kind,external.id,external.revision,null]));changed++;if(sample.length<20)sample.push({...external,label:external.id,current:null});return;}const now=await current(r);hash.update(JSON.stringify([r.kind,r.id,r.revision,now]));if(now!==r.revision){changed++;if(sample.length<20)sample.push({...r,label:r.label??(r.kind==='record'?r.id:(await materials.read(r)).title),current:now});}if(r.kind!=='record')for await(const nested of materials.index.iterInputs(r))await enqueue(nested);});
    if(changed){const item={id:digest(JSON.stringify(source)),recordId:source.recordId,resultId:source.resultId??null,figureId:source.figureId??null,assessmentId:source.assessmentId??null,label:source.label??'',analysis:source.analysis,changed,sample};count++;if(onItem)await onItem(item);else items.push(item);}
    await onCheck?.(source);
   });
   return {fingerprint:hash.digest('hex'),...(onItem?{count}:{items})};
  },{signal});
 });
}

// Addressed traversal never initializes a foreign discovery index. Omitted
// nested namespaces are resolved by the containing retained input's reader.
async function routedDependencyState(inputs,sources,{recordHead,signal,onItem,onCheck}){
 const hash=createHash('sha256'),items=onItem?null:[];let count=0;
 return withMaterialTraversal(async traversal=>{
  for await(const source of sources)await withJobDiagnosticContext({operation:'check-analysis-inputs',recordId:source.recordId,resultId:source.resultId,figureId:source.figureId},async()=>{let changed=0;const sample=[];await traversal.reset();hash.update(JSON.stringify(source));
   await traversal.walk([source.analysis],async(r,enqueue)=>{
    signal?.throwIfAborted();const current=await inputs.current(r,{recordHead}),now=current.revision;hash.update(JSON.stringify(current.local?[r.kind,r.id,r.revision,now]:[current.workspaceId,r.kind,r.id,r.revision,now]));
    if(now!==r.revision){changed++;if(sample.length<20)sample.push({...r,label:r.label??(r.kind==='record'?r.id:(await inputs.read(r)).title),current:now});}
    if(r.kind!=='record')for await(const nested of inputs.inputs(r))await enqueue(nested);
   });
   if(changed){const item={id:digest(JSON.stringify(source)),recordId:source.recordId,resultId:source.resultId??null,figureId:source.figureId??null,assessmentId:source.assessmentId??null,label:source.label??'',analysis:source.analysis,changed,sample};count++;if(onItem)await onItem(item);else items.push(item);}
   await onCheck?.(source);
  });
  await inputs.verify();return {fingerprint:hash.digest('hex'),...(onItem?{count}:{items})};
 },{signal});
}
