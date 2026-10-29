import {researchContext,ownedAssetURL} from './project-context.js';
import {downloadSize} from './website-file.js';
// Upload intents remain local to the open editor. Durable jobs never edit a record.
import {t,language} from './i18n/index.js';
import './i18n/catalogues/supportEditors.js';
import errorMessages from './locales/en/errors.json' with {type:'json'};
export function mediaImportsUI({state,api,esc,showDialog,notify,apply,busy}){
 const tr=(key,args)=>t('supportEditors',key,args),text=(key,args)=>esc(tr(key,args));
 const errorText=error=>Object.hasOwn(errorMessages,error?.code)?t('errors',error.code):error?.message;
 const jobMessage=job=>job.state==='relocated'?t('errors','JOB_RELOCATED'):job.error?errorText({code:job.error,message:job.message}):job.message;
 const states=new Set(['queued','running','completed','failed','cancelled','relocated']);
 const stateText=state=>states.has(state)?tr('state_'+state):state;
 // Worker stages and error codes stay canonical; only their display changes.
 const stages={queued:'state_queued',preparing:'stage_preparing',completed:'state_completed','Checking original file':'stage_checking','Converting a display copy':'stage_converting','Verifying the display copy':'stage_verifying'};
 const progressText=(job,file)=>file&&job.progress.stage==='Checking original file'?t('websiteMedia','fileProgress',{done:downloadSize(job.progress.done),total:downloadSize(job.progress.total)}):Object.hasOwn(stages,job.progress.stage)?tr(stages[job.progress.stage]):job.progress.stage;
 const fileTarget=intent=>['website-file','website-file-library'].includes(intent?.purpose);
 const endpoint='/api/media-imports/',call=(op,data={})=>api(endpoint+op,data,{adopt:false});
 let timer,watch=0,target=null,context=null,xhr=null,items=[],uploadId=null,receiving=false,cursor=null,next=null,previous=[];
 const button=(label,action,id='',extra='')=>`<button type="button" class="button" data-action="media-import-${action}" data-id="${esc(id)}" ${extra}>${esc(label)}</button>`;
 const guard=()=>{if(context!==researchContext(state)||target?.websiteId!==(state.websiteId??null))throw Error(tr('mediaDestinationChanged'));};
 const destination=input=>({purpose:input.dataset.upload,workspaceId:state.book?.id,websiteId:state.websiteId??null,recordId:state.selected,projectId:input.dataset.projectId,brandTarget:input.dataset.target,page:state.page});
 const stop=()=>{clearTimeout(timer);watch++;};
 const live=token=>token===watch&&context===researchContext(state)&&!state.access?.locked;
 const currentDestination=intent=>intent.workspaceId===state.book?.id&&intent.websiteId===(state.websiteId??null)&&state.page===intent.page&&state.selected===intent.recordId&&[...document.querySelectorAll('input[data-upload]')].some(input=>['purpose','projectId','brandTarget'].every(key=>destination(input)[key]===intent[key]));
 function bind(){
  if(!state.storage?.encrypted)return;
  for(const input of document.querySelectorAll('input[data-upload]')){
   if(input.parentElement.querySelector('[data-action="media-import-open"]'))continue;
   const b=document.createElement('button');b.type='button';b.className='button';b.dataset.action='media-import-open';b.textContent=fileTarget(destination(input))?t('websiteMedia','fileImports'):tr('mediaTitle');
   input.after(b);
  }
 }
 function row(s){
  const j=s.job,ready=j?.state==='completed',compatible=fileTarget(target)?s.kind==='file':s.kind!=='file'&&(['attachment','record-attachment','website','website-library'].includes(target.purpose)||s.kind==='image');
  const status=j?j.state==='running'?tr('mediaRunning',{state:stateText(j.state),stage:progressText(j,s.kind==='file')}):stateText(j.state):s.source?tr('mediaReceived'):tr('mediaInterrupted');
  return `<li data-media-import-row="${s.id}"><strong>${esc(s.name)}</strong><p role="status">${esc(j?.cancelRequested&&j.state==='running'?tr('mediaStoppingStatus',{status}):status)}</p>${j&&jobMessage(j)?`<p>${esc(jobMessage(j))}</p>`:''}<div class="inline-actions">${ready&&compatible?button(s.kind==='file'?t('websiteMedia','useFile'):tr('mediaUse'),'use',s.id):''}${j&&['queued','running'].includes(j.state)?button(tr('mediaCancelProcessing'),'cancel',s.id,j.cancelRequested?'disabled':''):''}${j&&['failed','cancelled'].includes(j.state)?button(tr('mediaRetry'),'retry',s.id):''}${!j&&s.source?button(tr('mediaPrepare'),'finish',s.id):''}${!s.source?`<label>${text('mediaReselect')}<input type="file" data-media-resume="${s.id}"></label>`:''}${s.source?`<a class="button" href="${esc(ownedAssetURL(state,endpoint+'original/'+s.id))}?context=${encodeURIComponent(state.storage.contextId)}" download>${text('mediaDownload')}</a>`:''}</div></li>`;
 }
 async function library(token){
  const result=await call('list',{cursor});if(!live(token)||!document.querySelector('#dialog[open] #media-import-list'))return;items=result.items;next=result.next;
  const pager=document.getElementById('media-import-pages');pager.querySelector('[data-action="media-import-previous"]').disabled=!previous.length;pager.querySelector('[data-action="media-import-next"]').disabled=!next;pager.querySelector('span').textContent=tr('mediaPage',{number:previous.length+1});
  const list=document.getElementById('media-import-list'),html=items.map(row).join('')||'<li>'+text('mediaEmpty')+'</li>';
  if(list.innerHTML!==html){const focused=document.activeElement,action=focused?.dataset.action,id=focused?.dataset.id;list.innerHTML=html;
   if(action&&id)list.querySelector(`[data-action="${action}"][data-id="${id}"]`)?.focus();}
  if(items.some(s=>s.job&&['queued','running'].includes(s.job.state)))timer=setTimeout(()=>library(token).catch(error=>notify(errorText(error),true)),1000);
 }
 async function open(input){
  if(receiving){notify(tr('mediaFinishFirst'),true);return;}
  stop();cursor=null;next=null;previous=[];target=destination(input);context=researchContext(state);
  showDialog(`<section class="job-library"><h2 id="dialog-title">${fileTarget(target)?esc(t('websiteMedia','fileImports')):text('mediaTitle')}</h2><p>${fileTarget(target)?esc(t('websiteMedia','fileHelp')):target.purpose==='record-attachment'?esc(t('recordContent','mediaLibraryHelp')):text('mediaPrivateHelp')}</p><div id="media-upload-status" hidden></div><div id="media-import-pages" class="inline-actions" aria-label="${text('mediaPages')}">${button(tr('mediaNewer'),'previous','','disabled')}<span role="status">${text('mediaPage',{number:1})}</span>${button(tr('mediaOlder'),'next','','disabled')}</div><ul id="media-import-list" class="material-list job-library-items" tabindex="0" aria-label="${text('mediaImported')}"><li>${text('mediaLoading')}</li></ul><div class="dialog-actions">${button(tr('refresh'),'refresh')}${button(tr('close'),'close')}</div></section>`);
  await library(watch);
 }
 function status(text,cancel=false){
  const el=document.getElementById('media-upload-status');if(!el)return;
  el.hidden=!text;
  el.innerHTML=`<span role="status">${esc(text)}</span> ${cancel?button(xhr?tr('mediaCancelUpload'):tr('mediaCancelProcessing'),'active-cancel',uploadId??''):''}`;
 }
 async function observe(id,token,intent){
  const {job}=await call('job',{id});if(!live(token))return;
  if(job.state==='completed'){
   if(currentDestination(intent)){await apply(intent,job.result);status(intent.purpose==='record-attachment'?t('recordContent','mediaAttached'):intent.purpose.startsWith('website-file')?t('websiteMedia','fileAdded'):tr('mediaAdded'));}
   else notify(tr('mediaReady'));return;
  }
  status(jobMessage(job)??(job.cancelRequested?tr('mediaStopping'):job.state==='running'?progressText(job,fileTarget(intent)):job.state==='queued'?tr('mediaWaiting'):tr('mediaCancelled')),['queued','running'].includes(job.state)&&!job.cancelRequested);
  if(['queued','running'].includes(job.state))timer=setTimeout(()=>observe(id,token,intent).catch(error=>notify(errorText(error),true)),500);
 }
 async function upload(input,resume=null){
  const file=input.files[0];if(!file||receiving)return;
  const intent=resume?target:destination(input),kind=resume?.kind??(fileTarget(intent)?'file':!['attachment','record-attachment','website','website-library'].includes(intent.purpose)?'image':file.type==='image/gif'?'video':/\.svg$/i.test(file.name)?'image':file.type.split('/')[0]);
  if(!['image','audio','video','file'].includes(kind))throw Error(tr('mediaChoose'));
  if(resume&&(file.name!==resume.name||file.size!==resume.size))throw Error(tr('mediaSameOriginal'));
  stop();context=researchContext(state);target=intent;const token=watch;receiving=true;busy(true);input.disabled=true;
  if(!resume){document.getElementById('media-upload-status')?.remove();const node=document.createElement('div');node.id='media-upload-status';input.parentElement.after(node);}
  try{
   // Older unencrypted workspaces retain their existing immediate upload API.
   // All newly created workspaces use the durable encrypted path below.
   if(!state.storage.encrypted){
    const response=await fetch(ownedAssetURL(state,'/api/media/'+kind)+(kind==='file'?'?name='+encodeURIComponent(file.name):''),{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Observanda-Workspace':state.storage.contextId},body:file});
    if(!response.ok)throw await response.json();const asset=await response.json();guard();busy(false);if(currentDestination(intent))await apply(intent,asset);return;
   }
   const session=resume??await call('start',{name:file.name,size:file.size,kind});guard();uploadId=session.id;
   await new Promise((resolve,reject)=>{
    const request=xhr=new XMLHttpRequest();request.open('POST',ownedAssetURL(state,endpoint+'receive/'+session.id));request.setRequestHeader('Content-Type','application/octet-stream');request.setRequestHeader('X-Observanda-Workspace',state.storage.contextId);
    request.upload.onprogress=e=>status(tr('mediaUploadProgress',{done:e.loaded.toLocaleString(language()),total:file.size.toLocaleString(language())}),true);
    request.onload=()=>{try{const result=JSON.parse(request.responseText);request.status>=200&&request.status<300?resolve(result):reject(result);}catch{reject(Error(tr('mediaUploadInterrupted')));}};
    request.onerror=()=>reject(Error(tr('mediaUploadInterrupted')));
    request.onabort=()=>reject(Error(tr('mediaUploadCancelled')));
    status(tr('mediaUploading'),true);request.send(file);
   });guard();xhr=null;busy(false);
   await call('finish',{id:session.id});guard();
   if(resume){status('');await library(token);}else await observe(session.id,token,intent);
  }catch(error){status(errorText(error)??tr('mediaUploadRetry'));throw error;}
  finally{xhr=null;receiving=false;busy(false);input.disabled=false;input.value='';}
 }
 async function action(el){
  const name=el.dataset.action;if(!name?.startsWith('media-import-'))return false;
  const op=name.slice('media-import-'.length),id=el.dataset.id;
  if(op==='open'){await open(el.parentElement.querySelector('input[data-upload]'));return true;}
  if(op==='active-cancel'){if(xhr)xhr.abort();else{await call('cancel',{id});status(tr('mediaStopping'));}return true;}
  if(op==='close'){if(receiving){notify(tr('mediaFinishFirst'),true);return true;}stop();document.getElementById('dialog').close();return true;}
  guard();
  if(op==='use'){const s=items.find(s=>s.id===id);if(!currentDestination(target)||s?.job?.state!=='completed'||(fileTarget(target)?s.kind!=='file':s.kind==='file'))throw Error(tr('mediaNotReady'));if(target.purpose==='record-attachment')document.getElementById('dialog').close();await apply(target,s.job.result);stop();document.getElementById('dialog').close();return true;}
  if(['cancel','retry','finish'].includes(op))await call(op,{id});
  if(op==='next'&&next){previous.push(cursor);cursor=next;}
  if(op==='previous'&&previous.length)cursor=previous.pop();
  if(op==='refresh'){cursor=null;next=null;previous=[];}
  if(['refresh','previous','next','cancel','retry','finish'].includes(op)){stop();await library(watch);}return true;
 }
 async function resume(input){const session=items.find(s=>s.id===input.dataset.mediaResume);if(!session)throw Error(tr('mediaReopen'));await upload(input,session);}
 return {bind,upload,action,resume};
}
