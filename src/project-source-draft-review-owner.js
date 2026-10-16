import {projectDraftReviewReader} from './project-draft-review-ownership.js';
import {RecordDraftRecoveryLedger} from './record-draft-recovery-ledger.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
const hash=value=>digest(serialize(value)),damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export function projectSourceDraftReviewOwner(store,inventory,record,{signal}={}){
 const source={...inventory,record:async id=>{const fact=await record(id,{required:false});return fact?{...fact,selected:fact.projectId===inventory.projectId}:null;}},read=projectDraftReviewReader(store,source,{signal});
 const owner=fact=>({kind:'project',projectId:fact.projectId});
 return async id=>{
  if(!id.startsWith('record-draft-'))return null;signal?.throwIfAborted();let match;
  if((match=/^record-draft-review:([a-f0-9]{64})$/.exec(id)))return owner(await read('plan',match[1]));
  if((match=/^record-draft-edit:([a-f0-9]{64})$/.exec(id)))return owner(await read('edit',match[1]));
  if((match=/^record-draft-edit-head:([a-f0-9]{64})$/.exec(id))){const head=await store.object(id),fact=await read('edit',head?.revision);if(match[1]!==hash(fact.value.owner)||hash(head.owner)!==hash(fact.value.owner))damaged();return owner(fact);}
  if((match=/^record-draft-edit-operation:([a-f0-9-]{36})$/.exec(id))){const receipt=await store.object(id),fact=await read('edit',receipt?.revision);if(match[1]!==fact.value.operationId)damaged();return owner(fact);}
  if((match=/^record-draft-recovery:([a-f0-9-]{36}):([a-f0-9]{64})$/.exec(id))){
   const ledger=new RecordDraftRecoveryLedger(store),value=await ledger.read(match[1],match[2]);if(!value||id!==ledger.id(value.draftId,value.draftRevision)||value.workspaceId!==inventory.namespaceId)damaged();const projectIds=new Set();let count=0;
   for await(const entry of ledger.index.entries({root:value.completed})){
    signal?.throwIfAborted();const position=Number(entry.id);if(!Number.isSafeInteger(position)||position<0||position>=value.count||entry.id!==String(position).padStart(16,'0'))damaged();
    const plan=await ledger.receipt(value.draftId,value.draftRevision,position);if(!plan)damaged();projectIds.add((await read('plan',plan.id)).projectId);count++;
   }
   if(!count||count!==value.completed?.count)damaged();return {kind:'projects',projectIds:[...projectIds]};
  }
  return null;
 };
}
