import {createHash} from 'node:crypto';
import {RecordDraftChunks} from './record-draft-chunks.js';
import {recordDraftParts} from './record-draft-parts.js';
import {DraftRecordValidation} from './record-draft-validation.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';

export async function inspectRecordDraft(chunks,{signal,part:consume,ownership=false}={}){
 const record=new DraftRecordValidation(),change={};
 for await(const part of recordDraftParts(chunks,{signal})){
  let valid;
  if(part.kind==='change'){valid=part.value===null||revisionId(part.value);change[part.name]=part.value;}
  else if(part.kind==='array')valid=record.array(part.name);
  else if(part.kind==='item')valid=record.item(part.name,part.value);
  else valid=record.field(part.name,part.value);
  if(!valid)throw new AppError('INVALID');
  await consume?.(part);
 }
 if(!record.valid()||change.baseRevision!==change.expectedRevision)throw new AppError('INVALID');
 return {base:{recordId:record.recordId,revision:change.baseRevision},title:record.title,...(ownership?{notebookId:record.notebookId}:{})};
}
// A successful inspection authenticates all transport bytes before the caller
// writes the checkpoint header or changes its recovery index.
export async function inspectTransferredDraft(workspace,id,content,options={}){
 const {signal}=options;
 const blocks=new RecordDraftChunks(workspace,id),hash=createHash('sha256');
 async function* input(){for await(const bytes of blocks.chunks(content,{signal})){hash.update(bytes);yield bytes;}}
 const inspected=await inspectRecordDraft(input(),options);
 if(hash.digest('hex')!==content.sha256)throw new AppError('CATALOGUE_DAMAGED');return inspected;
}
