// The room supplies authenticated transport and its encrypted command outbox;
// the native selected editor owns rows, checkpoint retries and exact Save.
import {recordPreparationUI} from './record-preparation-ui.js';
import {onlineAttemptPicker} from './online-attempt-picker.js';
import {t} from './i18n/index.js';
export function onlinePreparations({remote,commands,esc,notify,record,workspaceId,onSaved,onClosed}){
 const state={book:{id:workspaceId},storage:{contextId:crypto.randomUUID()},access:{locked:false}};let selected=null,readOnly=false,disposed=false,opening=false;
 const guard=()=>{if(disposed||readOnly)throw Error(t('online','denied'));};
 async function send(command){const response=await commands.send(command);await commands.acknowledge(command.id);if(response.rejected)throw Object.assign(Error(response.rejected.message),{code:response.rejected.code});return response.result;}
 const api=async(route,data)=>{
  guard();
  if(route.endsWith('/values/read')){selected=await remote('preparation-select',{recordId:record.id,field:data.field});return selected;}
  if(route.endsWith('/drafts/remove'))return remote('preparation-remove',{workspaceId,recordId:record.id,selection:selected.selection??{field:selected.field,revision:selected.revision,storageRevision:selected.storageRevision},draft:{id:data.id,revision:data.expectedRevision}});
  const operation=route.split('/').at(-1);
  if(operation==='change')return send({recordId:record.id,id:data.commandId,kind:'preparation-change',command:data});
  if(operation==='save')return send({...data,id:data.selection.field.split(':').at(-1),kind:'preparation-checkpoint'});
  return remote('preparation-'+operation,data);
 };
 const editor=recordPreparationUI({state,api,esc,notify,onSaved,onClosed,rebase:{label:t('online','attemptRebase'),apply:command=>send({recordId:record.id,id:command.commandId,kind:'preparation-rebase',command}).then(result=>{selected={selection:result.selection};return result;})},referencePicker:({host,kind,onChoose,onCancel})=>{const picker=onlineAttemptPicker({host,record,remote,esc,recordsOnly:kind==='record',onChoose,onCancel});return {stop:()=>picker.dispose()};}});
 return {
  async open(){guard();if(opening||editor.isDirty())return;opening=true;try{const pending=await commands.pending();guard();if(pending.pending)return await this.recover(pending.pending);const saved=await remote('preparation-pending',{recordId:record.id});guard();if(saved.pending){selected={selection:saved.pending.draft.selection};return await editor.recover(saved.pending);}return await editor.open({recordId:record.id,field:'attempt:preparation:'+crypto.randomUUID()});}finally{opening=false;}},
  async recover(pending){guard();if(['preparation-change','preparation-rebase'].includes(pending.command.kind))await send(pending.command);const saved=await remote('preparation-pending',{recordId:record.id});guard();if(!saved.pending)throw Error(t('online','attemptRecoveryFailed'));selected={selection:saved.pending.draft.selection};const command=pending.command;return editor.recover(saved.pending,command.kind==='preparation-checkpoint'?{workspaceId,recordId:record.id,selection:command.selection,draft:command.draft}:null);},
  save:()=>editor.save(),isDirty:()=>opening||editor.isDirty(),isBusy:()=>opening&&!editor.isDirty()||editor.isBusy(),setReadOnly(){readOnly=true;},dispose(){disposed=true;editor.dispose();}
 };
}
