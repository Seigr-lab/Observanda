import {onlinePreparations} from './online-preparations.js';
import {t} from './i18n/index.js';
import {attemptForm,readAttemptForm} from './attempt-form.js';
import {attemptDraft,attemptDraftRow} from './attempt-draft.js';
import {attemptView} from './attempt-view.js';
import {emptyAttempt,validAttemptFact,attemptReferences} from './attempt-model.js';
import {revisionText} from './revision-model.js';
import {onlineAttemptPicker} from './online-attempt-picker.js';
import {onlineAttemptReference} from './online-attempt-reference.js';
const groups={preparation:'preparations',event:'events',assessment:'assessments'};
const tr=(key,values)=>t('online',key,values);
const message=(key,values)=>['save','draftHelp'].includes(key)?tr(key==='save'?'attemptSave':'attemptDraftHelp'):t('attempts',key,values);

export function onlineAttempts({remote,commands,esc,notify,fileUrl,figureURL}){
 let host,record,readOnly=false,disposed=false,busy=false,session=null,request=null,picker=null,referenceView=null,stale=false,recoveryFailed=false,latestKey='',generation=0,snapshot=null,windows={},preparationEditor=null,readGeneration=0,refreshing=false;
 const button=(key,action,id='')=>'<button type="button" class="button" data-online-attempt="'+action+'" data-fact-id="'+esc(id)+'">'+esc(message(key))+'</button>';
 const attempt=()=>record.attempt??emptyAttempt();
 const preparation=()=>preparationEditor??=onlinePreparations({remote,commands,esc,notify,record,workspaceId:snapshot.workspaceId,onSaved:()=>refresh(),onClosed:()=>{if(!disposed)controls();}});
 async function refresh(){const at=generation,read=++readGeneration;refreshing=true;try{const result=await remote('attempt-window',{recordId:record.id,windows:{...windows}});if(disposed||at!==generation||read!==readGeneration)return;snapshot=result;record.attempt=result.attempt;draw();}finally{if(read===readGeneration)refreshing=false;}}
 function navigation(name){const page=snapshot?.pages[name];if(!page)return '';const button=(key,offset,disabled)=>'<button type="button" class="button" data-online-attempt="window" data-group="'+esc(name)+'" data-offset="'+offset+'" data-unavailable="'+disabled+'"'+(disabled?' disabled':'')+'>'+esc(message(key))+'</button>';return '<p>'+esc(message('nestedRange',{first:page.total?page.offset+1:0,last:page.offset+page.count,total:page.total}))+'</p>'+button('nestedPrevious',Math.max(0,page.offset-4),page.offset===0)+button('nestedNext',page.offset+4,page.offset+page.count>=page.total);}
 async function context(kind,id,{prior=null,preparationId=null,offset=0,criterionOffset=0,criterionId=null}={}){return remote('attempt-context',{recordId:record.id,storageRevision:snapshot.storageRevision,field:'attempt:'+kind+':'+id,prior,preparationId,offset,criterionOffset,criterionId});}
 function contextControls(){const s=session,p=s.definition.preparations,control=(key,action,data='',disabled=false)=>'<button type="button" class="button" data-attempt-form="'+action+'" data-unavailable="'+disabled+'" '+data+(disabled?' disabled':'')+'>'+esc(message(key))+'</button>';return '<fieldset><legend>'+esc(message('selectPreparation'))+'</legend>'+p.items.map(row=>control('usePreparation','select-preparation','data-id="'+row.id+'"',s.kind==='assessment'&&!row.hasCriteria)+'<span>'+esc(row.applicability)+'</span>').join('')+control('previousPreparations','preparation-page','data-offset="'+Math.max(0,p.offset-4)+'"',p.offset===0)+control('nextPreparations','preparation-page','data-offset="'+(p.next??p.offset)+'"',p.next===null)+(s.kind==='event'?control('noPreparation','clear-preparation'):'')+'</fieldset>';}
 function criteriaControls(){const page=session.definition.criteria;if(!page||session.draft.supersedes)return '';const control=(key,offset,disabled)=>'<button type="button" class="button" data-attempt-form="criterion-page" data-offset="'+offset+'" data-unavailable="'+disabled+'"'+(disabled?' disabled':'')+'>'+esc(message(key))+'</button>';return '<p>'+esc(message('nestedRange',{first:page.total?page.offset+1:0,last:page.offset+page.items.length,total:page.total}))+'</p>'+control('previousCriteria',Math.max(0,page.offset-4),page.offset===0)+control('nextCriteria',page.next??page.offset,page.next===null);}

 function controls(){
  if(!host)return;host.setAttribute('aria-busy',String(busy));
  for(const control of host.querySelectorAll('button,input,textarea,select')){
   if(control.closest('[data-attempt-picker],[data-attempt-reference-view]'))continue;
   control.disabled=!snapshot||busy||!!request||!!picker||(readOnly&&control.dataset.onlineAttempt!=='window')||recoveryFailed||control.dataset.unavailable==='true';
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
  const a=attempt(),key=revisionText([a,snapshot?.window,snapshot?.pages]);if(key!==latestKey){
   latestKey=key;host.querySelector('[data-attempt-saved]').innerHTML=attemptView(record.attempt,esc,{message,window:snapshot?.window,navigation,reference:(ref,i)=>'<button type="button" class="text-button" data-online-attempt="read" data-fact-id="'+i+'">'+esc(ref.label)+'</button>',correct:readOnly?null:(kind,item,label)=>button('correct',kind,item.id).replace('data-fact-id=','aria-label="'+esc(message('correct')+': '+label)+'" data-fact-id=')});
  }
  host.querySelector('[data-online-attempt="preparation"]').textContent=message(a.preparations.length?'amendPreparation':'addPreparation');host.querySelector('[data-online-attempt="assessment"]').hidden=!(snapshot?.window?snapshot.window.hasCriteria:a.preparations.some(p=>p.criteria.length));controls();
 }
 function update(value,relations,version=generation){if(disposed||version!==generation)return;record.attempt=value??undefined;record.relations=relations;draw();}
 function readForm(){if(session){const form=host.querySelector('form');if(form)readAttemptForm(form,session.draft);}}
 function renderForm(){
  if(disposed||!session)return;host.querySelector('[data-attempt-edit]').innerHTML=attemptForm({kind:session.kind,draft:session.draft,attempt:session.attempt,esc,message,preparationControl:contextControls(),criterionControl:session.kind==='assessment'?criteriaControls():''});controls();
 }
 function cancel(){picker?.dispose();picker=null;session=null;request=null;stale=false;host.querySelector('[data-attempt-edit]').replaceChildren();host.querySelector('[data-attempt-recovered]').textContent='';controls();}
 async function recover(){
  if(busy||session)return;busy=true;controls();
  try{const {pending}=await commands.pending();if(disposed)return;recoveryFailed=false;
   if(pending&&['preparation-change','preparation-rebase','preparation-checkpoint'].includes(pending.command.kind)){await preparation().recover(pending);return;}
   if(pending){request=pending.command;const definition=await context(request.kind,request.id,{prior:request.item.supersedes,preparationId:request.item.preparationId,criterionId:request.item.criterionId??null});session={kind:request.kind,draft:structuredClone(request.item),attempt:definition.attempt,definition};host.querySelector('[data-attempt-recovered]').textContent=tr('attemptRecovered');host.querySelector('[data-live-attempt]').open=true;renderForm();}
   host.querySelector('[data-online-attempt="recover"]').hidden=true;
  }catch(error){if(!disposed){recoveryFailed=true;host.querySelector('[data-attempt-recovered]').textContent=tr('attemptRecoveryFailed');host.querySelector('[data-online-attempt="recover"]').hidden=false;notify(error.message,true);}}
  finally{busy=false;if(!disposed)controls();}
 }
 async function begin(kind,id){
  if(session||busy||readOnly||recoveryFailed||preparationEditor?.isDirty())throw Error(tr('attemptFinish'));if(kind==='preparation')return preparation().open();
  busy=true;controls();try{const next=crypto.randomUUID(),definition=await context(kind,next,{prior:id||null}),a=definition.attempt,prior=a[groups[kind]].find(v=>v.id===id);session={kind,definition,attempt:a,draft:attemptDraft(kind,a,record.relations,prior,{uuid:()=>next})};stale=false;renderForm();host.querySelector('form input,form textarea,form select')?.focus();}finally{busy=false;controls();}
 }
 async function save(){
  if(preparationEditor?.isDirty())return preparationEditor.save();if(!session||disposed)return;if(busy||picker||readOnly||stale)throw Error(tr('attemptFinish'));const form=host.querySelector('form');
  if(!request){
   if(!form.reportValidity())throw Error(message('invalid'));readForm();const item=structuredClone(session.draft);if(session.kind==='event'&&!item.preparationId)item.preparationId=null;
   if(!validAttemptFact(session.kind,item,{preparations:session.attempt.preparations}))throw Error(message('invalid'));
   request={recordId:record.id,id:item.id,kind:session.kind,item};
  }
  busy=true;generation++;controls();try{
   const response=await commands.send(request);await commands.acknowledge(request.id);
   if(response.rejected){request=null;throw Object.assign(Error(response.rejected.message),{code:response.rejected.code});}
   request=null;cancel();notify(tr('attemptSaved'));
   await refresh();
  }catch(error){
   if(request){try{const {pending}=await commands.pending();if(!pending||pending.command.id!==request.id)request=null;}catch{/* Keep the original request when local storage cannot establish its state. */}}
   if(error.code==='RECORD_CHANGED'&&!request){await refresh();if(!disposed)stale=true;throw Error(tr('attemptConflict'));}throw error;
  }finally{busy=false;generation++;controls();}
 }
 async function formAction(control){
  if(!session||busy||request)return;const action=control.dataset.attemptForm;if(action==='cancel'){cancel();return;}if(readOnly||picker)return;readForm();const d=session.draft;
  if(['preparation-page','select-preparation','criterion-page','clear-preparation'].includes(action)){
   if(action==='clear-preparation'){d.preparationId=null;renderForm();return;}busy=true;controls();try{const definition=await context(session.kind,d.id,{prior:d.supersedes,preparationId:action==='select-preparation'?control.dataset.id:d.preparationId,offset:action==='preparation-page'?Number(control.dataset.offset):session.definition.preparations.offset,criterionOffset:action==='criterion-page'?Number(control.dataset.offset):0,criterionId:action==='select-preparation'?null:d.criterionId??null});session.definition=definition;session.attempt=definition.attempt;if(action==='select-preparation'){d.preparationId=control.dataset.id;if(session.kind==='assessment')d.criterionId=definition.attempt.preparations.find(p=>p.id===d.preparationId)?.criteria[0]?.id??'';}renderForm();}finally{busy=false;controls();}return;
  }
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
  referenceView=onlineAttemptReference({host:host.querySelector('[data-attempt-reference-view]'),recordId:record.id,rootRef:ref,remote,esc,fileUrl,figureURL,onBusy:value=>{busy=value;controls();}});await referenceView.open();
 }
 async function rebase(){
  if(!session||!stale||busy||request||readOnly)return;readForm();busy=true;controls();
  try{const d=session.draft,definition=await context(session.kind,d.id,{prior:d.supersedes,preparationId:d.preparationId,criterionId:d.criterionId??null});if(!definition.correctionId)throw Error(tr('attemptConflict'));d.supersedes=definition.correctionId;session.definition=definition;session.attempt=definition.attempt;stale=false;renderForm();}finally{busy=false;controls();}
 }
 function mount(node,value,role){
  host=node;record=value;readOnly=role!=='editor';
  host.innerHTML='<details data-live-attempt><summary>'+esc(message('title'))+'</summary><p>'+esc(message('intro'))+'</p><div class="module-actions"'+(readOnly?' hidden':'')+'>'+button('addPreparation','preparation')+button('addEvent','event')+button('addAssessment','assessment')+'</div><div data-attempt-saved></div><div data-attempt-conflict hidden role="status"><p>'+esc(tr('attemptConflict'))+'</p><button type="button" class="button" data-online-attempt="rebase">'+esc(tr('attemptRebase'))+'</button></div><div data-attempt-edit></div><div data-attempt-reference-view></div></details>';draw();
  host.querySelector('[data-attempt-edit]').insertAdjacentHTML('beforebegin','<p data-attempt-recovered role="status"></p><button type="button" class="button" data-online-attempt="recover" hidden>'+esc(tr('attemptRetryRecovery'))+'</button>');
  host.addEventListener('submit',e=>{e.preventDefault();e.stopPropagation();void save().catch(error=>notify(error.message,true));});
  host.addEventListener('change',e=>{if(session?.kind==='assessment'&&e.target.name==='preparationId'){readForm();session.draft.criterionId=session.attempt.preparations.find(p=>p.id===session.draft.preparationId)?.criteria[0]?.id??'';renderForm();}});
  host.addEventListener('click',e=>{const control=e.target.closest('[data-online-attempt],[data-attempt-form]');if(!control)return;e.preventDefault();e.stopPropagation();void(async()=>{
   if(control.dataset.attemptForm){await formAction(control);return;}const action=control.dataset.onlineAttempt;
   if(action==='read')await readReference(Number(control.dataset.factId));else if(action==='rebase')await rebase();else if(action==='recover')await recover();else if(action==='window'){if(session||busy)return;windows[control.dataset.group]=Number(control.dataset.offset);await refresh();}else await begin(action,control.dataset.factId);
  })().catch(error=>notify(error.message,true));});
  void refresh().then(()=>recover()).catch(error=>notify(error.message,true));
 }
 return {mount,update,save,revision:()=>generation,updateRevision:revision=>{if(snapshot&&snapshot.storageRevision!==revision&&!busy&&!refreshing)void refresh().catch(error=>notify(error.message,true));},isDirty:()=>!!session||busy||!!request||!!preparationEditor?.isDirty(),isBusy:()=>busy||!!preparationEditor?.isBusy(),setReadOnly(){readOnly=true;preparationEditor?.setReadOnly();controls();},dispose(){disposed=true;generation++;picker?.dispose();referenceView?.dispose();preparationEditor?.dispose();}};
}
