// Validate immutable retained record identities independently of conversion.
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {recordRevision} from './research.js';
import {retainedRecordPointer} from './retained-record-documents.js';
import {AppError} from './errors.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export const retainedRecordPrefix='metadata:.observanda/materials/records/';
export function retainedRecordIdentity(key){
 const parts=key.slice(retainedRecordPrefix.length).split('/');
 if(!key.startsWith(retainedRecordPrefix)||parts.length!==2||!researchId(parts[0])||! /^[a-f0-9]{64}\.json$/.test(parts[1]))damaged();
 return {kind:'record',id:parts[0],revision:parts[1].slice(0,-5)};
}
export async function retainedRecordValue(store,key){
 const ref=retainedRecordIdentity(key),stored=await store.object(key);let value;
 if(typeof stored?.text!=='string'||Buffer.byteLength(stored.text)>16*1024*1024)damaged();
 try{value=JSON.parse(stored.text);}catch{damaged();}
 if(retainedRecordPointer(value)){
  if(Object.keys(value).sort().join()!=='format,id,revision,snapshotId,storageRevision,version'||value.version!==1||value.id!==ref.id||value.revision!==ref.revision||![value.snapshotId,value.storageRevision].every(revisionId))damaged();
 }else if(value?.id!==ref.id||!researchId(value.notebookId)||recordRevision(value)!==ref.revision)damaged();
 return {ref,value};
}
