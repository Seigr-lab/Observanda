import {AppError} from './errors.js';
import {prepareClockSynchronization,verifyClockSynchronization} from './measurement-clock-synchronization.js';
import {schemaReferences} from './web/measurement-model.js';
import {materialReferenceKey} from './web/material-reference.js';
import {revisionText} from './web/revision-model.js';
const fail=()=>{throw new AppError('MEASUREMENT_CLOCK_SYNCHRONIZATION');};
export function clockSynchronizationReferences(content){return [...new Map([content.source.ref,...content.anchors.flatMap(anchor=>[anchor.source.ref,anchor.reference.ref]),...schemaReferences(content.target)].map(ref=>[materialReferenceKey(ref),ref])).values()];}
export async function clockSynchronizationRequest(materials,operation,data,{signal}={}){
 const read=operation==='clock-synchronization-read',allowed=read?['ref']:['recordId','title','id','expectedRevision','synchronization'];if(!data||Object.keys(data).some(key=>!allowed.includes(key)))fail();signal?.throwIfAborted();
 if(read){const doc=await materials.read(data.ref);if(doc.kind!=='analysis'||doc.content.tool!=='Observanda clock synchronization')fail();await materials.assertOwner(doc.recordId);return {ref:data.ref,title:doc.title,recordId:doc.recordId,content:doc.content};}
 return materials.workspace.withLock(async()=>{await materials.assertOwner(data.recordId,{write:true});const previous=data.id&&data.expectedRevision?await materials.read({kind:'analysis',id:data.id,revision:data.expectedRevision}):null;if(previous&&(previous.recordId!==data.recordId||previous.content.tool!=='Observanda clock synchronization'))fail();const content=await prepareClockSynchronization(materials,data.synchronization,{write:fn=>fn(),signal,base:previous?.content});content.inputs=clockSynchronizationReferences(content);for(const ref of content.inputs){signal?.throwIfAborted();await materials.checkReference(ref);}signal?.throwIfAborted();return {ref:await materials.commit({kind:'analysis',recordId:data.recordId,title:data.title,id:data.id,expectedRevision:data.expectedRevision,content})};});
}
export async function verifyClockSynchronizationInputs(materials,content,options={}){
 await verifyClockSynchronization(materials,content,options);const expected=new Set(clockSynchronizationReferences(content).map(materialReferenceKey)),actual=new Set();for await(const ref of materials.references(content))actual.add(materialReferenceKey(ref));if(revisionText([...actual].sort())!==revisionText([...expected].sort()))fail();
}
