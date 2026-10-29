import {t} from './i18n/index.js';
import {RECORD_TYPES} from './record-types.js';
import {recordTypeLabel} from './record-type-presentation.js';
import {renderProse} from './prose-model.js';
import {documentEditors} from './document-editor.js';
import {recordStarterCapture} from './record-starter-capture.js';
import {recordStarterPages} from './record-starter-pages.js';
import {sha256} from './vendor/sha256.js';
const msg=(key,args)=>t('recordStarters',key,args);
export function recordStartersUI({state,api,esc,showDialog,notify,openRecord,sourceRecord=()=>null}){
 let context,workspaceId,generation=0,requesting=false,items=[],next=null,pageCursor=null,previousPages=[],current=null,versions=[],historyCursor=null,selected=null,notebookId=null,imported=null,source=null,newBody='';
 const dialog=()=>document.querySelector('#dialog'),text=(k,a)=>esc(msg(k,a));
 const valid=()=>context===state.storage?.contextId&&workspaceId===state.book?.id&&!state.access?.locked;
 const guard=()=>{if(!valid()||!dialog().open)throw Error(msg('reopen'));};
 const editors=documentEditors({context:()=>generation,destinations:()=>[],figures:()=>[],onError:e=>notify(e,true)});
 const pages=recordStarterPages({request,esc,frame,notify,onBack:async()=>{if(imported)await importReview();else await open(current.header.id);}});
 const sourceCapture=recordStarterCapture({api,esc,frame,valid,onPrepared:async value=>{current=value;await pages.start({id:value.header.id,release:null},{editing:true});}});
 const button=(key,action,extra='')=>'<button type="button" class="button" data-action="starter-'+action+'" '+extra+'>'+text(key)+'</button>';
 const field=(label,control)=>'<label class="field">'+text(label)+control+'</label>';
 const close=()=>button('close','close'),back=()=>button('back','list');
 function frame(title,html,keepEditors=false){if(!keepEditors)editors.release();showDialog('<section class="record-starters"><h2 id="dialog-title" tabindex="-1">'+esc(title)+'</h2>'+html+'</section>');dialog().querySelector('h2').focus();}
 async function request(operation,data){guard();const serial=generation;requesting=true;try{const result=await api('/api/research/starters/'+operation,{workspaceId,...data},{adopt:false});guard();if(serial!==generation)throw Error(msg('reopen'));return result;}finally{requesting=false;}}
 function listView(){
  frame(msg('library'),'<p>'+text('description')+'</p><div class="inline-actions">'+button('new','new')+(source?button('capture','capture')+button('origin','origin'):'')+button('import','import')+'</div><ul>'+items.map(v=>'<li><h3>'+esc(v.name)+'</h3><p>'+text(v.status)+' · '+(v.latest?text('released',{number:v.sequence}):text('draft'))+(v.latest&&v.draftHash!==v.releasedDraftHash?' · '+text('unreleased'):'')+'</p>'+button('open','open','data-id="'+v.id+'"')+'</li>').join('')+'</ul>'+(items.length?'':'<p>'+text('empty')+'</p>')+'<div class="dialog-actions">'+(previousPages.length?button('previous','previous'):'')+(next?button('next','next'):'')+close()+'</div>');
 }
 async function list(cursor=null,{reset=true}={}){pages.stop();const page=await request('list',{cursor});if(reset)previousPages=[];pageCursor=cursor;items=page.items;next=page.next;listView();}
 async function launch(control){
  sourceCapture.stop();pages.stop();context=state.storage?.contextId;workspaceId=state.book.id;notebookId=control.dataset.notebook??(state.notebook==='all'?null:state.notebook);source=sourceRecord()??(state.page==='editor'?{id:state.selected,snapshotId:state.etag}:null);const serial=++generation;
  frame(msg('library'),'<p role="status">'+text('loading')+'</p>'+close());
  try{await list();}catch(e){if(serial===generation&&valid()&&dialog().open)frame(msg('library'),'<p role="alert">'+esc(e.message)+'</p>'+button('retry','list')+close());}
 }
 async function releasedView(id,revision){const view=await request('view',{id,release:revision,offset:0}),body=await request('field',{id,release:revision,field:'body',position:0});return {...view,...view.release,body:body.value};}
 async function open(id){pages.stop();current=await request('view',{id,release:null,offset:0});const history=await request('history',{id,cursor:null});versions=history.items;historyCursor=history.next;selected=current.header.latest?await releasedView(id,current.header.latest):null;detail();}
 function detail(){const h=current.header;
  let html='<p>'+text(h.status)+(h.latest&&h.draftHash!==h.releasedDraftHash?' · '+text('unreleased'):'')+'</p><div class="inline-actions">'+(h.status==='active'?button('edit','edit')+button('release','release'):'')+button(h.status==='active'?'archive':'restore','archive')+'</div>'+(h.status==='archived'?'<p>'+text('archiveHelp')+'</p>':'');
  if(selected){
   html+='<form id="starter-use-form" data-no-draft>'+field('history','<select name="release">'+versions.map(v=>'<option value="'+v.revision+'" '+(v.revision===selected.revision?'selected':'')+'>'+text('released',{number:v.number})+' — '+esc(v.note)+'</option>').join('')+'</select>')+(historyCursor?button('moreHistory','history'):'')+'<p>'+esc(selected.note)+'</p><details><summary>'+text('revision')+'</summary><code style="overflow-wrap:anywhere">'+selected.revision+'</code></details><h3>'+esc(selected.blueprint.title)+'</h3><div class="prose">'+renderProse(selected.body)+'</div>'+button('reviewInstructions','read');
   if(h.status==='active')html+=field('book','<select name="notebook" required><option value="">'+text('book')+'</option>'+state.book.notebooks.map(n=>'<option value="'+n.id+'" '+(n.id===notebookId?'selected':'')+'>'+esc(n.title)+'</option>').join('')+'</select>')+'<p>'+text('useHelp')+'</p><button type="submit" class="button primary">'+text('use')+'</button>';
   html+='</form>'+button('export','export');
  }else html+='<p>'+text('noRelease')+'</p>';
  frame(h.name,html+'<div class="dialog-actions">'+back()+close()+'</div>');
  dialog().querySelector('[name="release"]')?.addEventListener('change',async event=>{const value=event.target.value;if(requesting){event.target.value=selected.revision;return;}event.target.disabled=true;try{selected=await releasedView(h.id,value);detail();}catch(e){notify(e.message,true);}finally{event.target.disabled=false;}});
 }
 function newTemplate(){
  current=null;newBody='';editors.release();const rich=editors.field({key:'starter-new-body',label:msg('body'),value:'',set:value=>{newBody=value;const input=dialog().querySelector('[name="instructions"]');if(input)input.value=JSON.stringify(value);}});
  frame(msg('new'),'<form id="starter-edit-form"><input name="instructions" type="hidden" value="'+esc(JSON.stringify(''))+'">'+field('name','<input name="name" required maxlength="120">')+field('title','<input name="title" required maxlength="180">')+field('type','<select name="type">'+RECORD_TYPES.map(type=>'<option value="'+type.id+'" '+(type.id==='protocol'?'selected':'')+'>'+esc(recordTypeLabel(type.id))+'</option>').join('')+'</select>')+rich+'<p>'+text('newHelp')+'</p><div class="dialog-actions">'+back()+'<button type="submit" class="button primary">'+text('save')+'</button></div></form>',true);editors.bind(dialog());
 }
 async function releaseForm(){current=await request('view',{id:current.header.id,release:null,offset:0});frame(msg('release'),'<form id="starter-release-form"><p>'+text('releaseHelp')+'</p><p>'+esc(current.blueprint.title)+' · '+text('sectionCount',{count:current.sections.total})+'</p>'+button('reviewInstructions','reviewDraft')+field('releaseNote','<textarea name="note" required maxlength="2000"></textarea>')+'<div class="dialog-actions">'+back()+'<button type="submit" class="button primary">'+text('release')+'</button></div></form>');}
 function transfer(exporting){frame(msg(exporting?'export':'import'),'<form id="starter-'+(exporting?'export':'import')+'-form"><p>'+text(exporting?'exportHelp':'importHelp')+'</p>'+(exporting?'':field('file','<input type="file" name="file" required accept=".observanda-template">'))+field('password','<input type="password" name="password" required minlength="12" maxlength="1024" autocomplete="new-password">')+(exporting?field('confirmPassword','<input type="password" name="confirmPassword" required minlength="12" maxlength="1024" autocomplete="new-password">'):'')+'<p role="status" data-transfer-status></p><progress data-transfer-progress hidden></progress><div class="dialog-actions">'+back()+'<button type="submit" class="button primary">'+text(exporting?'download':'reviewImport')+'</button></div></form>');}
 async function importReview(){const view=await request('packageView',{uploadId:imported.uploadId,offset:0}),body=await request('packageField',{uploadId:imported.uploadId,field:'body',position:0});frame(msg('importReview'),'<form id="starter-import-confirm-form" data-no-draft><p>'+text('importHelp')+'</p><p>'+text('sourceVersion',{number:view.release.number})+'</p><h3>'+esc(view.blueprint.name)+'</h3><p>'+esc(view.release.note)+'</p><div class="prose">'+renderProse(body.value)+'</div>'+button('reviewInstructions','readPackage')+'<details><summary>'+text('sourceFingerprint')+'</summary><code style="overflow-wrap:anywhere">'+imported.fingerprint+'</code></details><div class="dialog-actions">'+back()+'<button type="submit" class="button primary">'+text('confirmImport')+'</button></div></form>');}
 async function upload(form,file,password){
  if(!file?.size)throw Error(msg('fileRequired'));const serial=generation,check=()=>{guard();if(serial!==generation||!form.isConnected)throw Error(msg('reopen'));};
  const progress=(key,done,total)=>{check();form.querySelector('[data-transfer-status]').textContent=msg(key,{done:done.toLocaleString(),total:total.toLocaleString()});const bar=form.querySelector('progress');bar.hidden=false;bar.max=total;bar.value=done;};
  const hash=sha256.create();try{
   for(let offset=0;offset<file.size;offset+=128*1024){hash.update(new Uint8Array(await file.slice(offset,offset+128*1024).arrayBuffer()));progress('hashingPackage',Math.min(file.size,offset+128*1024),file.size);}
   const digest=Array.from(hash.digest(),b=>b.toString(16).padStart(2,'0')).join(''),marker=file.size+':'+digest;
   if(form.dataset.package!==marker){form.dataset.package=marker;form.dataset.upload=crypto.randomUUID();}
   const start=await request('upload',{uploadId:form.dataset.upload,bytes:file.size,sha256:digest}),uploadId=start.uploadId;form.dataset.upload=uploadId;
   if(start.accepted){await request('discard',{uploadId});notify(msg('importRecovered'));await open(start.accepted);return;}
   for(let index=start.received;index<Math.ceil(file.size/start.chunkBytes);index++){check();const bytes=new Uint8Array(await file.slice(index*start.chunkBytes,(index+1)*start.chunkBytes).arrayBuffer());let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));const result=await request('uploadPart',{uploadId,index,encoded:btoa(raw)});progress('uploadingPackage',Math.min(file.size,result.received*start.chunkBytes),file.size);}
   progress('verifyingPackage',file.size,file.size);const review=await request('review',{uploadId,password});check();imported={uploadId,id:crypto.randomUUID(),...review};await importReview();
  }finally{hash.destroy();}
 }
 async function action(control){const name=control.dataset.action;if(name==='starter-library'){await launch(control);return true;}if(!name?.startsWith('starter-'))return false;guard();if(requesting&&name!=='starter-close')return true;if(await sourceCapture.action(control)||await pages.action(control))return true;sourceCapture.stop();
  if(name==='starter-close')dialog().close();
  if(name==='starter-list'){if(imported){await request('discard',{uploadId:imported.uploadId});imported=null;}await list();}
  if(name==='starter-next'){previousPages.push(pageCursor);await list(next,{reset:false});}if(name==='starter-previous')await list(previousPages.pop()??null,{reset:false});
  if(name==='starter-open')await open(control.dataset.id);if(name==='starter-new')newTemplate();
  if(name==='starter-edit')await pages.start({id:current.header.id,release:null},{editing:true});
  if(name==='starter-read')await pages.start({id:current.header.id,release:selected.revision});if(name==='starter-reviewDraft')await pages.start({id:current.header.id,release:null});
  if(name==='starter-readPackage')await pages.start({uploadId:imported.uploadId});
  if(name==='starter-capture')await sourceCapture.start({workspaceId,recordId:source.id,snapshotId:source.snapshotId??state.etag});
  if(name==='starter-release')await releaseForm();
  if(name==='starter-archive'){await request('archive',{id:current.header.id,expectedRevision:current.header.revision,archived:current.header.status==='active'});await open(current.header.id);}
  if(name==='starter-history'){const page=await request('history',{id:current.header.id,cursor:historyCursor});versions.push(...page.items);historyCursor=page.next;detail();}
  if(name==='starter-import')transfer(false);if(name==='starter-export')transfer(true);
  if(name==='starter-origin'){const {origin}=await request('origin',{recordId:source.id});if(!origin)frame(msg('origin'),'<p>'+text('noOrigin')+'</p>'+back());else{current={header:{id:origin.templateId}};await pages.start({id:origin.templateId,release:origin.release});}}
  return true;
 }
 async function submit(form){if(!form.id.startsWith('starter-'))return false;if(await sourceCapture.submit(form))return true;if(form.dataset.busy||requesting)return true;guard();form.dataset.busy='true';const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  try{if(await pages.submit(form))return true;const data=new FormData(form);
   if(form.id==='starter-edit-form'){const type=data.get('type'),draft={name:data.get('name'),title:data.get('title'),type,body:newBody,tags:[],sections:RECORD_TYPES.find(t=>t.id===type).sections.map(title=>({title,body:''}))};const result=await request('save',{id:form.dataset.id??=crypto.randomUUID(),expectedRevision:null,draft});current=result;notify(msg('saved'));frame(result.header.name,'<p>'+text('saved')+'</p><div class="dialog-actions">'+button('edit','edit')+button('release','release')+back()+'</div>');}
   if(form.id==='starter-release-form'){await request('publish-selected',{id:current.header.id,expectedRevision:current.header.revision,note:data.get('note').trim()});await open(current.header.id);}
   if(form.id==='starter-use-form'){const notebook=data.get('notebook');if(!notebook)throw Error(msg('notebookMissing'));const result=await request('create',{id:current.header.id,release:selected.revision,recordId:form.dataset.id??=crypto.randomUUID(),notebookId:notebook});dialog().close();await openRecord(result.recordId);notify(msg('created'));}
   if(form.id==='starter-export-form'){if(data.get('password')!==data.get('confirmPassword'))throw Error(msg('passwordMismatch'));form.querySelector('[data-transfer-status]').textContent=msg('preparingDownload');const blob=await request('download',{id:current.header.id,release:selected.revision,password:data.get('password')}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='record-template-v'+selected.number+'.observanda-template';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);await open(current.header.id);}
   if(form.id==='starter-import-form')await upload(form,data.get('file'),data.get('password'));
   if(form.id==='starter-import-confirm-form'){const {id,uploadId,fingerprint}=imported;current=await request('accept',{id,uploadId,fingerprint});await request('discard',{uploadId});imported=null;await pages.start({id:current.header.id,release:null},{editing:true});}
   return true;
  }finally{delete form.dataset.busy;buttons.forEach(b=>b.disabled=false);}
 }
 dialog().addEventListener('close',()=>{sourceCapture.stop();pages.stop();generation++;editors.release();imported=null;source=null;context=null;});
 return {action,submit,button:()=>button('library','library')};
}
