import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {DATASET_TEXT_CHARS,datasetCellReference} from './dataset-cell-storage.js';
import {domainValueReference} from './measurement-domain-storage.js';

// The exact retained spelling can span many encrypted parts. Stream those
// parts once. Checking the native digest uses UTF-16 code units, including a
// surrogate pair split by the storage boundary.
export async function* datasetTextStream(materials,value,{signal}={}){
 const original=domainValueReference(value)?value.original:value;
 signal?.throwIfAborted();
 if(typeof original==='string'){
  yield original;
  return;
 }
 if(!datasetCellReference(original))throw new AppError('MATERIAL_MISSING');
 materials.sequences.validate(original.parts);
 if(original.parts.count!==Math.ceil(original.characters/DATASET_TEXT_CHARS))throw new AppError('MATERIAL_MISSING');
 const digest=createHash('sha256');
 let seen=0,pending='';
 for await(const part of materials.sequences.items(original.parts)){
  signal?.throwIfAborted();
  if(typeof part!=='string'||part.length!==Math.min(DATASET_TEXT_CHARS,original.characters-seen))throw new AppError('MATERIAL_MISSING');
  seen+=part.length;
  digest.update(Buffer.from(part,'utf16le'));
  const text=pending+part;
  pending=/[\uD800-\uDBFF]$/.test(text)?text.slice(-1):'';
  if(text.length>pending.length)yield pending?text.slice(0,-1):text;
 }
 if(seen!==original.characters||digest.digest('hex')!==original.sha256)throw new AppError('MATERIAL_MISSING');
 if(pending)yield pending;
}
