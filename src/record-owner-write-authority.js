// Domain headers identify record-owned metadata. Shared immutable parts are
// protected through their owning header; no unrelated owner's body is loaded.
import {assertRecordOwnerWritable,assertRecordOwnerTransferAuthority} from './record-owner-transfer-state.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const parse=value=>{if(value===null||value===undefined)return null;if(typeof value.text!=='string')return value;try{return JSON.parse(value.text);}catch{throw new AppError('CATALOGUE_DAMAGED');}};
async function owners(store,id,stored){
 const value=parse(stored);if(!value)return [];
 if(/^record-draft-(?:review|edit|recovery)/.test(id)||/^metadata:\.observanda\/(?:drafts|draft-list|record-draft-transfers|record-draft-blocks)(?:[/.])/.test(id)){
  const {recordOwnerDraftMetadataRecords}=await import('./record-owner-drafts.js');return await recordOwnerDraftMetadataRecords(store,id,stored)??[];
 }
 let match;
 if((match=/^metadata:\.observanda\/(?:run-readiness\/(?:records|completed|receipts)|materials\/records)\/([a-f0-9-]{36})(?:[/.])/.exec(id)))return [match[1]];
 if(/^metadata:\.observanda\/materials\/(?:objects|imports|drafts|intakes|associations|corrections)\//.test(id)){
  const direct=value.recordId??value.command?.recordId;if(researchId(direct))return [direct];
  if((match=/^metadata:\.observanda\/materials\/(imports|drafts|intakes)\/([a-f0-9-]{36})\//.exec(id))){
   const header={imports:'session',drafts:'draft',intakes:'batch'}[match[1]],owner=parse(await store.object('metadata:.observanda/materials/'+match[1]+'/'+match[2]+'/'+header+'.json'));return owner?[owner.recordId??owner.command?.recordId].filter(researchId):[];
  }
  if((match=/^metadata:\.observanda\/materials\/(?:drafts|intakes|associations|corrections)\/(?:by-record|records|reuse)\/([a-f0-9-]{36})(?:[/.\-])/.exec(id)))return [match[1]];
 }
 if(id.startsWith('metadata:.observanda/materials/index/')){
  if(researchId(value.recordId))return [value.recordId];
  if(researchId(value.id)){const head=parse(await store.object('metadata:.observanda/materials/objects/'+value.id+'/head.json'));if(head?.recordId)return [head.recordId];}
  if((match=/^metadata:\.observanda\/materials\/index\/(?:heads|pending|segments)\/([a-f0-9-]{36})\//.exec(id)))return [match[1]];
 }
 if(/^metadata:\.observanda\/jobs\/[a-f0-9-]{36}\.json$/.test(id)&&researchId(value.scope)&&['evidence.finalize','evidence.batch','dataset.prepare','analysis.compare','figure.calculate','intake.stage','intake.apply'].includes(value.type))return [value.scope];
 if(id.startsWith('metadata:.observanda/intake/')&&researchId(value.manifest?.recordId))return [value.manifest.recordId];
 if(id.startsWith('record-history-restore:')&&researchId(value.recordId))return [value.recordId];
 return [];
}
export async function assertRecordOwnerObjectWritable(store,id,previous,value){
 if(/^record-owner-(?:resource|resource-claim|reclaim):/.test(id)){const {assertRecordOwnerResourceMutation}=await import('./record-owner-resources.js');assertRecordOwnerResourceMutation(store);return;}
 if(/^record-owner-(?:draft-origin|draft-original|draft-review|draft-edit|draft-head|drafts|revision-prior|revision-copy):/.test(id)){assertRecordOwnerTransferAuthority(store);return;}
 if(!/^(?:record-draft-|record-history-restore:|metadata:\.observanda\/(?:materials|drafts|draft-list|record-draft-|run-readiness|jobs|intake))/.test(id))return;
 for(const recordId of new Set([...await owners(store,id,previous),...await owners(store,id,value)]))await assertRecordOwnerWritable(store,recordId);
}
export async function assertRecordOwnerRowsWritable(store,before,after){
 const old=new Map(before.map(row=>[row.id,row])),next=new Map(after.map(row=>[row.id,row]));
 for(const id of new Set([...old.keys(),...next.keys()])){const left=old.get(id),right=next.get(id);if(left&&right&&left.revision===right.revision&&left.notebookId===right.notebookId)continue;await assertRecordOwnerWritable(store,id);}
}
