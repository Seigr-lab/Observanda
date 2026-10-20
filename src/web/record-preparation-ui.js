import {attemptForm,readAttemptForm} from './attempt-form.js';
import {attemptDraftRow} from './attempt-draft.js';
import {preparationCollections,preparationHeaderFields} from './attempt-model.js';
import {researchTargetPicker} from './research-target-picker.js';
import {materialSourcePicker} from './material-source-picker.js';
import {revisionId} from './revision-model.js';
import {t} from './i18n/index.js';
const clone=value=>structuredClone(value),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// One selected checkpoint owns the entire retained preparation. The browser
// holds only its header and four rows per collection, including late typing.
export function recordPreparationUI({state,api,esc,field,notify,onSaved,onClosed,referencePicker,rebase}){
 const text=(key,args)=>t('recordValues',key,args),label=(key,args)=>t('attempts',key,args),dialog=document.createElement('dialog');dialog.className='record-writing';dialog.setAttribute('aria-labelledby','preparation-value-title');document.body.append(dialog);
 let owner=null,base=null,writer=null,header=null,pages=null,value=null,dirty=false,busy=false,loading=false,error='',status='',pending=null,timer=null,queue=Promise.resolve(),retry=false,resolveClose=null,focusBefore=null,picker=null,materials=null,saveCommand=null,rebaseRequest=null,rebaseAvailable=false;
 const context=()=>state.access?.locked?null:JSON.stringify([state.storage?.contextId,state.book?.id]),valid=s=>s&&s===owner&&s.context===context();
 const guard=()=>{if(!valid(owner))throw Error(text('changedWorkspace'));};
 const command=()=>({workspaceId:base.workspaceId,recordId:base.recordId,selection:base.selection,draft:writer.revision?{id:writer.id,revision:writer.revision}:null});
 const call=(name,data,options={})=>api('/api/research/records/preparation/'+name,data,{...options,adopt:false});
 const button=(key,action)=>'<button type="button" class="button" data-writing="'+action+'">'+esc(text(key))+'</button>';
 function read(){const form=dialog.querySelector('#attempt-form');if(form&&value)readAttemptForm(form,value);}
 function paint(){
  dialog.querySelector('[data-writing-error]')?.replaceChildren(document.createTextNode(error));dialog.querySelector('[data-writing-status]')?.replaceChildren(document.createTextNode(status));
  const fields=dialog.querySelector('[data-writing-fields]');if(fields)fields.inert=busy||loading||!!saveCommand||!!rebaseRequest;
  for(const el of dialog.querySelectorAll('[data-writing]'))el.disabled=busy||loading;
  const save=dialog.querySelector('[data-writing="save"]');if(save)save.disabled=busy||loading||!dirty||!!rebaseRequest;
  const close=dialog.querySelector('[data-writing="close"]');if(close)close.textContent=text(dirty?'keepDraft':'close');
  const again=dialog.querySelector('[data-writing="retry"]');if(again)again.hidden=!retry;
  const rebaseButton=dialog.querySelector('[data-writing="rebase"]');if(rebaseButton)rebaseButton.hidden=!rebaseAvailable;
  const discard=dialog.querySelector('[data-writing="discard"]');if(discard){discard.hidden=!dirty&&!writer?.revision;discard.disabled=busy||loading||!!saveCommand||!!rebaseRequest;}
 }
 function navigation(group){const page=pages[group],control=(key,offset,disabled)=>'<button type="button" class="button" data-preparation-page="'+group+'" data-offset="'+offset+'"'+(disabled?' disabled':'')+'>'+esc(label(key))+'</button>';return '<p role="status">'+esc(label('nestedRange',{first:page.total?page.offset+1:0,last:page.offset+page.items.length,total:page.total}))+'</p><div class="inline-actions">'+control('nestedPrevious',Math.max(0,page.offset-4),page.offset===0)+control('nestedNext',page.next??page.offset,page.next===null)+'</div>';}
 function draw(){
  picker?.stop();materials?.dispose();picker=materials=null;
  dialog.innerHTML='<h2 id="preparation-value-title" tabindex="-1">'+esc(text('heading',{field:label('title')}))+'</h2>'+(base?'<p>'+esc(base.recordTitle)+'</p>':'')+'<div data-writing-fields>'+(value?attemptForm({kind:'preparation',draft:value,attempt:{preparations:[]},esc,message:(key,args)=>key==='draftHelp'?text('attemptDraftHelp'):label(key,args),actions:false,collectionControl:navigation}):'')+'</div><p role="alert" data-writing-error></p><p role="status" data-writing-status></p><div class="dialog-actions">'+button('close','close')+button('discard','discard')+button('retry','retry')+button('save','save')+(rebase?'<button type="button" class="button" data-writing="rebase" hidden>'+esc(rebase.label)+'</button>':'')+'</div>';paint();
 }
 function verify(result){if(!result||result.workspaceId!==base.workspaceId||result.recordId!==base.recordId||!same(result.selection,base.selection)||result.draft&&!revisionId(result.draft.revision)||!result.header||preparationCollections.some(group=>!result.collections?.[group]||result.collections[group].items.length>4))throw Error(text('invalidRead'));return result;}
 function adopt(result){verify(result);header=clone(result.header);pages=clone(result.collections);if(result.draft)writer={...result.draft};value={...clone(header),...Object.fromEntries(preparationCollections.map(group=>[group,pages[group].items.map(row=>clone(row.value))]))};}
 function operations(){
  const nextHeader=Object.fromEntries(preparationHeaderFields.map(key=>[key,clone(value[key])])),ops=[];if(!same(header,nextHeader))ops.push({type:'header',value:nextHeader});
  for(const group of preparationCollections)for(let i=0;i<value[group].length;i++){const row=pages[group].items[i];if(!same(row.value,value[group][i]))ops.push({type:'replace',collection:group,position:row.position,id:row.value.id,revision:row.revision,value:clone(value[group][i])});}
  return ops;
 }
 async function acknowledge(result,{retainTyping=true}={}){
  verify(result);writer={...result.draft};const collections=clone(result.collections),at=owner;
  for(const group of preparationCollections)if(pages[group].offset){const page=await call('window',{...command(),collection:group,offset:pages[group].offset});if(!valid(at))return;collections[group]=page;}
  header=clone(result.header);pages=collections;value.recordedAt=header.recordedAt;if(!retainTyping)value={...clone(header),...Object.fromEntries(preparationCollections.map(group=>[group,pages[group].items.map(row=>clone(row.value))]))};
 }
 async function flush(){
  clearTimeout(timer);timer=null;const at=owner;
  const task=queue.then(async()=>{for(;;){if(!valid(at)||!value)return;guard();read();const ops=operations();if(!pending&&!ops.length)return;
   pending??={...command(),id:writer.id,commandId:crypto.randomUUID(),operations:ops};status=text('checkpointing');paint();
   try{const result=await call('change',pending);if(!valid(at))return;const structural=pending.operations.some(op=>op.type==='append'||op.type==='remove');await acknowledge(result,{retainTyping:!structural});if(!valid(at))return;pending=null;if(structural)draw();retry=false;error='';status=text('checkpointed');paint();}
   catch(failure){if(valid(at)){retry=true;error=failure.message||text('checkpointFailed');status='';paint();}throw failure;}
  }});queue=task.catch(()=>{});return task;
 }
 function changed(){dirty=true;error='';status=text('checkpointing');clearTimeout(timer);timer=setTimeout(()=>void flush().catch(()=>{}),800);paint();}
 async function mutate(operation){await flush();guard();pending={...command(),id:writer.id,commandId:crypto.randomUUID(),operations:[operation]};const result=await call('change',pending);guard();await acknowledge(result,{retainTyping:false});pending=null;dirty=true;retry=false;status=text('checkpointed');}
 async function loadPage(group,offset,{flushed=false}={}){if(!flushed)await flush();guard();const result=await call('window',{...command(),collection:group,offset});guard();pages[group]=result;value[group]=result.items.map(row=>clone(row.value));draw();}
 async function remove(){await queue;if(pending)await flush();if(writer?.revision)await api('/api/research/drafts/remove',{id:writer.id,workspaceId:base.workspaceId,expectedRevision:writer.revision},{adopt:false});}
 function finish(){clearTimeout(timer);timer=null;picker?.stop();materials?.dispose();picker=materials=null;dialog.close();owner=null;base=header=pages=value=writer=pending=saveCommand=rebaseRequest=null;rebaseAvailable=false;dirty=busy=loading=retry=false;error=status='';dialog.innerHTML='';focusBefore?.isConnected&&focusBefore.focus({preventScroll:true});resolveClose?.();resolveClose=null;void onClosed?.();}
 async function close(){busy=true;paint();try{if(dirty&&!saveCommand&&!rebaseRequest)await flush();finish();}catch{busy=false;paint();}}
 async function save(){
  if(rebaseRequest)return;guard();read();if([...dialog.querySelectorAll('input,select,textarea')].some(el=>!el.reportValidity()))return;const at=owner;busy=true;paint();
  try{if(!saveCommand){await flush();guard();saveCommand=clone(command());}status=text('saving');paint();const saved=await call('save',saveCommand);if(!valid(at))return;if(saved?.saved!==true||!revisionId(saved.revision)||!revisionId(saved.etag))throw Error(text('invalidSave'));
   dirty=false;let retained=false;try{await remove();}catch{retained=true;}if(!valid(at))return;
   try{await onSaved(saved,{workspaceId:base.workspaceId,recordId:base.recordId,field:base.selection.field},{completedDialog:dialog});}finally{if(valid(at)){finish();notify(text(retained?'savedDraftRemains':'saved'));}}
  }catch(failure){if(valid(at)){if(failure.code==='ATTEMPT_CONFLICT'&&rebase)rebaseAvailable=true;if(['INVALID','ATTEMPT_CONFLICT','ATTEMPT_IMMUTABLE','ATTEMPT_REFERENCE','DRAFT_CHANGED'].includes(failure.code))saveCommand=null;error=failure.message||text('failed');busy=false;paint();}}
 }
 async function reference(control){
  const at=owner,path=control.dataset.path.split('.'),container=path.slice(0,-1).reduce((v,key)=>v[key],value),key=path.at(-1),multiple=control.dataset.multiple==='true',host=dialog.querySelector('[data-attempt-picker]');
  const stop=()=>{if(valid(at)){busy=false;draw();}},apply=ref=>{guard();if(multiple){if(!container[key].some(row=>same(row,ref))){if(container[key].length>=20)throw Error(label('invalid'));container[key].push(ref);}}else container[key]=ref;changed();stop();};
  busy=true;paint();host.hidden=false;host.inert=false;host.closest('[data-writing-fields]').inert=false;for(const el of dialog.querySelectorAll('#attempt-form button,#attempt-form input,#attempt-form textarea,#attempt-form select'))el.disabled=true;
  if(referencePicker){picker=referencePicker({host,recordId:base.recordId,kind:control.dataset.kind,onChoose:apply,onCancel:stop});return;}
  if(control.dataset.kind==='record'){
   picker=researchTargetPicker({state,api,esc,field,active:()=>valid(at),excludeId:()=>base.recordId});picker.open({root:host,recordsOnly:true,onCancel:stop,onChoose:async(item,{signal,stillCurrent})=>{const ref=await api('/api/research/materials/pin',{id:item.id,expectedRevision:item.revision},{adopt:false,signal});if(!stillCurrent()||!valid(at))return;if(ref.id!==item.id||ref.revision!==item.revision||ref.workspaceId!==base.workspaceId||ref.kind!=='record')throw Error(label('changed'));apply({...ref,label:item.title});}});
  }else{
   host.innerHTML='<div><input type="hidden" data-value></div>';materials=materialSourcePicker({root:host.firstElementChild,call:(name,data,options)=>api('/api/research/materials/'+name,data,{...options,adopt:false}),esc,field,label:label('references'),id:'selected-preparation-material',recordId:base.recordId,guard,optional:true});const active=materials;await active.ready;if(!valid(at)||materials!==active)return;
   const use=document.createElement('button');use.type='button';use.className='button';use.textContent=label('useReference');use.onclick=async()=>{try{guard();const [ref]=active.values();if(!ref)throw Error(label('invalid'));const doc=await api('/api/research/materials/read',{ref},{adopt:false});if(valid(at)&&materials===active)apply({...ref,workspaceId:base.workspaceId,label:doc.title});}catch(failure){error=failure.message;paint();}};host.append(use);const cancel=document.createElement('button');cancel.type='button';cancel.textContent=label('cancel');cancel.onclick=stop;host.append(cancel);
  }
 }
 dialog.addEventListener('input',event=>{if(event.target.closest('[data-writing-fields]'))event.stopPropagation();if(!busy&&!loading&&!saveCommand&&!rebaseRequest&&event.target.closest('#attempt-form')){read();changed();}});
 dialog.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();if(!busy&&!loading)void save();});
 dialog.addEventListener('cancel',event=>{event.preventDefault();if(!busy&&!loading)void close();});
 dialog.addEventListener('click',async event=>{
  const control=event.target.closest('[data-writing],[data-attempt-form],[data-preparation-page]');if(!control||control.disabled||busy||loading||saveCommand&&!['save','close'].includes(control.dataset.writing)||rebaseRequest&&!['rebase','close'].includes(control.dataset.writing))return;event.preventDefault();event.stopPropagation();const at=owner;
  try{
   const action=control.dataset.writing;if(action==='save')return await save();if(action==='close')return await close();if(action==='retry'){busy=true;paint();await flush();busy=false;draw();return;}
   if(action==='rebase'&&rebase){busy=true;paint();try{rebaseRequest??={...command(),commandId:crypto.randomUUID()};const result=await rebase.apply(rebaseRequest);guard();base.selection=clone(result.selection);await acknowledge(result,{retainTyping:false});rebaseRequest=null;rebaseAvailable=false;error='';dirty=true;draw();}catch(failure){if(['DRAFT_CHANGED','ATTEMPT_IMMUTABLE','CONFLICT','COLLABORATION_DENIED'].includes(failure.code))rebaseRequest=null;throw failure;}return;}
   if(action==='discard'){if(control.dataset.confirm!=='true'){control.dataset.confirm='true';control.textContent=text('confirmDiscard');return;}busy=true;paint();await remove();if(valid(at))finish();return;}
   read();if(control.hasAttribute('data-preparation-page')){busy=true;paint();await loadPage(control.dataset.preparationPage,Number(control.dataset.offset));}
   else {const name=control.dataset.attemptForm,group=control.dataset.group;
    if(name==='reference')return await reference(control);
    if(name==='remove-ref'){const path=control.dataset.path.split('.'),container=path.slice(0,-1).reduce((v,key)=>v[key],value),key=path.at(-1);if(control.dataset.multiple==='true')container[key].splice(Number(control.dataset.index),1);else container[key]=null;changed();draw();return;}
    busy=true;paint();if(name==='add-row'){await mutate({type:'append',collection:group,value:attemptDraftRow(group)});await loadPage(group,Math.floor((pages[group].total-1)/4)*4,{flushed:true});}
    if(name==='remove-row'){await flush();const row=pages[group].items[Number(control.dataset.index)];await mutate({type:'remove',collection:group,position:row.position,id:row.value.id,revision:row.revision});draw();}
   }
  }catch(failure){if(valid(at)){error=failure.message||text('failed');retry=!!pending;}}
  finally{if(valid(at)){busy=false;paint();}}
 });
 dialog.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();if(!busy&&!loading&&dirty)void save();}});
 async function open(input,retained=null,pendingSave=null){
  if(dialog.open)return;owner={context:context(),id:crypto.randomUUID()};const at=owner;focusBefore=document.activeElement;loading=true;status=text('loading');draw();dialog.showModal();
  try{if(retained){base={workspaceId:retained.draft.workspaceId,recordId:retained.draft.base.recordId,selection:retained.draft.selection,recordTitle:retained.draft.titles[0]};writer={id:retained.draft.id,revision:retained.revision};dirty=true;}
   else{const selected=await api('/api/research/records/values/read',{workspaceId:state.book.id,recordId:input.recordId,field:input.field},{adopt:false});if(!valid(at))return;if(selected.value?.value!==null)throw Error(t('errors','ATTEMPT_IMMUTABLE'));base={workspaceId:selected.workspaceId,recordId:selected.recordId,recordTitle:selected.recordTitle,selection:{field:selected.field,revision:selected.revision,storageRevision:selected.storageRevision}};writer={id:crypto.randomUUID(),revision:null};}
   const result=await call('open',command());if(!valid(at))return;adopt(result);saveCommand=pendingSave?clone(pendingSave):null;loading=false;status=retained?text('checkpointed'):'';draw();dialog.querySelector('input,textarea')?.focus();
  }catch(failure){if(valid(at)){loading=false;error=failure.message||text('failed');status='';paint();}}
  return new Promise(resolve=>{resolveClose=resolve;});
 }
 const unload=event=>{if(dirty||pending){event.preventDefault();event.returnValue='';}},visibility=()=>{if(document.hidden&&dirty&&!saveCommand&&!rebaseRequest)void flush().catch(()=>{});};
 window.addEventListener('beforeunload',unload);document.addEventListener('visibilitychange',visibility);
 return {open,recover:(retained,pendingSave=null)=>open({},retained,pendingSave),save,isDirty:()=>dialog.open,isBusy:()=>busy||loading,locked(){if(dialog.open)finish();},dispose(){if(dialog.open)finish();window.removeEventListener('beforeunload',unload);document.removeEventListener('visibilitychange',visibility);dialog.remove();}};
}
