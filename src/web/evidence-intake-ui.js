import {FILE_CHUNK} from './evidence-fingerprint.js';
import {createFileSelection,registerFileManifest,selectedFiles} from './evidence-file-selection.js';
import {compareEvidenceFiles,evidencePurposes} from './evidence-files.js';
import {t} from './i18n/index.js';
const tr=(key,parameters)=>t('evidenceIntake',key,parameters);
export function evidenceIntakeUI({route=value=>value,call,frame,esc,field,guard,context,owner}){
 let batch=null,offset=0,page=null,cursor=null,listPage=null,controller=null,busy=false,timer=null,generation=0,intent=null;
 const button=(key,action,extra='')=>'<button type="button" class="button" data-action="material-intake-'+action+'" '+extra+'>'+esc(tr(key))+'</button>';
 const status=message=>{const node=document.getElementById('intake-status');if(node)node.textContent=message;};
 const stop=()=>{clearTimeout(timer);timer=null;generation++;};
 const meter=(done,total)=>{const node=document.getElementById('intake-progress');if(node)node.value=total?done/total:1;};
 const progress=(completed=false)=>'<p id="intake-status" role="status" aria-live="polite"></p><progress id="intake-progress" max="1" value="'+(completed?'1':'0')+'" aria-label="'+esc(tr('progress'))+'"'+(completed?' hidden':'')+'></progress>';
 function newForm(){
  batch=null;intent=null;offset=0;frame(tr('heading'),
   '<p>'+esc(tr('introduction'))+'</p>'+
   field(tr('title'),'<input id="intake-title" maxlength="300">')+
   field(tr('sourceMode'),'<select id="intake-mode"><option value="files">'+esc(tr('selectIndividual'))+'</option><option value="folder">'+esc(tr('selectFolder'))+'</option></select>')+
   field(tr('purpose'),'<select id="intake-purpose">'+evidencePurposes.map(value=>'<option value="'+value+'">'+esc(tr('purpose-'+value))+'</option>').join('')+'</select>')+
   field(tr('files'),'<input id="intake-files" type="file" multiple>')+
   '<p class="muted">'+esc(tr('folderHelp'))+'</p>'+
   field(tr('provenance'),'<textarea id="intake-provenance" rows="3"></textarea>')+
   '<p class="muted">'+esc(tr('selectionHelp'))+'</p>'+progress()+
   '<div class="inline-actions">'+button('upload','upload')+button('pause','pause','disabled')+'</div>');
  document.getElementById('intake-mode').addEventListener('change',event=>{
   const input=document.getElementById('intake-files');input.value='';input.toggleAttribute('webkitdirectory',event.target.value==='folder');
  });
 }
 async function list({fresh=false}={}){
  if(fresh)cursor=null;const version=generation,result=await call('intakes',{recordId:owner(),cursor});guard();if(version!==generation)return;listPage=result;
  frame(tr('unfinished'),listPage.items.length?'<ul class="material-list">'+listPage.items.map(b=>'<li><div><strong>'+esc(b.title)+'</strong><p>'+esc(tr('registered',b))+'</p></div>'+button('continue','open','data-id="'+b.id+'" aria-label="'+esc(tr('continueNamed',{title:b.title}))+'"')+'</li>').join('')+'</ul><div class="inline-actions">'+(cursor?button('recent','first'):'')+(listPage.next?button('older','next'):'')+'</div>':'<p>'+esc(tr('none'))+'</p>');
 }
 async function open(id,{at=0}={}){
  const version=generation,data=await call('intake-page',{id,offset:at});guard();if(version!==generation)return;page=data;batch=data.batch;offset=at;intent=null;
  const completed=batch.state==='completed',processing=batch.state==='processing';
  const footer='<button type="button" class="button" data-action="material-home">'+esc(tr('back'))+'</button>'+
   (batch.state==='open'?button('finish','finish',batch.registered!==batch.count||batch.ready!==batch.count?'disabled':''):
    processing?button('cancel','cancel')+button('retry','retry','hidden'):
    '<button type="button" class="button" data-action="material-reference" data-ref="'+esc(JSON.stringify(batch.result))+'">'+esc(tr('inspect'))+'</button>');
  frame(tr(completed?'attachedHeading':'heading'),
   '<h3>'+esc(batch.title)+'</h3><p>'+esc(tr(completed?'attached':'registered',batch))+'</p>'+(batch.purpose?'<p>'+esc(tr('purpose'))+': '+esc(tr('purpose-'+batch.purpose))+'</p>':'')+
   '<p>'+esc(tr(completed?'identityHelp':'resumeHelp'))+'</p>'+
   (batch.state==='open'?field(tr(batch.registered<batch.count?'completeFiles':'remainingFiles'),'<input id="intake-files" type="file" multiple'+(batch.sourceMode==='folder'?' webkitdirectory':'')+'>')+
    '<div class="inline-actions">'+button('uploadSelected','upload')+button('pause','pause','disabled')+'</div>':'')+
   progress(completed)+
   '<ul class="material-list intake-files">'+data.items.map(f=>'<li><div><strong>'+esc(f.sourcePath??f.name)+'</strong><p>'+esc(tr('fileStatus',{size:f.size.toLocaleString(),status:f.completed?tr('fileAttached'):f.sha256?tr('verified'):f.reused?tr('reused'):tr('received',{count:f.received.toLocaleString()})}))+'</p>'+
    (f.sha256?'<details><summary>'+esc(tr('sha256'))+'</summary><code>'+f.sha256+'</code></details>':'')+'</div></li>').join('')+'</ul>'+
   '<div class="inline-actions">'+(at?button('previous','previous'):'')+(data.next!==null?button('more','more'):'')+'</div>',footer);
  document.getElementById('material-form')?.setAttribute('data-no-draft','');
  if(processing)await watch();
 }
 async function watch(){
  const version=generation,id=batch.id;
  try{
   const {job}=await call('job',{id});guard();if(version!==generation)return;
   if(job.state==='completed'){await open(id,{at:offset});return;}
   status(job.message??tr('jobProgress',{state:job.state,...job.progress}));meter(job.progress.done,job.progress.total);
   const cancel=document.querySelector('[data-action="material-intake-cancel"]'),retry=document.querySelector('[data-action="material-intake-retry"]');
   if(cancel)cancel.hidden=['failed','cancelled','relocated'].includes(job.state);
   if(retry)retry.hidden=!['failed','cancelled'].includes(job.state);
   if(!['failed','cancelled','relocated'].includes(job.state))timer=setTimeout(()=>watch(),800);
  }catch(error){if(version===generation)status(tr('refreshFailed',{error:error.message??''}));}
 }
 async function upload(){
  // Keep the browser's FileList; hash and match only one metadata page at a time.
  const selected=document.getElementById('intake-files')?.files;if(!selected?.length)throw Error(tr('selectFiles'));
  const title=batch?.title??document.getElementById('intake-title').value.trim();
  if(!title)throw Error(tr('enterTitle'));
  busy=true;controller=new AbortController();const signal=controller.signal;
  for(const node of document.querySelectorAll('[data-action^="material-intake-"]'))node.disabled=node.dataset.action!=='material-intake-pause';
  let failure=null,id=batch?.id??intent?.id;
  const scopedCall=async(...args)=>{signal.throwIfAborted();guard();const result=await call(...args);guard();return result;};
  try{
   const source=await createFileSelection(scopedCall,owner(),selected,{signal,checking:(file,i)=>status(tr('checking',{name:file.name,number:i+1,count:selected.length})),progress:meter});
   if(!batch){
    intent??={id:crypto.randomUUID(),recordId:owner(),title,provenance:document.getElementById('intake-provenance').value,purpose:document.getElementById('intake-purpose').value,sourceMode:document.getElementById('intake-mode').value,count:source.count,bytes:source.bytes};
    id=intent.id;batch=await scopedCall('intake-start',intent,{signal});
    document.getElementById('material-form')?.setAttribute('data-no-draft','');
   }
   if(batch.registered<batch.count)batch=await registerFileManifest(scopedCall,batch,source,{signal,checking:()=>status(tr('saving'))});
   const choices=selectedFiles(scopedCall,source,selected,{signal})[Symbol.asyncIterator]();let chosen=await choices.next(),at=0;
   do{
    const saved=await scopedCall('intake-page',{id:batch.id,offset:at},{signal});
    for(const [i,f] of saved.items.entries()){
     signal.throwIfAborted();const compared=chosen.done?1:compareEvidenceFiles(chosen.value,f);
     if(compared<0)throw Error(tr('differentFiles'));
     const file=compared===0?chosen.value.file:null;
     if(file)chosen=await choices.next();
     if(f.reused||f.received===f.size||!file)continue; // Partial reselection can resume a saved manifest.
     let session=await scopedCall('intake-session',{id:f.id},{signal});
     for(let chunk=session.receivedChunks;chunk<Math.ceil(file.size/FILE_CHUNK);chunk++){
      signal.throwIfAborted();guard();status(tr('uploading',{name:file.name,number:at+i+1,count:batch.count}));
      const response=await fetch(route('/api/research/materials/chunk/'+f.id+'/'+chunk),{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Observanda-Workspace':context()},body:file.slice(chunk*FILE_CHUNK,(chunk+1)*FILE_CHUNK),signal});
      if(!response.ok)throw await response.json();session=await response.json();guard();meter(Math.min(file.size,(chunk+1)*FILE_CHUNK),file.size);
     }
    }
    at=saved.next;
   }while(at!==null);
   if(!chosen.done)throw Error(tr('differentFiles'));
  }catch(error){failure=error.name==='AbortError'?tr('paused'):(error.message??tr('interrupted'));}
  finally{
   controller=null;
   if(id){try{await open(id,{at:offset});}catch{status(failure??tr('confirmFailed'));}}
   busy=false;
   if(!id||!batch)for(const node of document.querySelectorAll('[data-action^="material-intake-"]'))node.disabled=node.dataset.action==='material-intake-pause';
   status(failure??tr('receivedHelp'));
  }
 }
 async function action(control){
  const act=control.dataset.action?.replace('material-intake-','');if(!control.dataset.action?.startsWith('material-intake-'))return false;
  guard();if(act==='pause'){controller?.abort();return true;}if(busy)return true;
  if(act==='new')newForm();
  if(['list','first','next','open','more','previous'].includes(act)){
   busy=true;const controls=[...document.querySelectorAll('#material-form button,#material-form input,#material-form select')].map(node=>[node,node.disabled]);
   controls.forEach(([node])=>node.disabled=true);
   try{
    if(act==='list'||act==='first')await list({fresh:true});
    if(act==='next'){cursor=listPage.next;await list();}
    if(act==='open')await open(control.dataset.id);
    if(act==='more'||act==='previous')await open(batch.id,{at:act==='more'?page.next:Math.max(0,offset-20)});
   }finally{busy=false;controls.forEach(([node,disabled])=>{if(node.isConnected)node.disabled=disabled;});}
  }
  if(act==='upload')await upload();
  if(['finish','cancel','retry'].includes(act)){
   busy=true;stop();control.disabled=true;
   try{await call(act==='finish'?'intake-finish':act==='cancel'?'cancel-job':'retry-job',{id:batch.id});guard();await open(batch.id,{at:offset});}
   catch(error){status(tr('actionFailed',{error:error.message??''}));if(control.isConnected)control.disabled=false;}
   finally{busy=false;}
  }
  return true;
 }
 return {action,stop,isBusy:()=>busy};
}
