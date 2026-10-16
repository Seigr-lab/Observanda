import {emptyAttempt,validAttempt,attemptReferences} from './attempt-model.js';
import {attemptForm,readAttemptForm} from './attempt-form.js';
import {attemptView} from './attempt-view.js';
import {editableRecord} from './workspace-snapshot.js';
import {revisionText} from './revision-model.js';
import {researchTargetPicker} from './research-target-picker.js';
import {materialSourcePicker} from './material-source-picker.js';
import {t} from './i18n/index.js';
import {preparationMethodLinks} from './attempt-workflow.js';
import {attemptDraft,attemptDraftRow} from './attempt-draft.js';

export function attemptUI({state,api,esc,field,showDialog,notify,dirty,render,revisions,openReference,requestClose,getRecord=null}){
 const message=(key,args)=>t('attempts',key,args),text=key=>esc(message(key));
 const record=getRecord??(()=>state.book?.entries.find(r=>r.id===state.selected));
 const button=(key,action,data='')=>'<button type="button" class="button" data-action="attempt-'+action+'" '+data+'>'+text(key)+'</button>';
 const identity=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.selected]);
 const reference=(ref,i)=>'<button type="button" class="text-button" data-action="attempt-open-ref" data-index="'+i+'">'+esc(ref.label)+' · '+esc(ref.revision.slice(0,12))+'</button>';
 let session=null,picker=null,materials=null,choosing=false;
 const valid=()=>session&&session.identity===identity()&&state.page==='editor'&&!state.access?.locked&&!state.storageUnavailable;
 function stop(){picker?.stop();materials?.dispose();picker=null;materials=null;session=null;choosing=false;}
 function guard(){if(!valid())throw Error(message('changed'));}
 function bind(){if(session&&!valid())stop();}
 document.getElementById('dialog').addEventListener('close',stop);
 function isDirty(){const form=document.getElementById('attempt-form');return !!(valid()&&form&&document.getElementById('dialog').open&&revisionText(readAttemptForm(form,structuredClone(session.draft)))!==session.initial);}
 function view(){
  const r=record();if(!r)return '';
  const a=r.attempt??emptyAttempt();
  return '<details class="attempt-editor"'+(r.attempt?' open':'')+'><summary>'+text('title')+'</summary><p>'+text('intro')+'</p><div class="inline-actions">'+button(a.preparations.length?'amendPreparation':'addPreparation','preparation')+button('addEvent','event')+(a.preparations.some(p=>p.criteria.length)?button('addAssessment','assessment'):'')+'</div>'+
   attemptView(r.attempt,esc,{message,reference,correct:(kind,v,label)=>button('correct',kind,'data-id="'+v.id+'" aria-label="'+text('correct')+': '+esc(label)+'"')})+'</details>';
 }
 function renderForm(){
  guard();const s=session;
  showDialog('<div class="attempt-form"><h2 id="dialog-title">'+text(s.kind==='preparation'?(s.draft.supersedes?'amendPreparation':'addPreparation'):s.draft.supersedes?'correct':s.kind==='event'?'addEvent':'addAssessment')+'</h2>'+attemptForm({kind:s.kind,draft:s.draft,attempt:s.attempt,esc,message})+'</div>');
  const form=document.getElementById('attempt-form');
  form.addEventListener('click',event=>{const control=event.target.closest('[data-attempt-form]');if(!control)return;event.preventDefault();event.stopPropagation();void formAction(control).catch(error=>{if(valid())form.querySelector('[data-attempt-error]').textContent=error.message;});});
  form.addEventListener('change',event=>{
   if(event.target.name!=='preparationId'||s.kind!=='assessment')return;
   readAttemptForm(form,s.draft);s.draft.criterionId=s.attempt.preparations.find(p=>p.id===s.draft.preparationId)?.criteria[0]?.id??'';renderForm();
  });
 }
 function closePicker(){picker?.stop();materials?.dispose();picker=null;materials=null;choosing=false;const host=document.querySelector('[data-attempt-picker]');if(host){host.hidden=true;host.replaceChildren();}document.querySelectorAll('#attempt-form button,#attempt-form input,#attempt-form textarea,#attempt-form select').forEach(b=>b.disabled=false);}
 async function formAction(control){
  guard();const form=document.getElementById('attempt-form'),s=session;readAttemptForm(form,s.draft);
  const action=control.dataset.attemptForm;if(action==='cancel'){await requestClose();return;}
  if(choosing)return;
  if(action==='add-row'){
   const group=control.dataset.group;if(s.draft[group].length>=64)throw Error(message('invalid'));s.draft[group].push(attemptDraftRow(group));renderForm();return;
  }
  if(action==='remove-row'){s.draft[control.dataset.group].splice(Number(control.dataset.index),1);renderForm();return;}
  const path=control.dataset.path?.split('.'),multiple=control.dataset.multiple==='true';
  const owner=path?.slice(0,-1).reduce((v,k)=>v[k],s.draft),key=path?.at(-1);
  if(action==='remove-ref'){if(multiple)owner[key].splice(Number(control.dataset.index),1);else owner[key]=null;renderForm();return;}
  if(action==='reference'){
   const host=form.querySelector('[data-attempt-picker]');host.hidden=false;choosing=true;
   form.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);
   const apply=ref=>{guard();if(session!==s)return;if(multiple){if(owner[key].length>=20)throw Error(message('invalid'));if(!owner[key].some(r=>r.id===ref.id&&r.revision===ref.revision&&r.kind===ref.kind))owner[key].push(ref);}else owner[key]=ref;closePicker();renderForm();};
   if(control.dataset.kind==='record'){
    picker=researchTargetPicker({state,api,esc,field,active:()=>valid(),excludeId:()=>state.selected});
    picker.open({root:host,recordsOnly:true,onCancel:closePicker,onChoose:async(item,{signal,stillCurrent})=>{
     const ref=await api('/api/research/materials/pin',{id:item.id,expectedRevision:item.revision},{adopt:false,signal});if(!stillCurrent())return;apply({...ref,label:item.title});
    }});
   }else{
    host.innerHTML='<div data-material-host><input type="hidden" data-value></div>';
    materials=materialSourcePicker({root:host.firstElementChild,call:(name,data,opts)=>api('/api/research/materials/'+name,data,{...opts,adopt:false}),esc,field,label:message('references'),id:'attempt-material',recordId:state.selected,guard,optional:true});
    await materials.ready;guard();if(session!==s)return;
    const use=document.createElement('button');use.type='button';use.className='button';use.textContent=message('useReference');host.append(use);
    use.onclick=async()=>{try{guard();const [ref]=materials.values();if(!ref)throw Error(message('invalid'));const doc=await api('/api/research/materials/read',{ref},{adopt:false});if(valid()&&session===s)apply({...ref,workspaceId:state.book.id,label:doc.title});}catch(error){if(valid())form.querySelector('[data-attempt-error]').textContent=error.message;}};
    const cancel=document.createElement('button');cancel.type='button';cancel.className='button';cancel.textContent=message('cancel');cancel.onclick=closePicker;host.append(cancel);
   }
  }
 }
 async function action(control){
  if(!control.dataset.action?.startsWith('attempt-'))return false;
  const name=control.dataset.action.slice(8),r=record();if(!r)return true;
  if(name==='open-ref'){const ref=attemptReferences(r.attempt)[Number(control.dataset.index)];if(ref)await openReference(ref);return true;}
  if(!revisions()[r.id]){notify(t('recordWorkflow','saveFirst'),true);return true;}
  const a=structuredClone(r.attempt??emptyAttempt()),prior=name==='preparation'?a.preparations.at(-1):a[name==='event'?'events':'assessments'].find(v=>v.id===control.dataset.id),draft=attemptDraft(name,a,r.relations,prior);
  stop();session={identity:identity(),kind:name,attempt:a,draft,initial:revisionText(draft),base:revisionText(r.attempt??null)};renderForm();return true;
 }
 async function submit(form){
  if(form.id!=='attempt-form')return false;guard();if(choosing)throw Error(message('wait'));
  const s=session,r=record();if(revisionText(r.attempt??null)!==s.base)throw Error(message('changed'));
  const item=structuredClone(readAttemptForm(form,s.draft));if(s.kind==='event'&&!item.preparationId)item.preparationId=null;
  const value=structuredClone(s.attempt);value[s.kind==='preparation'?'preparations':s.kind==='event'?'events':'assessments'].push(item);
  if(!validAttempt(value)){form.querySelector('[data-attempt-error]').textContent=message('invalid');return true;}
  const edited=editableRecord(state.book,r.id);edited.attempt=value;
  if(s.kind==='preparation')edited.relations=preparationMethodLinks(edited.relations,value,{label:message('usesMethod')});
  dirty();stop();document.getElementById('dialog').close();render();return true;
 }
 return {view,action,submit,bind,stop,reference,isDirty};
}
