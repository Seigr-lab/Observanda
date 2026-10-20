import {attemptValueField} from '../web/record-attempt-value.js';
import {validRecordValueBase} from '../web/record-value-model.js';
import {revisionId} from '../web/revision-model.js';
import {exact,uuid} from '../modules/validation.js';
import {liveValid as valid} from './live-protocol.js';
import {LiveCommandOutbox} from './live-command-outbox.js';
const selected=c=>c&&uuid(c.workspaceId)&&validRecordValueBase(c.selection)&&attemptValueField(c.selection.field)?.kind==='preparation';
const checkpoint=value=>exact(value,['id','revision'])&&uuid(value.id)&&revisionId(value.revision);
function commandValid(key,c){
 if(!c||!uuid(c.id)||c.recordId!==key.recordId)return false;
 if(c.kind==='preparation-checkpoint')return exact(c,['recordId','id','kind','workspaceId','selection','draft'])&&selected(c)&&attemptValueField(c.selection.field).id===c.id&&checkpoint(c.draft);
 if(['preparation-change','preparation-rebase'].includes(c.kind)){
  const value=c.command;if(!exact(c,['recordId','id','kind','command'])||!selected(value)||value.recordId!==key.recordId||value.commandId!==c.id)return false;
  if(c.kind==='preparation-rebase')return exact(value,['workspaceId','recordId','selection','draft','commandId'])&&checkpoint(value.draft);
  return exact(value,['workspaceId','recordId','selection','draft','commandId','id','operations'])&&uuid(value.id)&&(value.draft===null||checkpoint(value.draft))&&Array.isArray(value.operations)&&value.operations.length>0&&value.operations.length<=20;
 }
 return exact(c,['recordId','id','kind','item'])&&['preparation','event','assessment'].includes(c.kind)&&c.item&&c.item.id===c.id;
}
// The same encrypted outbox owns exact row checkpoints and final appends. No
// later command replaces an unresolved request from another tab or reconnect.
export class LiveAttemptOutbox extends LiveCommandOutbox{
 constructor(workspace,client){super(workspace,{
  file:key=>{valid(key&&uuid(key.connectionId)&&uuid(key.recordId));return '.observanda/collaboration/live/attempt-outbox/'+key.connectionId+'/'+key.recordId+'.json';},
  validate:(key,command)=>valid(commandValid(key,command)),
  send:async(key,command)=>{const operation=['preparation-change','preparation-rebase'].includes(command.kind)?command.kind:command.kind==='preparation-checkpoint'?'preparation-save':'attempt-append';return (await client(key.connectionId)).call(operation,command.command??command);},
  rejectedCodes:['ATTEMPT_CONFLICT','DRAFT_CHANGED','INVALID','COLLABORATION_INVALID','RECORD_CHANGED','MATERIAL_MISSING','MATERIAL_INVALID','ATTEMPT_REFERENCE','ATTEMPT_IMMUTABLE']
 });}
}
