// Converting an ordinary book into a lab book is one durable job on the server.
// This view shows its plan, starts or resumes it, and offers the way back. It
// never decides on its own which records move: the server reads both stores.
import {t} from './i18n/index.js';
import './i18n/catalogues/bookConversion.js';

const text=(key,values)=>t('bookConversion',key,values);

export function bookConversionUI({state,api,esc,field,showDialog,notify,report,refresh}){
 let busy=false,plan=null,progress=null;
 const route=(projectId,operation)=>'/api/projects/'+projectId+'/research/books/convert/'+operation;
 const ownerProject=()=>state.projectOwner&&!state.projectOwner.labBookId?state.projectOwner.projectId:null;
 // Only an ordinary book of a project that has its own store can be converted.
 function offer(book){
  if(!book?.id||!ownerProject()||book.projectId!==ownerProject())return '';
  return `<section class="panel book-conversion-offer"><h3>${esc(text('title'))}</h3><p>${esc(text('offer'))}</p><button type="button" class="button" data-action="book-convert-open" data-id="${esc(book.id)}">${esc(text('open'))}</button></section>`;
 }
 const status=conversion=>conversion?`<p role="status">${esc(text('phase_'+conversion.phase,{records:conversion.records,moved:conversion.moved??0}))}</p>`:'';
 function view(){
  const conversion=plan.conversion,phase=conversion?.phase,unfinished=plan.unfinished??[];
  // Only the conversion's own stages carry counts; other service stages are shown as preparation.
  const counted=progress&&['verifying-records','activating-records','returning-records'].includes(progress.stage)&&Number.isSafeInteger(progress.done)&&Number.isSafeInteger(progress.total);
  const running=progress?`<p role="status" aria-live="polite">${esc(counted?text('progress_'+progress.stage,{done:progress.done,total:progress.total}):text('progressPreparing'))}</p>`:'';
  const unfinishedList=unfinished.length?`<details><summary>${esc(text('unfinished',{count:unfinished.length}))}</summary><ul>${unfinished.map(item=>`<li>${esc(text('transfer_'+(['copying','verified','activating','retiring','complete','cancelled'].includes(item.phase)?item.phase:'copying')))}</li>`).join('')}</ul></details>`:'';
  const report=conversion?.report?`<dl class="book-conversion-report"><dt>${esc(text('reportInventory'))}</dt><dd>${conversion.report.inventory}</dd><dt>${esc(text('reportVerified'))}</dt><dd>${conversion.report.verified??0}</dd><dt>${esc(text('reportRemoved'))}</dt><dd>${(conversion.report.removed??[]).length}</dd><dt>${esc(text('reportAdded'))}</dt><dd>${(conversion.report.added??[]).length}</dd></dl>`:'';
  const access=!conversion||phase==='returned'?`<fieldset><legend>${esc(t('labBookDirectory','creationAccess'))}</legend><p>${esc(t('labBookDirectory',state.access?.deviceAvailable?'optionalPassword':'requiredPassword'))}</p>${field(t('labBookDirectory','creationUsername'),'<input name="username" autocomplete="username" maxlength="80">')}${field(t('labBookDirectory','creationPassword'),`<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="1024" ${state.access?.deviceAvailable?'':'required'}>`)}${field(t('labBookDirectory','confirmPassword'),'<input name="confirmPassword" type="password" autocomplete="new-password" maxlength="1024">')}</fieldset>`:'';
  const actions=!conversion||phase==='returned'?`<button class="button primary" ${busy?'disabled':''}>${esc(text('start'))}</button>`:
   ['moving','verified','returning'].includes(phase)?`<button type="button" class="button primary" data-action="book-convert-resume" ${busy?'disabled':''}>${esc(text(phase==='returning'?'resumeReturn':'resume'))}</button>${phase!=='returning'?`<button type="button" class="button" data-action="book-convert-return" ${busy?'disabled':''}>${esc(text('return'))}</button>`:''}`:'';
  showDialog(`<form id="book-conversion-form" data-no-draft><h2 id="dialog-title">${esc(text('title'))}</h2><p><strong>${esc(plan.notebook.title)}</strong></p>
   <p>${esc(text('records',{count:plan.records}))}</p><p>${esc(text('explain'))}</p>${unfinishedList}${status(conversion)}${conversion?.blocked?.length?`<p role="alert">${esc(text('blocked',{count:conversion.blocked.length}))}</p>`:''}${report}${running}${access}
   <p data-book-conversion-error role="alert" hidden></p><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">${esc(text('close'))}</button>${actions}</div></form>`);
 }
 async function load(notebookId){
  // Opening the plan reads the book's store; show the dialog at once while it does.
  showDialog(`<section><h2 id="dialog-title">${esc(text('title'))}</h2><p role="status" aria-live="polite">${esc(text('loading'))}</p><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">${esc(text('close'))}</button></div></section>`);
  plan=await api(route(ownerProject(),'plan'),{workspaceId:state.book.id,notebookId},{adopt:false});view();
 }
 function failed(error){
  const node=document.querySelector('[data-book-conversion-error]');
  if(node){node.textContent=error.message??text('failed');node.hidden=false;node.focus?.();}else report(error);
 }
 async function run(operation,data={}){
  const projectId=ownerProject(),notebookId=plan.notebook.id;busy=true;progress=null;view();
  try{
   if(operation==='start'){
    plan.conversion=await api(route(projectId,'start'),{workspaceId:state.book.id,notebookId,...data},{adopt:false});
    // Like a new lab book, a protected one is unlocked before records move into it.
    if(data.password)await api('/api/projects/'+projectId+'/lab-books/'+notebookId+'/access/unlock',{username:data.username,password:data.password,recovery:''},{adopt:false});
   }
   const result=await api(route(projectId,operation==='return'?'return':'resume'),{workspaceId:state.book.id,notebookId},{adopt:false,onProgress:value=>{progress=value;view();}});
   plan.conversion=result;progress=null;
   if(['switched','returned'].includes(result.phase)){await refresh(projectId,result.phase==='switched'?notebookId:null);notify(text(result.phase==='switched'?'done':'returnedDone'));}
  }catch(error){busy=false;view();failed(error);return;}
  busy=false;view();
 }
 async function action(control){
  const name=control.dataset.action;
  if(name==='book-convert-open'){if(!ownerProject())return true;await load(control.dataset.id);return true;}
  if(!plan||busy||!document.querySelector('#book-conversion-form'))return name?.startsWith('book-convert-');
  if(name==='book-convert-resume'){await run('resume');return true;}
  if(name==='book-convert-return'){await run('return');return true;}
  return false;
 }
 async function submit(form){
  if(form.id!=='book-conversion-form'||!plan||busy)return false;
  const username=form.elements.username?.value??'',password=form.elements.password?.value??'',confirm=form.elements.confirmPassword?.value??'';
  if(password!==confirm){failed({message:t('labBookDirectory','passwordMismatch')});return true;}
  await run('start',{id:crypto.randomUUID(),username,password});return true;
 }
 return {offer,action,submit};
}
