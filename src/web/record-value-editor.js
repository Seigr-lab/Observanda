import {t} from './i18n/index.js';
import {revisionId} from './revision-model.js';


// Shared checkpoint, conflict and lifetime owner for selected-value editors.
// Domain views own their controls; this owner never loads a complete record.
export function recordValueEditor({state,api,esc,notify,onSaved,onClosed,adapter}){
 const text=key=>t(adapter.messages,key);
 const dialog=document.createElement('dialog');dialog.className='record-writing';dialog.setAttribute('aria-labelledby',adapter.route+'-value-title');document.body.append(dialog);
 let owner=null,editorEpoch=0,base=null,value=null,writer=null,dirty=false,busy=false,loading=false,checkpointError=false,error='',status='',conflict=null,timer=null,queue=Promise.resolve(),pending=null,last='',resolveClose=null,focusBefore=null;
 const context=()=>state.access?.locked?null:JSON.stringify([state.storage?.contextId,state.book?.id]);
 const view=adapter.view({context:()=>owner?owner.id+':'+editorEpoch:null,refresh:()=>paint(),close:async()=>{if(busy||loading)return false;await close();return !dialog.open;}});
 const target=base=>({workspaceId:base.workspaceId,recordId:base.recordId,...adapter.target(base)});
 const selection=base=>({...adapter.target(base),revision:base.revision,storageRevision:base.storageRevision});
 const button=(label,action,primary=false)=>'<button type="button" class="button'+(primary?' primary':'')+'" data-writing="'+action+'">'+esc(text(label))+'</button>';
 const validContext=()=>owner?.context===context();
 function readReply(result,expected){
  if(!result||Object.entries(expected).some(([key,value])=>result[key]!==value)||!revisionId(result.revision)||!revisionId(result.storageRevision)||!revisionId(result.etag)||typeof result.recordTitle!=='string'||!result.value||typeof result.value!=='object'||Array.isArray(result.value))throw Error(text('invalidRead'));
  return result;
 }
 function paint(){
  dialog.querySelector('[data-writing-error]')?.replaceChildren(document.createTextNode(error));
  dialog.querySelector('[data-writing-status]')?.replaceChildren(document.createTextNode(status));
  const form=dialog.querySelector('[data-writing-fields]');if(form)form.inert=busy;
  for(const control of dialog.querySelectorAll('[data-writing]'))control.disabled=busy||loading;
  const save=dialog.querySelector('[data-writing="save"]');if(save)save.disabled=busy||loading||!dirty||Boolean(conflict)||Boolean(view.busy?.());
  const close=dialog.querySelector('[data-writing="close"]');if(close)close.textContent=text(dirty?'keepDraft':'close');
  const retry=dialog.querySelector('[data-writing="retry"]');if(retry)retry.hidden=!checkpointError;
  const discard=dialog.querySelector('[data-writing="discard"]');if(discard)discard.hidden=!dirty&&!writer?.revision;
 }
 function draw(){
  view.release?.();dialog.innerHTML='<h2 id="'+adapter.route+'-value-title" tabindex="-1">'+esc(view.heading(base))+'</h2>'+
   (base?'<p>'+esc(base.recordTitle)+'</p>':'')+'<div data-writing-fields>'+(value?view.fields(base,value,changed):'')+'</div>'+
   (conflict?'<section class="record-writing-conflict"><h3>'+esc(text('savedVersion'))+'</h3>'+view.preview(conflict)+'<div class="inline-actions">'+button('useSaved','use-saved')+button('keepMine','keep-mine')+'</div></section>':'')+
   '<p role="alert" data-writing-error></p><p role="status" data-writing-status></p><div class="dialog-actions">'+button('close','close')+button('discard','discard')+button('retry','retry')+button('save','save',true)+'</div>';
  view.bind?.(dialog);paint();
 }
 function changed(){dirty=true;error='';status=text('checkpointing');clearTimeout(timer);timer=setTimeout(()=>void flush().catch(()=>{}),800);paint();}
 async function flush(){
  clearTimeout(timer);timer=null;const currentOwner=owner;
  const task=queue.then(async()=>{
   for(;;){
   if(!dirty||!base||!value||!writer||currentOwner!==owner)return true;
   if(!validContext())throw Error(text('changedWorkspace'));
   try{await view.checkpoint?.();}
   catch(failure){if(currentOwner===owner){checkpointError=true;error=failure.message||text('checkpointFailed');status='';paint();}throw failure;}
   if(currentOwner!==owner||!validContext())return false;
   const selected=selection(base);
   const identity=JSON.stringify({selected,value});if(!pending&&identity===last){status=text('checkpointed');paint();return true;}
   pending??={id:writer.id,workspaceId:base.workspaceId,recordId:base.recordId,expectedRevision:writer.revision,[adapter.baseName]:selected,value:structuredClone(value)};
   status=text('checkpointing');paint();
   const command=pending,currentWriter=writer;
   try{
    const result=await api('/api/research/drafts/'+adapter.route+'/write',command,{adopt:false});
    if(!revisionId(result?.revision))throw Error(text('invalidCheckpoint'));
    currentWriter.revision=result.revision;if(currentOwner!==owner)return true;
    last=JSON.stringify({selected:command[adapter.baseName],value:command.value});pending=null;
    if(checkpointError)error='';checkpointError=false;status=text('checkpointed');paint();
    // An acknowledged request may describe an earlier keystroke or choice.
    // Keep flushing the current value before close/save can finish.
    if(last===JSON.stringify({selected:selection(base),value}))return true;
   }catch(failure){
    if(currentOwner!==owner)return false;
    checkpointError=true;
    if(['INVALID','FORMAT'].includes(failure.code))pending=null;
    if(failure.code==='DRAFT_CHANGED'){writer={id:crypto.randomUUID(),revision:null};pending=null;last='';changed();}
    error=failure.message||text('checkpointFailed');status='';paint();throw failure;
   }
   }
  });queue=task.catch(()=>{});return task;
 }
 async function removeCheckpoint(){
  await queue;
  if(pending)await flush();
  if(writer?.revision)await api('/api/research/drafts/remove',{id:writer.id,workspaceId:base.workspaceId,expectedRevision:writer.revision},{adopt:false});
 }
 function finish(){
  clearTimeout(timer);timer=null;dialog.close();owner=null;view.release?.();dialog.innerHTML='';
  base=value=writer=pending=conflict=null;dirty=busy=loading=checkpointError=false;last=error=status='';
  if(focusBefore?.isConnected)focusBefore.focus({preventScroll:true});resolveClose?.();resolveClose=null;void onClosed?.();
 }
 async function save(){
  if(view.busy?.())return;
  if(!validContext())throw Error(text('changedWorkspace'));
  if([...dialog.querySelectorAll('input,select,textarea')].some(input=>!input.reportValidity()))return;
  const savingOwner=owner;
  busy=true;paint();
  try{
   if(await view.validate?.(dialog,base,value)===false)return;
   if(owner!==savingOwner||!validContext())return;
   await flush();if(owner!==savingOwner||!validContext())return;status=text('saving');paint();
   const savedTarget=target(base),result=await api('/api/research/records/'+adapter.route+'/save',{...savedTarget,expectedRevision:base.revision,value},{adopt:false});
   if(owner!==savingOwner||!validContext())return;
   if(result?.saved!==true||!revisionId(result.revision)||!revisionId(result.etag))throw Error(text('invalidSave'));
   dirty=false;status=text('finishingSave');paint();let retained=false;try{await removeCheckpoint();}catch{retained=true;}
   if(owner!==savingOwner)return;
   // Keep the acknowledged editor busy until its reader has adopted the save.
   // A failed refresh must still close this editor and report the durable save.
   try{await onSaved(result,savedTarget,{completedDialog:dialog});}
   finally{if(owner===savingOwner){finish();notify(text(retained?'savedDraftRemains':'saved'));}}
  }catch(failure){
   if(owner!==savingOwner)return;
   if(failure.code==='RECORD_CHANGED'||adapter.conflictCodes?.includes(failure.code)){
    const expected=target(base),current=readReply(await api('/api/research/records/'+adapter.route+'/read',expected,{adopt:false}),expected);if(owner!==savingOwner)return;await view.prepare?.(current,value,{});if(owner!==savingOwner)return;conflict=current;error=text('conflict');draw();
   }else error=failure.message||text('failed');
  }finally{if(owner===savingOwner){busy=false;paint();}}
 }
 dialog.addEventListener('input',event=>{
  if(event.target.closest('[data-writing-fields]'))event.stopPropagation();
  if(!busy&&!loading&&view.input?.(event.target,base,value))changed();
 });
 dialog.addEventListener('cancel',event=>{event.preventDefault();if(!busy&&!loading)void close();});
 async function close(){
  const closingOwner=owner;
  if(dirty){busy=true;paint();try{await flush();}catch{if(owner===closingOwner){busy=false;paint();}return;}}
  if(owner===closingOwner)finish();
 }
 dialog.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();if(!busy&&!loading&&dirty&&!conflict)void save().catch(failure=>notify(failure.message,true));}});
 dialog.addEventListener('click',async event=>{
  const control=event.target.closest('[data-writing]');if(!control||busy||loading)return;
  const actionOwner=owner;
  try{
   const action=control.dataset.writing;
   if(action==='save')await save();
   else if(action==='retry')await flush();
   else if(action==='close')await close();
   else if(action==='discard'){
    if(control.dataset.confirm!=='true'){control.dataset.confirm='true';control.textContent=text('confirmDiscard');return;}
    busy=true;paint();await removeCheckpoint();if(owner===actionOwner)finish();
   }else if(['use-saved','keep-mine'].includes(action)&&conflict){
    busy=true;paint();await flush();if(owner!==actionOwner)return;base=conflict;conflict=null;error='';
    if(action==='use-saved'){value=structuredClone(base.value);dirty=false;await removeCheckpoint();if(owner!==actionOwner)return;writer={id:crypto.randomUUID(),revision:null};last='';editorEpoch++;}
    else {view.rebase?.(base,value);changed();}busy=false;draw();
   }
  }catch(failure){if(owner===actionOwner){error=failure.message||text('failed');busy=false;paint();}}
 });
 async function open(input,retained=null){
  if(dialog.open)return;owner={context:context(),id:crypto.randomUUID()};const loadingOwner=owner;focusBefore=document.activeElement;loading=true;status=text('loading');draw();dialog.showModal();
  try{
   if(retained){
    const result=await api('/api/research/drafts/'+adapter.route+'/read',{workspaceId:retained.draft.workspaceId,id:retained.draft.id,expectedRevision:retained.revision},{adopt:false});
    if(owner!==loadingOwner)return;
    base={workspaceId:result.draft.workspaceId,recordId:result.draft.base.recordId,...result.draft[adapter.baseName],definition:result.definition,recordTitle:result.draft.titles[0]};
    value=result.value;writer={id:result.draft.id,revision:result.revision};dirty=true;last=JSON.stringify({selected:result.draft[adapter.baseName],value});status=text('checkpointed');
   }else{
    const expected={workspaceId:state.book.id,recordId:input.recordId,...adapter.target(input)},result=await api('/api/research/records/'+adapter.route+'/read',expected,{adopt:false});if(owner!==loadingOwner)return;readReply(result,expected);
    base=result;value=structuredClone(base.value);writer={id:crypto.randomUUID(),revision:null};status='';
   }
   if(!validContext())throw Error(text('changedWorkspace'));await view.prepare?.(base,value,input);if(owner!==loadingOwner||!validContext())return;loading=false;if(!retained)view.initialize?.(base,value,input,changed);draw();dialog.querySelector(view.focus)?.focus();
  }catch(failure){if(owner!==loadingOwner)return;loading=false;error=failure.message||text('failed');status='';paint();}
  return new Promise(resolve=>{resolveClose=resolve;});
 }
 window.addEventListener('beforeunload',event=>{if(dirty||pending){event.preventDefault();event.returnValue='';}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&dirty)void flush().catch(()=>{});});
 return {open,recover:header=>open({},header),locked(){if(dialog.open){owner=null;finish();}}};
}
