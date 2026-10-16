import {randomUUID} from 'node:crypto';
import {liveValid as valid} from './live-protocol.js';
import {identityHash} from './identity.js';
import {exact,uuid} from '../modules/validation.js';
import {emptyAttempt,validAttempt,attemptReferences} from '../web/attempt-model.js';
import {preparationMethodLinks} from '../web/attempt-workflow.js';
import {materialRef} from '../research-materials.js';
import {LiveMaterialReading} from './live-material-reading.js';
import {ResearchRecords,recordRevision} from '../research.js';
import {MediaStore} from '../media.js';
const groups={preparation:'preparations',event:'events',assessment:'assessments'};
const sameRef=(a,b)=>a.kind===b.kind&&a.id===b.id&&a.revision===b.revision;

// Structured facts keep their native append-only history. Authorization,
// reference checks, facts, method links, receipt and audit share one transaction.
export class LiveAttempts extends LiveMaterialReading{
 async pin(store,access,scope,source,ref){
  valid(materialRef(ref)&&exact(ref,['kind','id','revision']));
  let document;
  if(ref.kind==='record'){
   valid(ref.id!==source.id);document=await this.readRecord(store,access,ref.id);valid(recordRevision(document)===ref.revision,'RECORD_CHANGED');await this.materials.retainRecord(document);
  }else{
   const head=await this.materials.current(ref.id);valid(head&&head.kind===ref.kind&&head.revision===ref.revision,'MATERIAL_CHANGED');document=await this.resolve(store,access,ref);
  }
  return {reference:{workspaceId:scope.workspaceId,...ref,label:document.title}};
 }
 async read(store,access,source,ref,trail=[]){
  valid(materialRef(ref));valid(attemptReferences(source.attempt).some(r=>sameRef(r,ref)),'COLLABORATION_DENIED');
  return super.read(store,access,source,ref,trail);
 }
 async append(store,access,scope,record,data,audit){
  valid(exact(data,['recordId','id','kind','item'])&&uuid(data.id)&&Object.hasOwn(groups,data.kind)&&data.item&&typeof data.item==='object'&&!Array.isArray(data.item));
  const receipt='.observanda/collaboration/live/receipts/'+access.principalId+'/'+data.id+'.json',hash=identityHash(data),raw=await this.workspace.readMetadata(receipt,2048);
  if(raw){const prior=JSON.parse(raw);valid(prior.hash===hash,'CONFLICT');return prior;}
  const attempt=structuredClone(record.attempt??emptyAttempt()),group=groups[data.kind],item={...structuredClone(data.item),id:data.id,recordedAt:new Date().toISOString()};
  valid(!Object.values(groups).some(name=>attempt[name].some(r=>r.id===item.id)),'CONFLICT');
  if(item.supersedes)valid(attempt[group].some(r=>r.id===item.supersedes)&&!attempt[group].some(r=>r.supersedes===item.supersedes),'RECORD_CHANGED');
  if(data.kind==='preparation')valid(item.supersedes===(attempt.preparations.at(-1)?.id??null),'RECORD_CHANGED');
  attempt[group].push(item);valid(validAttempt(attempt));
  for(const ref of attemptReferences({...emptyAttempt(),[group]:[item]})){
   valid(ref.workspaceId===scope.workspaceId&&(ref.kind!=='record'||ref.id!==record.id),'COLLABORATION_DENIED');await this.resolve(store,access,ref);
  }
  const next={...structuredClone(record),attempt,updatedAt:new Date().toISOString()};
  if(data.kind==='preparation')next.relations=preparationMethodLinks(next.relations,attempt,{uuid:randomUUID});
  await new ResearchRecords(this.workspace,new MediaStore(this.workspace)).saveLocked({workspaceId:scope.workspaceId,changes:[{id:record.id,expectedRevision:recordRevision(record),record:next}]},{receipt:true});
  const response={hash,revision:recordRevision(next),itemId:item.id};await this.workspace.writeMetadata(receipt,JSON.stringify(response));
  await audit(access,record.id,'attempt',{kind:data.kind,itemId:item.id,before:recordRevision(record),after:response.revision});return response;
 }
}
