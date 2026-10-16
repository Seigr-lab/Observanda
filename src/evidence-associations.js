import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {EvidenceCorrections} from './evidence-corrections.js';

// Each record owns its association. The immutable original and its acquisition
// history remain shared, so reusing a disk image never copies its bytes or moves
// it away from the record where it was first acquired.
function associationId(recordId,ref){
 const bytes=createHash('sha256').update(JSON.stringify(['observanda-evidence-association-v1',recordId,ref.id,ref.revision])).digest().subarray(0,16);
 // Native research identifiers use this UUID-shaped format, including stable
 // derived identities. The hash is an idempotency key, not a random credential.
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export async function associateOriginal(materials,command){
 return materials.workspace.withLock(()=>associateOriginalLocked(materials,command));
}
// The caller owns the workspace transaction, allowing a reviewed batch and its
// progress receipt to commit together.
export async function associateOriginalLocked(materials,{recordId,ref}){
 if(ref?.kind!=='artifact')throw new AppError('MATERIAL_INVALID');
  await materials.assertOwner(recordId);
  const {doc}=await materials.artifact(ref),source={kind:'artifact',id:doc.id,revision:ref.revision};
  if(doc.recordId===recordId){if(await new EvidenceCorrections(materials).isRetired(doc.id))throw new AppError('MATERIAL_CHANGED');return source;}
  const id=associationId(recordId,source),previous=await materials.current(id);
  if(await new EvidenceCorrections(materials).isRetired(id))throw new AppError('MATERIAL_CHANGED');
  if(previous){
   const retained=await materials.read(previous);
   if(retained.kind!=='artifact'||retained.recordId!==recordId||retained.content.inputs?.length!==1||
    retained.content.inputs[0].id!==source.id||retained.content.inputs[0].revision!==source.revision||
    retained.content.originalId!==(doc.content.originalId??doc.id)||retained.content.sha256!==doc.content.sha256)
    throw new AppError('MATERIAL_CHANGED');
   return {kind:previous.kind,id:previous.id,revision:previous.revision};
  }
  const {name,size,sha256,storageId,provenance,acquisition,sourcePath,sourcePurpose}=doc.content;
  return materials.commit({kind:'artifact',id,recordId,title:doc.title,content:{name,size,sha256,
   ...(storageId?{storageId}:{}),...(sourcePath?{sourcePath}:{}),...(sourcePurpose?{sourcePurpose}:{}),originalId:doc.content.originalId??doc.id,provenance,acquisition,inputs:[source]}});
}
