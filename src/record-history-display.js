import {withRecordDocument} from './record-document.js';
import {validateRecordDocument} from './record-document-validation.js';
import {historicalRecordValue,recordRevision} from './research.js';
import {AppError} from './errors.js';

// History stores a small display receipt, not a duplicate of the record. Verify
// that receipt against the immutable original without reconstructing its body.
export async function retainedRecordDisplay(store,id,revision,metadata,{signal}={}){
 if(metadata.formatVersion!==21){
  const record=historicalRecordValue(metadata,await store.record(id,revision));
  return {revision:recordRevision(record),title:record.title,status:record.status,updatedAt:record.updatedAt};
 }
 return withRecordDocument(store,id,revision,async document=>{
  const encoded=await document.encoding({signal});if(encoded.revision!==revision)throw new AppError('CATALOGUE_DAMAGED');
  const header=await validateRecordDocument(document,metadata,{signal});
  return {revision:encoded.contentRevision,title:header.title,status:header.status,updatedAt:header.updatedAt};
 });
}
