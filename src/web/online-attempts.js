import {t} from './i18n/index.js';
import {attemptForm,readAttemptForm} from './attempt-form.js';
import {attemptDraft,attemptDraftRow} from './attempt-draft.js';
import {attemptView} from './attempt-view.js';
import {emptyAttempt,validAttempt,attemptReferences} from './attempt-model.js';
import {revisionText} from './revision-model.js';
import {onlineAttemptPicker} from './online-attempt-picker.js';
import {onlineAttemptReference} from './online-attempt-reference.js';
const groups={preparation:'preparations',event:'events',assessment:'assessments'};
const tr=(key,values)=>t('online',key,values);
const message=(key,values)=>['save','draftHelp'].includes(key)?tr(key==='save'?'attemptSave':'attemptDraftHelp'):t('attempts',key,values);

export function onlineAttempts({remote,commands,esc,notify,fileUrl}){
 let host,record,readOnly=false,disposed=false,busy=false,session=null,request=null,picker=null,referenceView=null,stale=false,recoveryFailed=false,latestKey='',generation=0;
 const button=(key,action,id='')=>'<button type="button" class="button" data-online-attempt="'+action+'" data-fact-id="'+esc(id)+'">'+esc(message(key))+'</button>';
 const attempt=()=>record.attempt??emptyAttempt();
 function controls(){
  if(!host)return;host.setAttribute('aria-busy',String(busy));
  for(const control of host.querySelectorAll('button,input,textarea,select')){
   if(control.closest('[data-attempt-picker],[data-attempt-reference-view]'))continue;
   control.disabled=busy||!!request||!!picker||readOnly||recoveryFailed;
  }
  for(const control of host.querySelectorAll('[data-online-attempt="read"]'))control.disabled=busy||!!request||!!picker;
  referenceView?.setBlocked(busy||!!request||!!picker);
  const recoverButton=host.querySelector('[data-online-attempt="recover"]');if(recoverButton)recoverButton.disabled=busy;
  host.querySelector('[data-attempt-conflict]').hidden=!stale;
  const form=host.querySelector('form');if(!form)return;
  const submit=form.querySelector('[type="submit"]');submit.disabled=busy||!!picker||readOnly||stale;submit.textContent=request?tr('retrySend'):message('save');
  form.querySelector('[data-attempt-form="cancel"]').disabled=busy||!!request||!!picker;
 }
 function draw(){
  const a=attempt(),key=revisionText(a);if(key!==latestKey){
   latestKey=key;host.querySelector('[data-attempt-saved]').innerHTML=attemptView(record.attempt,esc,{message,reference:(ref,i)=>'<button type="button" class="text-button" data-online-attempt="read" data-fact-id="'+i+'">'+esc(ref.label)+'</button>',correct:readOnly?null:(kind,item,label)=>button('correct',kind,item.id).replace('data-fact-id=','aria-label="'+esc(message('correct')+': '+label)+'" data-fact-id=')});
  }
  host.querySelector('[data-online-attempt="preparation"]').textContent=message(a.preparations.length?'amendPreparation':'addPreparation');host.querySelector('[data-online-attempt="assessment"]').hidden=!a.preparations.some(p=>p.criteria.length);controls();
 }
 function update(value,relations,version=generation){if(disposed||version!==generation)return;record.attempt=value??undefined;record.relations=relations;draw();}
 function readForm(){if(session){const form=host.querySelector('form');if(form)readAttemptForm(form,session.draft);}}
 function renderForm(){
  if(disposed||!session)return;host.querySelector('[data-attempt-edit]').innerHTML=attemptForm({kind:session.kind,draft:session.draft,attempt:session.attempt,esc,message});controls();
 }
 function cancel(){picker?.dispose();picker=null;session=null;request=null;stale=false;host.querySelector('[data-attempt-edit]').replaceChildren();host.querySelector('[data-attempt-recovered]').textContent='';controls();}
 async function recover(){
  if(busy||session)return;busy=true;controls();
  try{const {pending}=await commands.pending();if(disposed)return;recoveryFailed=false;
   if(pending){request=pending.command;session={kind:request.kind,draft:structuredClone(request.item),attempt:structuredClone(attempt())};host.querySelector('[data-attempt-recovered]').textContent=tr('attemptRecovered');host.querySelector('[data-live-attempt]').open=true;renderForm();}
   host.querySelector('[data-online-attempt="recover"]').hidden=true;
  }catch(error){if(!disposed){recoveryFailed=true;host.querySelector('[data-attempt-recovered]').textContent=tr('attemptRecoveryFailed');host.querySelector('[data-online-attempt="recover"]').hidden=false;notify(error.message,true);}}
  finally{busy=false;if(!disposed)controls();}
 }
 function begin(kind,id){
  if(session||busy||readOnly||recoveryFailed)throw Error(tr('attemptFinish'));const a=structuredClone(attempt()),prior=kind==='preparation'?a.preparations.at(-1):a[groups[kind]].find(v=>v.id===id);
  session={kind,attempt:a,draft:attemptDraft(kind,a,record.relations,prior)};stale=false;renderForm();host.querySelector('form input,form textarea,form select')?.focus();
 }
 async function save(){
  if(!session||disposed)return;if(busy||picker||readOnly||stale)throw Error(tr('attemptFinish'));const form=host.querySelector('form');
  if(!request){
   if(!form.reportValidity())throw Error(message('invalid'));readForm();const item=structuredClone(session.draft);if(session.kind==='event'&&!item.preparationId)item.preparationId=null;
   const check=structuredClone(session.attempt);check[groups[session.kind]].push(item);if(!validAttempt(check))throw Error(message('invalid'));
   request={recordId:record.id,id:item.id,kind:session.kind,item};
  }
  busy=true;generation++;controls();try{
   const response=await commands.send(request);await commands.acknowledge(request.id);
   if(response.rejected){request=null;throw Object.assign(Error(response.rejected.message),{code:response.rejected.code});}
   request=null;cancel();notify(tr('attemptSaved'));
   const result=await remote('attempt',{recordId:record.id});if(!disposed)update(result.attempt,result.relations);
  }catch(error){
   if(request){try{const {pending}=await commands.pending();if(!pending||pending.command.id!==request.id)request=null;}catch{/* Keep the original request when local storage cannot establish its state. */}}
   if(error.code==='RECORD_CHANGED'&&!request){const result=await remote('attempt',{recordId:record.id});if(!disposed){update(result.attempt,result.relations);stale=true;}throw Error(tr('attemptConflict'));}throw error;
  }finally{busy=false;generation++;controls();}
 }
 async function formAction(control){
  if(!session||busy||request)return;const action=control.dataset.attemptForm;if(action==='cancel'){cancel();return;}if(readOnly||picker)return;readForm();const d=session.draft;
  if(action==='add-row'){const group=control.dataset.group;if(d[group].length>=64)throw Error(message('invalid'));d[group].push(attemptDraftRow(group));renderForm();return;}
  if(action==='remove-row'){d[control.dataset.group].splice(Number(control.dataset.index),1);renderForm();return;}
  const parts=control.dataset.path?.split('.'),owner=parts?.slice(0,-1).reduce((v,k)=>v[k],d),key=parts?.at(-1),multiple=control.dataset.multiple==='true';
  if(action==='remove-ref'){if(multiple)owner[key].splice(Number(control.dataset.index),1);else owner[key]=null;renderForm();return;}
  if(action==='reference'){
   const target=host.querySelector('[data-attempt-picker]');target.hidden=false;
   const close=()=>{picker?.dispose();picker=null;renderForm();};
   picker=onlineAttemptPicker({host:target,record,remote,esc,recordsOnly:control.dataset.kind==='record',onCancel:close,onChoose:ref=>{
    if(multiple){if(owner[key].length>=20)throw Error(message('invalid'));if(!owner[key].some(r=>r.id===ref.id&&r.kind===ref.kind&&r.revision===ref.revision))owner[key].push(ref);}else owner[key]=ref;close();
   }});controls();
  }
 }
 async function readReference(index){
  if(busy||request||picker)return;const ref=attemptReferences(record.attempt)[index];if(!ref)return;referenceView?.dispose();
  referenceView=onlineAttemptReference({host:host.querySelector('[data-attempt-reference-view]'),recordId:record.id,rootRef:ref,remote,esc,fileUrl,onBusy:value=>{busy=value;controls();}});await referenceView.open();
 }
 function rebase(){
  if(!session||!stale||busy||request||readOnly)return;readForm();const a=structuredClone(attempt()),kind=session.kind;
  let prior=kind==='preparation'?a.preparations.at(-1):a[groups[kind]].find(r=>r.id===session.draft.supersedes);
  if(kind!=='preparation')while(prior){const next=a[groups[kind]].find(r=>r.supersedes===prior.id);if(!next)break;prior=next;}
  if(!prior)throw Error(tr('attemptConflict'));session.draft.supersedes=prior.id;session.attempt=a;stale=false;renderForm();
 }
 function mount(node,value,role){
  host=node;record=value;readOnly=role!=='editor';
  host.innerHTML='<details data-live-attempt><summary>'+esc(message('title'))+'</summary><p>'+esc(message('intro'))+'</p><div class="module-actions"'+(readOnly?' hidden':'')+'>'+button('addPreparation','preparation')+button('addEvent','event')+button('addAssessment','assessment')+'</div><div data-attempt-saved></div><div data-attempt-conflict hidden role="status"><p>'+esc(tr('attemptConflict'))+'</p><button type="button" class="button" data-online-attempt="rebase">'+esc(tr('attemptRebase'))+'</button></div><div data-attempt-edit></div><div data-attempt-reference-view></div></details>';draw();
  host.querySelector('[data-attempt-edit]').insertAdjacentHTML('beforebegin','<p data-attempt-recovered role="status"></p><button type="button" class="button" data-online-attempt="recover" hidden>'+esc(tr('attemptRetryRecovery'))+'</button>');
  host.addEventListener('submit',e=>{e.preventDefault();e.stopPropagation();void save().catch(error=>notify(error.message,true));});
  host.addEventListener('change',e=>{if(session?.kind==='assessment'&&e.target.name==='preparationId'){readForm();session.draft.criterionId=session.attempt.preparations.find(p=>p.id===session.draft.preparationId)?.criteria[0]?.id??'';renderForm();}});
  host.addEventListener('click',e=>{const control=e.target.closest('[data-online-attempt],[data-attempt-form]');if(!control)return;e.preventDefault();e.stopPropagation();void(async()=>{
   if(control.dataset.attemptForm){await formAction(control);return;}const action=control.dataset.onlineAttempt;
   if(action==='read')await readReference(Number(control.dataset.factId));else if(action==='rebase')rebase();else if(action==='recover')await recover();else begin(action,control.dataset.factId);
  })().catch(error=>notify(error.message,true));});
  void recover();
 }
 return {mount,update,save,revision:()=>generation,isDirty:()=>!!session||busy||!!request,isBusy:()=>busy,setReadOnly(){readOnly=true;controls();},dispose(){disposed=true;generation++;picker?.dispose();referenceView?.dispose();}};
}
