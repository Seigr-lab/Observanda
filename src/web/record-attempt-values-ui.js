import {attemptValueField} from './record-attempt-value.js';
import {attemptDraft,attemptDraftRow} from './attempt-draft.js';
import {attemptForm,readAttemptForm} from './attempt-form.js';
import {attemptView} from './attempt-view.js';
import {emptyAttempt,validAttemptFact} from './attempt-model.js';
import {researchTargetPicker} from './research-target-picker.js';
import {materialSourcePicker} from './material-source-picker.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('attempts',key,args);
const message=(key,args)=>key==='draftHelp'?t('recordValues','attemptDraftHelp'):text(key,args);
const action=(esc,kind,label,prior='')=>'<button type="button" class="button" data-action="record-value-add-attempt" data-kind="'+kind+'" data-prior="'+prior+'">'+esc(label)+'</button>';
export function recordAttemptControls(record,esc,reference,{window=null,navigation}={}){
 const attempt=record.attempt??emptyAttempt();
 return '<section class="record-attempt-values"><div class="inline-actions">'+action(esc,'preparation',text(attempt.preparations.length?'amendPreparation':'addPreparation'))+action(esc,'event',text('addEvent'))+((window?window.hasCriteria:attempt.preparations.some(p=>p.criteria.length))?action(esc,'assessment',text('addAssessment')):'')+'</div>'+attemptView(record.attempt,esc,{reference,window,navigation,correct:(kind,item)=>action(esc,kind,text('correct'),item.id)})+'</section>';
}

