// A replacement needs the prior identity and immutable schema, not a second
// in-memory copy of every saved narrative and figure in that record.
import {withRecordDocument,RecordDocument} from './record-document.js';
import {materialRecordSummary} from './material-record-summary.js';
import {documentRevision} from './record-document-revision.js';
import {withRecordProjectionScratch} from './record-projection-scratch.js';
import {RunReadiness} from './run-readiness.js';
import {validateAttemptDocumentChange} from './record-attempt-document.js';
export async function recordReplacementBase(store,row){
 if(!row)return null;
 const summary=await materialRecordSummary(store,row);
 return withRecordDocument(store,row.id,row.revision,async document=>{
  const result={...summary};
  for(const name of ['createdAt','updatedAt'])result[name]=(await document.field([name])).value;
  const ref=await document.reference(['template']);
  const node=ref?await document.tree.node(ref):null;
  result.templateRevision=node&&!(node.type==='inline'&&node.value===null)?await documentRevision(new RecordDocument(document.blocks,ref),{omit:['values']}):null;
  return result;
 });
}
export async function validateReplacementAttempt(store,row,record,metadata){
 if(!record.attempt&&!row?.hasAttempt)return;
 const check=previous=>withRecordProjectionScratch(previous,async scratch=>{
  const root=await scratch.tree.retain({id:record.id,...(record.attempt?{attempt:record.attempt}:{})}),document=new RecordDocument(scratch.blocks,root);
  await validateAttemptDocumentChange(store.workspace,metadata.id,previous,document,record.id);
 });
 if(row)return withRecordDocument(store,row.id,row.revision,check);
 // New records have no prior document or large retained history to read.
 const {validateAttemptChange}=await import('./attempts.js');
 await validateAttemptChange(store.workspace,metadata.id,null,record);
}
export async function replacementCompletion(store,row,record,metadata,options){
 if(record.status!=='completed')return;
 const readiness=new RunReadiness(store.workspace);
 if(!row)return readiness.completion(null,record,metadata,options);
 return withRecordDocument(store,row.id,row.revision,previous=>withRecordProjectionScratch(previous,async scratch=>{
  const root=await scratch.tree.retain(record),document=new RecordDocument(scratch.blocks,root);
  return readiness.documentCompletion(previous,document,record,metadata,options);
 }));
}
