import {calculatorResultClient,savedCalculator} from './calculator-result-client.js';
import {moduleReferenceClient} from './modules/reference-client.js';
import {moduleReferencePicker} from './modules/reference-picker.js';
import {t} from './i18n/index.js';
const tr=(key,values)=>t('calculatorResults',key,values);
export function calculatorResultUI(services,{current}){
 const {state,api,esc,field,notify}=services;let selected=null,session=null,timer=null;
 const active=()=>state.page==='module'&&state.moduleId==='scientific-calculator';
 const client=calculatorResultClient({...services,current,active});
 const references=moduleReferenceClient({state,api,access:services.access,active,identity:()=>[state.modulePath,current()?.id,current()?.expectedRevision,current()?.data]});
 const button=(key,action,attrs='')=>'<button type="button" class="button" data-calculator-result="'+action+'" '+attrs+'>'+esc(tr(key))+'</button>';
 const valid=s=>session===s&&s.dialog.open&&s.captured.current();
 function stop(){clearTimeout(timer);selected=null;picker.stop();client.cancel();references.cancel();const old=session;session=null;old?.dialog.remove();}
 const picker=moduleReferencePicker({state,client:references,esc,field,current,onChoose:async(target,{stillCurrent})=>{
  if(!selected?.current()||!stillCurrent())throw new DOMException('Calculator selection changed','AbortError');
  const captured=selected,dest=client.destination(target),draft=current(),dialog=document.createElement('dialog');dialog.dataset.calculatorResult='';dialog.setAttribute('aria-label',tr('working'));
  const s=session={captured,dest,dialog,recipeId:crypto.randomUUID(),jobId:crypto.randomUUID(),title:tr('title',{name:draft.data.name,number:captured.expressionIndex+1}),job:null,error:null,busy:false};
  dialog.innerHTML='<h2>'+esc(tr('working'))+'</h2><p>'+esc(tr('destination',{title:dest.title}))+'</p><p>'+esc(tr(captured.approximate?'scopeApproximate':'scope'))+'</p><p data-result-status role="status"></p><p data-result-error role="alert" hidden></p><p class="muted" data-result-background>'+esc(tr('background'))+'</p><div class="dialog-actions">'+button('cancel','cancel','hidden')+button('retry','retry','hidden')+button('check','check','hidden')+button('open','open','hidden')+button('close','close')+'</div>';
  dialog.addEventListener('click',event=>{const node=event.target.closest('[data-calculator-result]');if(!node||node===dialog)return;event.stopPropagation();void action(s,node.dataset.calculatorResult);});dialog.addEventListener('close',()=>{if(session===s)stop();});document.body.append(dialog);dialog.showModal();void retain(s);
 },typeLabel:()=>tr('record')});
 function paint(s){if(!valid(s))return;const job=s.job,state=job?.state;
  s.dialog.querySelector('[data-result-status]').textContent=tr(state==='completed'?(s.captured.approximate?'completedApproximate':'completed'):state==='cancelled'?'cancelled':state==='failed'?'failed':state==='queued'?'queued':s.captured.approximate?'runningApproximate':'running');
  s.dialog.querySelector('[data-result-background]').textContent=tr(state==='completed'?'backgroundCompleted':['failed','cancelled'].includes(state)?'backgroundStopped':'background');
  const error=s.dialog.querySelector('[data-result-error]');error.textContent=s.error?.message==='CALCULATOR_RESULT_RESPONSE'?tr('invalid'):s.error?.message??job?.message??'';error.hidden=!error.textContent;
  const cancel=s.dialog.querySelector('[data-calculator-result="cancel"]'),retry=s.dialog.querySelector('[data-calculator-result="retry"]');cancel.hidden=!job||!['queued','running'].includes(state);cancel.disabled=s.busy||job?.cancelRequested;retry.hidden=!(!job&&s.error||['failed','cancelled'].includes(state));retry.disabled=s.busy;const check=s.dialog.querySelector('[data-calculator-result="check"]');check.hidden=!s.error||!['queued','running'].includes(state);check.disabled=s.busy;s.dialog.querySelector('[data-calculator-result="open"]').hidden=state!=='completed';
 }
 async function receive(s,result){if(!valid(s))return;s.job=result.job;s.error=null;paint(s);clearTimeout(timer);if(['queued','running'].includes(s.job.state))timer=setTimeout(async()=>{try{await receive(s,await client.status(s.captured,s.dest,s.jobId));}catch(error){failure(s,error);}},500);}
 function failure(s,error){if(!valid(s)||error.name==='AbortError')return;s.error=error;paint(s);}
 async function retain(s){if(!valid(s)||s.busy)return;s.busy=true;s.error=null;paint(s);try{await receive(s,await client.retain(s.captured,s.dest,s));}catch(error){failure(s,error);}finally{if(valid(s)){s.busy=false;paint(s);}}}
 async function action(s,name){if(!valid(s))return;if(name==='close'){stop();return;}if(name==='open'){if(s.busy)return;s.busy=true;paint(s);const target={workspaceId:s.dest.workspaceId,type:'record',id:s.dest.recordId};try{await services.openReference?.(target);if(session===s)stop();}catch(error){failure(s,error);}finally{if(valid(s)){s.busy=false;paint(s);}}return;}if(s.busy)return;if(name==='check'){clearTimeout(timer);s.busy=true;s.error=null;paint(s);try{await receive(s,await client.status(s.captured,s.dest,s.jobId));}catch(error){failure(s,error);}finally{if(valid(s)){s.busy=false;paint(s);}}return;}if(name==='retry'&&!s.job){await retain(s);return;}if(!['retry','cancel'].includes(name))return;clearTimeout(timer);s.busy=true;paint(s);try{await receive(s,await client.control(s.captured,s.dest,s.jobId,name==='retry'?'retry-job':'cancel-job'));}catch(error){failure(s,error);}finally{if(valid(s)){s.busy=false;paint(s);}}}
 return {available:()=>state.storage?.researchStorage==='catalogue'&&state.storage.researchFormatVersion===21,
  open(index,{approximate=false}={}){stop();if(!savedCalculator(current())){notify(tr('saved'));return;}try{if(approximate&&current()?.data.engine!==4)throw Error('CALCULATOR_RESULT_SAVED');selected={...client.capture(index),approximate};}catch{notify(tr('unsupported'));return;}picker.open({title:tr(approximate?'chooseApproximate':'choose'),types:['record']});},
  label:({approximate=false}={})=>tr(approximate?'retainApproximate':'retain'),stop,sync(){picker.sync();if(selected&&!selected.current()||session&&!valid(session))stop();}
 };
}
