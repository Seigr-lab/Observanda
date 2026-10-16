import {researchContext,ownedAssetURL} from './project-context.js';
import {downloadSize} from './website-file.js';
// Upload intents remain local to the open editor. Durable jobs never edit a record.
import {t} from './i18n/index.js';
export function mediaImportsUI({state,api,esc,showDialog,notify,apply,busy}){
 const progressText=(job,file)=>file&&job.progress.stage==='Checking original file'?t('websiteMedia','fileProgress',{done:downloadSize(job.progress.done),total:downloadSize(job.progress.total)}):job.progress.stage;
 const fileTarget=intent=>['website-file','website-file-library'].includes(intent?.purpose);
 const endpoint='/api/media-imports/',call=(op,data={})=>api(endpoint+op,data,{adopt:false});
 let timer,watch=0,target=null,context=null,xhr=null,items=[],uploadId=null,receiving=false,cursor=null,next=null,previous=[];
 const button=(label,action,id='',extra='')=>`<button type="button" class="button" data-action="media-import-${action}" data-id="${esc(id)}" ${extra}>${label}</button>`;
 const guard=()=>{if(context!==researchContext(state)||target?.websiteId!==(state.websiteId??null))throw Error('The destination changed. Reopen the imports in the intended editor.');};
 const destination=input=>({purpose:input.dataset.upload,workspaceId:state.book?.id,websiteId:state.websiteId??null,recordId:state.selected,projectId:input.dataset.projectId,brandTarget:input.dataset.target,page:state.page});
 const stop=()=>{clearTimeout(timer);watch++;};
 const live=token=>token===watch&&context===researchContext(state)&&!state.access?.locked;
 const currentDestination=intent=>intent.workspaceId===state.book?.id&&intent.websiteId===(state.websiteId??null)&&state.page===intent.page&&state.selected===intent.recordId&&[...document.querySelectorAll('input[data-upload]')].some(input=>['purpose','projectId','brandTarget'].every(key=>destination(input)[key]===intent[key]));
 function bind(){
  if(!state.storage?.encrypted)return;
  for(const input of document.querySelectorAll('input[data-upload]')){
   if(input.parentElement.querySelector('[data-action="media-import-open"]'))continue;
   const b=document.createElement('button');b.type='button';b.className='button';b.dataset.action='media-import-open';b.textContent=fileTarget(destination(input))?t('websiteMedia','fileImports'):'Media imports';
   input.after(b);
  }
 }
 function row(s){
  const j=s.job,ready=j?.state==='completed',compatible=fileTarget(target)?s.kind==='file':s.kind!=='file'&&(['attachment','record-attachment','website','website-library'].includes(target.purpose)||s.kind==='image');
  const status=j?j.state+(j.state==='running'?' - '+progressText(j,s.kind==='file'):''):s.source?'Original received':'Upload interrupted';
  return `<li data-media-import-row="${s.id}"><strong>${esc(s.name)}</strong><p role="status">${esc(status)}${j?.cancelRequested&&j.state==='running'?' - stopping':''}</p>${j?.message?`<p>${esc(j.message)}</p>`:''}<div class="inline-actions">${ready&&compatible?button(s.kind==='file'?esc(t('websiteMedia','useFile')):'Use media','use',s.id):''}${j&&['queued','running'].includes(j.state)?button('Cancel processing','cancel',s.id,j.cancelRequested?'disabled':''):''}${j&&['failed','cancelled'].includes(j.state)?button('Retry processing','retry',s.id):''}${!j&&s.source?button('Prepare media','finish',s.id):''}${!s.source?`<label>Reselect original file<input type="file" data-media-resume="${s.id}"></label>`:''}${s.source?`<a class="button" href="${esc(ownedAssetURL(state,endpoint+'original/'+s.id))}?context=${encodeURIComponent(state.storage.contextId)}" download>Download original</a>`:''}</div></li>`;
 }
 async function library(token){
  const result=await call('list',{cursor});if(!live(token)||!document.querySelector('#dialog[open] #media-import-list'))return;items=result.items;next=result.next;
  const pager=document.getElementById('media-import-pages');pager.querySelector('[data-action="media-import-previous"]').disabled=!previous.length;pager.querySelector('[data-action="media-import-next"]').disabled=!next;pager.querySelector('span').textContent='Page '+(previous.length+1);
  const list=document.getElementById('media-import-list'),html=items.map(row).join('')||'<li>No media imports yet.</li>';
  if(list.innerHTML!==html){const focused=document.activeElement,action=focused?.dataset.action,id=focused?.dataset.id;list.innerHTML=html;
   if(action&&id)list.querySelector(`[data-action="${action}"][data-id="${id}"]`)?.focus();}
  if(items.some(s=>s.job&&['queued','running'].includes(s.job.state)))timer=setTimeout(()=>library(token).catch(error=>notify(error.message,true)),1000);
 }
 async function open(input){
  if(receiving){notify('Finish or cancel the current upload first.',true);return;}
  stop();cursor=null;next=null;previous=[];target=destination(input);context=researchContext(state);
  showDialog(`<section class="job-library"><h2 id="dialog-title">${fileTarget(target)?esc(t('websiteMedia','fileImports')):'Media imports'}</h2><p>${fileTarget(target)?esc(t('websiteMedia','fileHelp')):target.purpose==='record-attachment'?esc(t('recordContent','mediaLibraryHelp')):'Received originals stay private. Use a prepared copy in this editor, then save your changes.'}</p><div id="media-upload-status" hidden></div><div id="media-import-pages" class="inline-actions" aria-label="Import pages">${button('Newer imports','previous','','disabled')}<span role="status">Page 1</span>${button('Older imports','next','','disabled')}</div><ul id="media-import-list" class="material-list job-library-items" tabindex="0" aria-label="Imported media"><li>Loading imports...</li></ul><div class="dialog-actions">${button('Refresh','refresh')}${button('Close','close')}</div></section>`);
  await library(watch);
 }
 function status(text,cancel=false){
  const el=document.getElementById('media-upload-status');if(!el)return;
  el.hidden=!text;
  el.innerHTML=`<span role="status">${esc(text)}</span> ${cancel?button(xhr?'Cancel upload':'Cancel processing','active-cancel',uploadId??''):''}`;
 }
 async function observe(id,token,intent){
  const {job}=await call('job',{id});if(!live(token))return;
  if(job.state==='completed'){
   if(currentDestination(intent)){await apply(intent,job.result);status(intent.purpose==='record-attachment'?t('recordContent','mediaAttached'):intent.purpose.startsWith('website-file')?t('websiteMedia','fileAdded'):'Media added to this draft. Save when ready.');}
   else notify('Media is ready. Open Media imports in the destination editor to use it.');return;
  }
  status(job.message??(job.cancelRequested?'Stopping processing...':job.state==='running'?progressText(job,fileTarget(intent)):job.state==='queued'?'Waiting to process media':'Processing cancelled. The original is retained.'),['queued','running'].includes(job.state)&&!job.cancelRequested);
  if(['queued','running'].includes(job.state))timer=setTimeout(()=>observe(id,token,intent).catch(error=>notify(error.message,true)),500);
 }
 async function upload(input,resume=null){
  const file=input.files[0];if(!file||receiving)return;
  const intent=resume?target:destination(input),kind=resume?.kind??(fileTarget(intent)?'file':!['attachment','record-attachment','website','website-library'].includes(intent.purpose)?'image':file.type==='image/gif'?'video':/\.svg$/i.test(file.name)?'image':file.type.split('/')[0]);
  if(!['image','audio','video','file'].includes(kind))throw Error('Choose an image, audio recording, or video.');
  if(resume&&(file.name!==resume.name||file.size!==resume.size))throw Error('Select the same original name and size.');
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
    request.upload.onprogress=e=>status('Uploading original: '+e.loaded.toLocaleString()+' / '+file.size.toLocaleString()+' bytes',true);
    request.onload=()=>{try{const result=JSON.parse(request.responseText);request.status>=200&&request.status<300?resolve(result):reject(result);}catch{reject(Error('Upload interrupted. Reselect the file in Media imports.'));}};
    request.onerror=()=>reject(Error('Upload interrupted. Reselect the file in Media imports.'));
    request.onabort=()=>reject(Error('Upload cancelled. Reselect the file in Media imports to start again.'));
    status('Uploading original...',true);request.send(file);
   });guard();xhr=null;busy(false);
   await call('finish',{id:session.id});guard();
   if(resume){status('');await library(token);}else await observe(session.id,token,intent);
  }catch(error){status(error.message??'Upload interrupted. Open Media imports to retry.');throw error;}
  finally{xhr=null;receiving=false;busy(false);input.disabled=false;input.value='';}
 }
 async function action(el){
  const name=el.dataset.action;if(!name?.startsWith('media-import-'))return false;
  const op=name.slice('media-import-'.length),id=el.dataset.id;
  if(op==='open'){await open(el.parentElement.querySelector('input[data-upload]'));return true;}
  if(op==='active-cancel'){if(xhr)xhr.abort();else{await call('cancel',{id});status('Stopping processing...');}return true;}
  if(op==='close'){if(receiving){notify('Finish or cancel the upload first.',true);return true;}stop();document.getElementById('dialog').close();return true;}
  guard();
  if(op==='use'){const s=items.find(s=>s.id===id);if(!currentDestination(target)||s?.job?.state!=='completed'||(fileTarget(target)?s.kind!=='file':s.kind==='file'))throw Error('The prepared copy is not ready.');if(target.purpose==='record-attachment')document.getElementById('dialog').close();await apply(target,s.job.result);stop();document.getElementById('dialog').close();return true;}
  if(['cancel','retry','finish'].includes(op))await call(op,{id});
  if(op==='next'&&next){previous.push(cursor);cursor=next;}
  if(op==='previous'&&previous.length)cursor=previous.pop();
  if(op==='refresh'){cursor=null;next=null;previous=[];}
  if(['refresh','previous','next','cancel','retry','finish'].includes(op)){stop();await library(watch);}return true;
 }
 async function resume(input){const session=items.find(s=>s.id===input.dataset.mediaResume);if(!session)throw Error('Reopen Media imports.');await upload(input,session);}
 return {bind,upload,action,resume};
}
