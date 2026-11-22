import {withRecordDocument} from './record-document.js';
import {validateRecordDocument} from './record-document-validation.js';
import {AppError} from './errors.js';

// History stores a small display receipt, not a duplicate of the record. Verify
// that receipt against the immutable original without reconstructing its body.
export async function retainedRecordDisplay(store,id,revision,metadata,{signal}={}){
 return withRecordDocument(store,id,revision,async document=>{
  const encoded=await document.encoding({signal});if(encoded.revision!==revision)throw new AppError('CATALOGUE_DAMAGED');
  const header=await validateRecordDocument(document,metadata,{signal});
  return {revision:encoded.contentRevision,title:header.title,status:header.status,updatedAt:header.updatedAt};
 });
}
