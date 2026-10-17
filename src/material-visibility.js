// Staged evidence keeps canonical revision bytes unchanged. Only the owning
// intake completion makes its heads available to ordinary material readers.
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validIndexRef} from './object-index.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export async function materialBatch(workspace,id){
 if(!researchId(id))damaged();
 const raw=await workspace.readMetadata('.observanda/materials/intakes/'+id+'/batch.json',131072);
 let batch;try{batch=JSON.parse(raw);}catch{damaged();}
 if(!batch||batch.format!==1||batch.id!==id||!researchId(batch.command?.recordId)||!['open','processing','completed'].includes(batch.state))damaged();
 const value=batch.finalization;
 if(!value||value.version!==1||!Number.isSafeInteger(value.count)||value.count<0||!Number.isSafeInteger(batch.command.count)||value.count>batch.command.count||!researchId(value.segmentId)||!value.inputsIndex||value.inputsIndex.format!==1||value.inputsIndex.kind!=='references'||value.inputsIndex.count!==value.count||value.inputsIndex.chunkSize!==64||!validIndexRef(value.inputsIndex.root)||(value.inputsIndex.root?.count??0)!==Math.ceil(value.count/64))damaged();
 if(batch.state==='completed'&&(batch.result?.kind!=='collection'||batch.result.id!==id||!revisionId(batch.result.revision)||value.count!==batch.command.count))damaged();
 return batch;
}
export async function materialHeadVisible(workspace,head){
 if(!head||head.stagedBatch===undefined)return true;
 const batch=await materialBatch(workspace,head.stagedBatch);
 if(head.kind!=='artifact'||head.recordId!==batch.command.recordId)damaged();
 return batch.state==='completed';
}