// One immutable fact has its own recoverable draft. The existing scientific
// form and source pickers are shared with full-record authoring.
export function recordAttemptView({state,api,esc,field},lifecycle){
 let current=null,picker=null,materials=null,choosing=false,unbind=null,preparationOpen=false,contextLoading=false,request=null;
 const valid=s=>s&&current===s&&s.context===lifecycle.context()&&s.dialog?.open&&state.book?.id===s.base.workspaceId&&!state.access?.locked;
 function guard(s){if(!valid(s))throw Error(text('changed'));}
 function stopPicker(){picker?.stop();materials?.dispose();picker=materials=null;choosing=false;lifecycle.refresh();}
 const context=(base,{prior=null,preparationId=null,offset=0}={},signal)=>api('/api/research/records/values/attempt-context',{workspaceId:base.workspaceId,recordId:base.recordId,storageRevision:base.storageRevision,field:base.field,prior,preparationId,offset},{adopt:false,signal});
 const contextButton=(label,name,data='',disabled=false)=>'<button type="button" class="button" data-attempt-form="'+name+'" '+data+(disabled?' disabled':'')+'>'+esc(label)+'</button>';
 function preparationControl(){
  const s=current,item=s.value.value,definition=s.base.definition,selected=definition.attempt.preparations.find(p=>p.id===item.preparationId),page=definition.preparations;
  const label=p=>text('preparationChoice',{number:(p.position??definition.positions[p.id])+1,description:p.applicability});
  let html='<fieldset data-attempt-preparation><legend>'+esc(text('selectPreparation'))+'</legend><p>'+esc(selected?label(selected):text('noPreparation'))+'</p><input type="hidden" name="preparationId" value="'+esc(item.preparationId??'')+'">';
  if(s.kind==='assessment'&&item.supersedes)return html+'</fieldset>';
  html+=contextButton(text(preparationOpen?'closeChoices':'choosePreparation'),'preparation-toggle');
  if(preparationOpen)html+='<div data-attempt-preparation-choices><p role="status">'+esc(text('preparationRange',{first:page.total?page.offset+1:0,last:page.offset+page.items.length,total:page.total}))+'</p>'+page.items.map(p=>'<section><p>'+esc(label(p))+'</p>'+contextButton(text('usePreparation'),'preparation-select','data-id="'+p.id+'"',s.kind==='assessment'&&!p.hasCriteria)+'</section>').join('')+'<div class="inline-actions">'+contextButton(text('previousPreparations'),'preparation-page','data-offset="'+Math.max(0,page.offset-4)+'"',page.offset===0)+contextButton(text('nextPreparations'),'preparation-page','data-offset="'+(page.next??page.offset)+'"',page.next===null)+'</div>'+(s.kind==='event'?contextButton(text('noPreparation'),'preparation-clear'):'')+'</div>';
  return html+'</fieldset>';
 }
 function markup(){const s=current;return s.value.value?'<div class="attempt-form">'+attemptForm({kind:s.kind,draft:s.value.value,attempt:s.base.definition.attempt,esc,message,actions:false,preparationControl:s.kind==='preparation'?null:preparationControl()})+'</div>':'<p>'+esc(t('recordValues','attemptAbsent'))+'</p>';}
 function redraw(){stopPicker();current.dialog.querySelector('[data-writing-fields]').innerHTML=markup();}
 function changed(){current.changed();}
 function read(){const form=current?.dialog?.querySelector('#attempt-form');if(form){readAttemptForm(form,current.value.value);if(current.kind==='event'&&!current.value.value.preparationId)current.value.value.preparationId=null;}}
 function feedback(s,error){if(valid(s))s.dialog.querySelector('[data-attempt-error]').textContent=error.message;}
 async function action(control){
  const s=current;guard(s);if(choosing||contextLoading)return;read();const item=s.value.value,name=control.dataset.attemptForm;
  if(name==='preparation-toggle'){preparationOpen=!preparationOpen;redraw();return;}
  if(name==='preparation-clear'){item.preparationId=null;preparationOpen=false;changed();redraw();return;}
  if(name==='preparation-page'||name==='preparation-select'){
   contextLoading=true;request?.abort();const controller=new AbortController();request=controller;
   s.dialog.querySelector('#attempt-form').querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);lifecycle.refresh();
   try{
    const definition=await context(s.base,{prior:item.supersedes,preparationId:name==='preparation-select'?control.dataset.id:item.preparationId,offset:name==='preparation-page'?Number(control.dataset.offset):s.base.definition.preparations.offset},controller.signal);
    guard(s);s.base.definition=definition;
    if(name==='preparation-select'){item.preparationId=control.dataset.id;if(s.kind==='assessment')item.criterionId=definition.attempt.preparations.find(p=>p.id===item.preparationId)?.criteria[0]?.id??'';preparationOpen=false;changed();}
   }finally{if(current===s&&request===controller){contextLoading=false;request=null;redraw();}}
   return;
  }
  if(name==='add-row'){if(item[control.dataset.group].length>=64)throw Error(text('invalid'));item[control.dataset.group].push(attemptDraftRow(control.dataset.group));changed();redraw();return;}
  if(name==='remove-row'){item[control.dataset.group].splice(Number(control.dataset.index),1);changed();redraw();return;}
  const path=control.dataset.path?.split('.'),owner=path?.slice(0,-1).reduce((v,k)=>v[k],item),key=path?.at(-1),multiple=control.dataset.multiple==='true';
  if(name==='remove-ref'){if(multiple)owner[key].splice(Number(control.dataset.index),1);else owner[key]=null;changed();redraw();return;}
  if(name!=='reference')return;
  const form=s.dialog.querySelector('#attempt-form'),host=form.querySelector('[data-attempt-picker]');host.hidden=false;choosing=true;
  form.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);lifecycle.refresh();
  const cancel=()=>{if(valid(s))redraw();};
  const apply=ref=>{guard(s);if(multiple){if(!owner[key].some(r=>r.id===ref.id&&r.revision===ref.revision&&r.kind===ref.kind)){if(owner[key].length>=20)throw Error(text('invalid'));owner[key].push(ref);}}else owner[key]=ref;changed();redraw();};
  try{
   if(control.dataset.kind==='record'){
    picker=researchTargetPicker({state,api,esc,field,active:()=>valid(s),excludeId:()=>s.base.recordId});
    picker.open({root:host,recordsOnly:true,onCancel:cancel,onChoose:async(item,{signal,stillCurrent})=>{
     const ref=await api('/api/research/materials/pin',{id:item.id,expectedRevision:item.revision},{adopt:false,signal});
     if(!stillCurrent()||!valid(s))return;
     if(ref.id!==item.id||ref.revision!==item.revision||ref.workspaceId!==s.base.workspaceId||ref.kind!=='record')throw Error(text('changed'));
     apply({...ref,label:item.title});
    }});
   }else{
    host.innerHTML='<div data-material-host><input type="hidden" data-value></div>';
    materials=materialSourcePicker({root:host.firstElementChild,call:(name,data,opts)=>api('/api/research/materials/'+name,data,{...opts,adopt:false}),esc,field,label:text('references'),id:'selected-attempt-material',recordId:s.base.recordId,guard:()=>guard(s),optional:true});
    const active=materials;await active.ready;if(!valid(s)||materials!==active)return;
    const use=document.createElement('button');use.type='button';use.className='button';use.textContent=text('useReference');host.append(use);
    use.onclick=async()=>{try{guard(s);const [ref]=active.values();if(!ref)throw Error(text('invalid'));const doc=await api('/api/research/materials/read',{ref},{adopt:false});if(valid(s)&&materials===active)apply({...ref,workspaceId:s.base.workspaceId,label:doc.title});}catch(error){feedback(s,error);}};
    const close=document.createElement('button');close.type='button';close.className='button';close.textContent=text('cancel');close.onclick=cancel;host.append(close);
   }
  }catch(error){if(valid(s)){redraw();feedback(s,error);}}
 }
 return {
  async prepare(base,value,input){base.definition=await context(base,{prior:input.prior||value.value?.supersedes||null,preparationId:value.value?.preparationId||null});},
  initialize(base,value,input,changed){
   if(value.value!==null)return;const {kind,group,id}=attemptValueField(base.field),attempt=base.definition.attempt;
   const prior=kind==='preparation'?attempt.preparations.at(-1):attempt[group].find(item=>item.id===input.prior);
   if(input.prior&&!prior)throw Error(text('changed'));
   value.value=attemptDraft(kind,attempt,base.definition.methods,prior,{uuid:()=>id});
   if(kind==='event'&&!value.value.preparationId)value.value.preparationId=null;changed();
  },
  fields(base,value,changed){current={base,value,changed,kind:attemptValueField(base.field).kind,context:lifecycle.context(),dialog:null};return markup();},
  bind(dialog){
   if(!current)return;current.dialog=dialog;
   const click=event=>{const control=event.target.closest('[data-attempt-form]');if(!control?.closest('[data-writing-fields]'))return;event.preventDefault();event.stopPropagation();if(control.disabled||control.closest('[inert]'))return;const s=current;void action(control).catch(error=>feedback(s,error));};
   const submit=event=>{if(event.target.id!=='attempt-form')return;event.preventDefault();event.stopPropagation();dialog.querySelector('[data-writing="save"]').click();};
   dialog.addEventListener('click',click);dialog.addEventListener('submit',submit);unbind=()=>{dialog.removeEventListener('click',click);dialog.removeEventListener('submit',submit);};
  },
  input(element){
   if(!current||!element.closest('#attempt-form')||choosing)return false;read();
   if(current.kind==='assessment'&&element.name==='preparationId'){
    current.value.value.criterionId=current.base.definition.attempt.preparations.find(p=>p.id===element.value)?.criteria[0]?.id??'';redraw();
   }
   return true;
  },
  busy:()=>choosing||contextLoading,
  validate(){
   if(!current?.value.value)return false;read();const s=current,fact=attemptValueField(s.base.field);
   if(s.base.value?.value!=null){feedback(s,Error(t('errors','ATTEMPT_IMMUTABLE')));return false;}
   if(!validAttemptFact(fact.kind,s.value.value,{preparations:s.base.definition.attempt.preparations})){feedback(s,Error(text('invalid')));return false;}return true;
  },
  rebase(base,value){
   if(base.value.value!==null)return;
   const fact=attemptValueField(base.field),item=value.value;let prior=item.supersedes;
   if(fact.kind==='preparation')prior=base.definition.latestPreparationId;
   else if(prior)prior=base.definition.correctionId;
   if(prior!==item.supersedes){item.supersedes=prior;item.reason='';}
  },
  preview:base=>'<p>'+esc(t('recordValues','attemptConflictHelp'))+'</p>'+attemptView(base.definition.attempt,esc,{window:{preparationPositions:base.definition.positions,visiblePreparations:base.definition.attempt.preparations.map(p=>p.id),superseded:[]}}),
  release(){request?.abort();request=null;contextLoading=false;preparationOpen=false;stopPicker();unbind?.();unbind=null;current=null;}
 };
}
