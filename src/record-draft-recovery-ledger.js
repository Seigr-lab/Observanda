// A legacy checkpoint may contain several records. Each saved selection has a
// durable receipt; remove the checkpoint only after all selections are saved.
import {ObjectIndex,validIndexRef} from './object-index.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
const prefix='record-draft-recovery:',key=position=>String(position).padStart(16,'0');
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export class RecordDraftRecoveryLedger{
 constructor(store){this.store=store;this.index=new ObjectIndex(store,{namespace:'record-draft-recovery-index:',immutable:true});}
 id(draftId,revision){return prefix+draftId+':'+revision;}
 validate(value){
  if(!value||value.format!==1||![value.workspaceId,value.draftId].every(researchId)||!revisionId(value.draftRevision)||!Number.isSafeInteger(value.count)||value.count<1||!validIndexRef(value.completed)||(value.completed?.count??0)>value.count)fail();
 }
 async read(draftId,revision){const value=await this.store.object(this.id(draftId,revision));if(value)this.validate(value);return value;}
 async receipt(draftId,revision,position){
  const value=await this.read(draftId,revision);if(!value)return null;
  const entry=await this.index.find({root:value.completed},key(position));if(!entry)return null;
  const plan=await this.store.object('record-draft-review:'+entry.revision);
  if(!plan||plan.id!==entry.revision||plan.format!==3||plan.draftId!==draftId||plan.draftRevision!==revision||plan.sourcePosition!==position||plan.sourceCount!==value.count||plan.workspaceId!==value.workspaceId||!plan.saved)fail();
  return plan;
 }
 async finish(plan){
  const value=await this.read(plan.draftId,plan.draftRevision)??{format:1,workspaceId:plan.workspaceId,draftId:plan.draftId,draftRevision:plan.draftRevision,count:plan.sourceCount,completed:null};
  if(value.count!==plan.sourceCount||value.workspaceId!==plan.workspaceId)fail();
  const prior=await this.index.find({root:value.completed},key(plan.sourcePosition));if(prior&&prior.revision!==plan.id)fail();
  const completed=await this.index.change(value.completed,key(plan.sourcePosition),plan.id);await this.index.flush(completed);
  await this.store.putObject(this.id(plan.draftId,plan.draftRevision),{...value,completed});return value.count-completed.count;
 }
 async verify(workspaceId,{signal}={}){
  for await(const id of this.store.objectIdEntries(prefix,{signal})){
   signal?.throwIfAborted();const value=await this.store.object(id);this.validate(value);
   if(id!==this.id(value.draftId,value.draftRevision)||value.workspaceId!==workspaceId)fail();
   let count=0;
   for await(const entry of this.index.entries({root:value.completed})){
    signal?.throwIfAborted();const position=Number(entry.id);
    if(!Number.isSafeInteger(position)||position<0||position>=value.count||entry.id!==key(position)||!await this.receipt(value.draftId,value.draftRevision,position))fail();count++;
   }
   if(count!==(value.completed?.count??0))fail();
  }
 }
}
