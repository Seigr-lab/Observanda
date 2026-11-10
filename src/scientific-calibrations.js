import {AppError} from './errors.js';
import {exact,text} from './modules/validation.js';
import {researchId} from './web/research-reference.js';
import {revisionId,revisionText} from './web/revision-model.js';
import {materialReference,materialReferenceKey,validMaterialReference} from './web/material-reference.js';
import {validCalibrationCoverage,validCalibrationReview} from './web/measurement-calibration.js';

const tool='Observanda calibration coverage',directory='.observanda/materials/index/calibrations';
const invalid=()=>{throw new AppError('MATERIAL_INVALID');};
const damaged=()=>{throw new AppError('MATERIAL_MISSING');};
export const isScientificCalibration=doc=>doc?.kind==='analysis'&&doc.content?.tool===tool;

function certificate(doc){
 const value=doc.content;
 if(!isScientificCalibration(doc)||!exact(value,['tool','version','coverage','inputs'])||value.version!==1||!validCalibrationCoverage(value.coverage)||
  !Array.isArray(value.inputs)||value.inputs.length!==1||!validMaterialReference(value.inputs[0]))damaged();
 return {coverage:value.coverage,evidence:value.inputs[0]};
}

export async function indexScientificCalibration(workspace,doc){
 if(!isScientificCalibration(doc))return;
 certificate(doc);
 const file=directory+'/'+doc.id+'.json',pointer=JSON.stringify({id:doc.id,recordId:doc.recordId});
 const existing=await workspace.readMetadata(file,2048);
 if(existing===null)await workspace.writeMetadata(file,pointer);
 else if(existing!==pointer)damaged();
}

async function inspect(materials,ref,{signal}={}){
 if(!validMaterialReference(ref))invalid();
 signal?.throwIfAborted();await materials.assertReferenceWorkspace(ref);
 // An ordinary record or file has no typed calibration interval. Its
 // existing evidence remains referenceable without loading its contents.
 if(ref.kind!=='analysis')return {coverage:null};
 const raw=await materials.workspace.readMetadata(directory+'/'+ref.id+'.json',2048);
 if(raw===null)return {coverage:null};
 let pointer;try{pointer=JSON.parse(raw);}catch{damaged();}
 if(!exact(pointer,['id','recordId'])||pointer.id!==ref.id||!researchId(pointer.recordId))damaged();
 const head=await materials.current(ref.id);
 if(!head)throw new AppError('NOT_FOUND');
 if(head.kind!=='analysis'||head.recordId!==pointer.recordId)damaged();
 await materials.assertOwner(head.recordId);
 const doc=await materials.read(ref);
 if(doc.recordId!==head.recordId)damaged();
 return {recordId:doc.recordId,title:doc.title,...certificate(doc)};
}

export async function scientificCalibrationRequest(materials,operation,data,{signal,check=async()=>{}}={}){
 signal?.throwIfAborted();await check();
 if(operation==='calibration-inspect'){
  if(!exact(data,['ref']))invalid();
  return materials.workspace.catalogue(()=>inspect(materials,data.ref,{signal}));
 }
 if(operation!=='calibration-save'||!exact(data,['recordId','id','expectedRevision','title','evidence','coverage'])||
  !researchId(data.recordId)||!researchId(data.id)||(data.expectedRevision!==null&&!revisionId(data.expectedRevision))||
  !text(data.title,300,true)||data.title.trim()!==data.title||!validMaterialReference(data.evidence)||data.evidence.id===data.id||!validCalibrationCoverage(data.coverage))invalid();
 return materials.workspace.withLock(async()=>{
  await check();await materials.assertOwner(data.recordId,{write:true});
  if(data.expectedRevision!==null){
   const old=await inspect(materials,{kind:'analysis',id:data.id,revision:data.expectedRevision},{signal});
   if(!old.coverage||old.recordId!==data.recordId)invalid();
  }
  const namespace=(await materials.workspace.outline()).metadata.id,evidence=materialReference({...data.evidence,workspaceId:data.evidence.workspaceId??namespace});
  await materials.checkReference(evidence,{signal});await check();
  const ref=await materials.commit({kind:'analysis',recordId:data.recordId,id:data.id,expectedRevision:data.expectedRevision,title:data.title,content:{tool,version:1,coverage:data.coverage,inputs:[evidence]}});
  return {ref:materialReference({...ref,workspaceId:namespace}),coverage:data.coverage,title:data.title,recordId:data.recordId,evidence};
 });
}

export async function verifyCalibrationReview(materials,quantity,{signal,cache}={}){
 const review=quantity?.calibrationReview;
 if(!review)return;
 const ref=quantity.calibration;
 if(!validCalibrationReview(review,ref))invalid();
 if(!ref)return;
 const key=materialReferenceKey(ref);
 let expected=cache?.get(key);
 if(expected===undefined){
  expected=(await inspect(materials,ref,{signal})).coverage;
  if(cache){if(cache.size>=16)cache.delete(cache.keys().next().value);cache.set(key,expected);}
 }
 if(revisionText(expected)!==revisionText(review.coverage))invalid();
}
