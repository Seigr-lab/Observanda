// Evidence headers and their record-scoped discovery entries have explicit
// owners. Shared index markers are derived; immutable parts are handled by the
// source-change coordinator only when newly added, never when altered/deleted.
import {EvidenceCorrections} from './evidence-corrections.js';
import {materialBatch} from './material-visibility.js';
import {ResearchMaterials,materialRef} from './research-materials.js';
import {retainedRecordValue} from './retained-record-envelope.js';
import {researchId} from './web/research-reference.js';
import {digest} from './storage-format.js';
import {revisionText} from './web/revision-model.js';
import {AppError} from './errors.js';
const root='metadata:.observanda/materials/',derived=Object.freeze({kind:'derived'});
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export {materialPartKey as newEvidencePart} from './material-part-identity.js';
export function projectSourceEvidenceOwner(store,record,{signal}={}){
 const materials=new ResearchMaterials(store.workspace);
 async function json(key){signal?.throwIfAborted();const stored=await store.object(key);if(typeof stored?.text!=='string'||Buffer.byteLength(stored.text)>16*1024*1024)damaged();try{return JSON.parse(stored.text);}catch{damaged();}}
 async function head(id){
  const value=await materials.current(id,{includeStaged:true});if(!value||!researchId(value.recordId))damaged();
  const doc=await materials.readStored(value);if(doc.recordId!==value.recordId)damaged();
  if(value.stagedBatch!==undefined){const batch=await materialBatch(store.workspace,value.stagedBatch);if(value.kind!=='artifact'||batch.command.recordId!==value.recordId||doc.content.intakeId!==batch.id)damaged();}
  return value;
 }
 async function item(id){const value=await head(id),item=await json(root+'index/items/'+id+'.json');if(item.id!==value.id||item.recordId!==value.recordId||item.kind!==value.kind||item.stagedBatch!==value.stagedBatch)damaged();return item;}
 return async id=>{
  if(!id.startsWith(root))return null;
  return store.workspace.inspectCatalogue(store,async()=>{
   const tail=id.slice(root.length),parts=tail.split('/');let match;
   if((match=/^objects\/([^/]+)\/(head|[a-f0-9]{64})\.json$/.exec(tail))){
    if(!researchId(match[1]))damaged();const value=await json(id);
    if(value.id!==match[1]||!researchId(value.recordId))damaged();
    if(match[2]==='head')await head(match[1]);
    else if(value.format!==1||!materialRef({kind:value.kind,id:value.id,revision:match[2]})||digest(revisionText(value))!==match[2])damaged();
    return record(value.recordId);
   }
   if((match=/^records\/([^/]+)\/[a-f0-9]{64}\.json$/.exec(tail))){await retainedRecordValue(store,id);return record(match[1]);}
   if((match=/^imports\/([^/]+)\/session\.json$/.exec(tail))){const value=await materials.importState(match[1],{raw:true});if(value.id!==match[1])damaged();return record(value.recordId);}
   if((match=/^drafts\/([^/]+)\/(?:draft\.json|(?:members|accepted)\/(?:inputs|outputs)\/(?:[a-f0-9]{64}|0|[1-9][0-9]*)\.json)$/.exec(tail))){if(!researchId(match[1]))damaged();const value=await materials.drafts.read(match[1]);return record(value.command.recordId);}
   if((match=/^intakes\/([^/]+)\/(?:batch\.json|accepted\/(?:0|[1-9][0-9]*)\.json|(?:paths|fingerprints)\/[a-f0-9]{64}\.json|prepared\/[^/]+\.json)$/.exec(tail))){if(!researchId(match[1]))damaged();const value=await materials.intakes.read(match[1]);return record(value.command.recordId);}
   if((match=/^intakes\/([^/]+)\/attached\/([^/]+)\.json$/.exec(tail))){
    if(!researchId(match[1])||!researchId(match[2]))damaged();const batch=await materials.intakes.read(match[1]),session=await materials.importState(match[2],{raw:true});
    if(session.batchId!==batch.id||session.recordId!==batch.command.recordId)damaged();const receipt=await materials.intakes.finalization.receipt(batch,session),doc=await materials.readStored(receipt.ref);
    if(doc.recordId!==session.recordId||doc.content.intakeId!==batch.id)damaged();return record(session.recordId);
   }
   if((match=/^associations\/([^/]+)\.json$/.exec(tail))){if(!researchId(match[1]))damaged();return record((await materials.associations.read(match[1])).recordId);}
   if((match=/^(?:drafts|intakes|associations)\/by-record\/([a-f0-9-]{36})(?:-order\.json|(?:-order)?\/[^/]+\.json)$/.exec(tail)))return record(match[1]);
   if((match=/^intakes\/reuse\/([^/]+)\/[a-f0-9]{64}\.json$/.exec(tail)))return record(match[1]);
   if((match=/^corrections\/events\/([^/]+)\.json$/.exec(tail)))return record((await new EvidenceCorrections(materials).event(match[1])).command.recordId);
   if((match=/^corrections\/receipts\/([a-f0-9]{64})\.json$/.exec(tail))){const receipt=await json(id),event=await new EvidenceCorrections(materials).event(receipt.id);if(event.review!==match[1])damaged();return record(event.command.recordId);}
   if((match=/^corrections\/state\/([^/]+)\.json$/.exec(tail))){if(!researchId(match[1]))damaged();const corrections=new EvidenceCorrections(materials),state=await corrections.state(match[1]);if(!state)damaged();const event=await corrections.event(state.lastEvent);if(event.command.ref.id!==match[1])damaged();return record(event.command.recordId);}
   if((match=/^corrections\/records\/([a-f0-9-]{36})(?:-order\.json|(?:-order)?\/[^/]+\.json)$/.exec(tail)))return record(match[1]);
   if(tail==='index/state.json'){const value=await json(id);if(value.version!==1||!Number.isSafeInteger(value.generation)||value.generation<0)damaged();return derived;}
   if((match=/^index\/items\/([^/]+)\.json$/.exec(tail))){return record((await item(match[1])).recordId);}
   if((match=/^index\/dependencies\/([^/]+)\/([a-f0-9]{64})\.json$/.exec(tail))){const item=await json(id);if(item.id!==match[1]||item.revision!==match[2]||!materialRef(item))damaged();return record((await materials.readStored(item)).recordId);}
   if((match=/^index\/batches\/([^/]+)\.json$/.exec(tail)))return record((await materials.index.segments.read(match[1])).recordId);
   if((match=/^index\/retired\/([^/]+)\.json$/.exec(tail))){
    const item=await materials.index.segments.retired(match[1]);if(!item)damaged();const segment=await materials.index.segments.read(item.stagedBatch);if(segment.recordId!==item.recordId)damaged();return record(item.recordId);
   }
   if((match=/^index\/segments\/(all|[^/]+)\/(all|artifact)-order(\.json|\/[^/]+\.json)$/.exec(tail))){
    const [,scope,bucket,suffix]=match;if(scope!=='all'&&!researchId(scope))damaged();
    if(suffix==='.json'){if((await json(id)).version!==1)damaged();return scope==='all'?derived:record(scope);}
    const pointer=await json(id),segment=await materials.index.segments.read(pointer.batchId),feed=materials.index.segments.feed(scope==='all'?null:scope,bucket==='all'?null:bucket);
    if(pointer.id!==segment.id||pointer.createdAt!==segment.createdAt||scope!=='all'&&segment.recordId!==scope||parts.at(-1)!==feed.key(pointer))damaged();return record(segment.recordId);
   }
   if((match=/^index\/(heads|pending)\/(all|[^/]+)\/(all|artifact|dataset|analysis|collection)-order(\.json|\/[^/]+\.json)$/.exec(tail))){
    const [,kind,scope,bucket,suffix]=match;if(scope!=='all'&&!researchId(scope)||kind==='pending'&&(scope==='all'||bucket!=='all'))damaged();
    if(suffix==='.json'){if((await json(id)).version!==1)damaged();return scope==='all'?derived:record(scope);}
    const pointer=await json(id),value=kind==='pending'?await materials.importState(pointer.id,{raw:true}):await item(pointer.id);
    if(scope!=='all'&&value.recordId!==scope||bucket!=='all'&&value.kind!==bucket||pointer.createdAt!==value.createdAt||parts.at(-1)!==materials.index.feed(scope==='all'?null:scope,bucket==='all'?null:bucket,kind==='pending').key(value))damaged();
    return record(value.recordId);
   }
   return null;
  });
 };
}
