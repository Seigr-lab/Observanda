import {researchContext} from './project-context.js';
import {recordRevisionView} from './record-revision-view.js';
import {enabledModule} from './feature-modules.js';
import {revisionText} from './revision-model.js';
import {t,messageLanguage} from './i18n/index.js';
const tr=(key,values)=>t('reviews',key,values);
const decisions=['reviewed','witnessed','changes-requested','inconclusive'];
const digest=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(revisionText(v))))].map(n=>n.toString(16).padStart(2,'0')).join('');
function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const empty=()=>({contacts:[],items:[],offset:0,total:0,previousCursor:null,nextCursor:null});

export function reviewsUI({state,api,esc,showDialog,notify,render,getRecord}){
 let list=empty(),owner=null,packet=null,contact=null,context=null,busy=false,plan=null,listError='',operationRoute=null,reading=0;
 const call=async(op,values={})=>{
  const workspaceId=state.book.id,ctx=researchContext(state),result=await api('/api/reviews/'+op,{workspaceId,...values});
  if(workspaceId!==state.book?.id||ctx!==researchContext(state))throw Error(tr('workspaceChanged'));return result;
 };
 const button=(key,action,attrs='')=>'<button type="button" class="button" data-action="review-'+action+'" '+attrs+'>'+esc(tr(key))+'</button>';
 const close=()=>document.getElementById('dialog').close();
 const frame=(key,html)=>{if(operationRoute!==location.hash)return;showDialog('<section class="review-workflow" lang="'+messageLanguage('reviews')+'"><h2 id="dialog-title">'+esc(tr(key))+'</h2>'+html+'<div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">'+esc(tr('close'))+'</button></div></section>');};
 const message=e=>e.code==='CONFLICT'?tr('pageChanged'):[e.message,...(e.details??[]).map(d=>d.field)].join(' ');
 const error=e=>{if(e.name==='AbortError'||operationRoute!==location.hash)return;const node=document.querySelector('[data-review-error]');if(node)node.textContent=message(e);else notify(message(e),true);};
 async function refresh(cursor=null){
  const request=++reading,recordId=owner,route=location.hash;context=researchContext(state);
  const result=await call('list',{recordId,cursor});
  if(request!==reading||owner!==recordId||route!==location.hash)throw new DOMException('Obsolete review read','AbortError');
  list=result;listError='';context=researchContext(state);
 }
 function entriesHTML(){
  const entries=list.items.map(i=>'<article class="module-item"><h3>'+esc(i.contact??tr('unverified'))+'</h3><p>'+esc(tr(i.direction==='incoming'?'incoming':'outgoing'))+' / '+esc(new Date(i.createdAt).toLocaleString())+'</p>'+i.records.map(r=>{
   const d=i.decisions.find(d=>d.id===r.id);
   return '<p><strong>'+esc(r.title)+'</strong><br>'+esc(tr(d?d.decision:'awaiting'))+(d?' / '+esc(tr(r.current===null?'receivedRevision':r.current?'currentRevision':'changedRevision')):'')+'</p>'+(d?'<p>'+esc(d.comment)+'</p><details><summary>'+esc(tr('signature'))+'</summary><small class="tool-hash">'+esc(tr('signatureDetails',{key:i.signer,time:i.signedAt}))+'</small></details>':'');
  }).join('')+'<div class="module-actions">'+button('open','open','data-id="'+i.id+'"')+button(i.direction==='outgoing'?'downloadRequest':'downloadResponse','export','data-id="'+i.id+'" '+(i.direction==='incoming'&&!i.decisions.length?'disabled':''))+'</div></article>').join('')||'<p>'+esc(tr('empty'))+'</p>';
  return entries+(list.previousCursor||list.nextCursor?'<div class="module-actions">'+button('previous','previous',list.previousCursor?'':'disabled')+'<span role="status">'+esc(tr('range',{start:list.total?list.offset+1:0,end:list.offset+list.items.length,total:list.total}))+'</span>'+button('next','next',list.nextCursor?'':'disabled')+'</div>':'');
 }
 const witnessFrame=()=>frame('witnesses',(listError?'<p role="alert">'+esc(listError)+'</p>':entriesHTML())+button('refresh','refresh')+(enabledModule(state.dashboardSettings,'collaboration')?button('request','request','data-record="'+owner+'"'):'<p>'+esc(tr('enable'))+'</p>'));
 function view(){
  if(context!==researchContext(state)){list=empty();listError='';}
  return '<section class="module-workbench" lang="'+messageLanguage('reviews')+'"><h1>'+esc(tr('title'))+'</h1><p>'+esc(tr('intro'))+'</p><div class="module-actions">'+button('identity','identity')+button('contact','contact')+button('request','request')+button('importFile','import')+button('refresh','refresh')+'</div><details><summary>'+esc(tr('contacts'))+'</summary>'+list.contacts.map(c=>'<p>'+esc(c.name)+' / '+esc(tr(c.active?'active':'blocked'))+'</p><code class="tool-hash">'+c.fingerprint+'</code>'+(c.active?button('untrust','untrust','data-fingerprint="'+c.fingerprint+'"'):'')).join('')+'</details><h2>'+esc(tr('reviews'))+'</h2>'+(listError?'<p role="alert">'+esc(listError)+'</p>'+button('retry','refresh'):entriesHTML())+'</section>';
 }
 function requestForm(record){
  const displayed=getRecord?.(),e=displayed?.id===record?displayed:state.book.entries.find(e=>e.id===record);plan=null;
  frame('request','<form id="review-request-form" data-request-id="'+crypto.randomUUID()+'"><label>'+esc(tr('reviewer'))+'<select name="recipient" aria-label="'+esc(tr('reviewer'))+'">'+list.contacts.filter(c=>c.active).map(c=>'<option value="'+c.fingerprint+'">'+esc(c.name)+'</option>').join('')+'</select></label><label>'+esc(tr('scope'))+'<select name="scope" aria-label="'+esc(tr('scope'))+'" data-review-scope>'+(e?'<option value="record:'+e.id+'">'+esc(tr('record',{title:e.title}))+'</option>':'')+state.book.notebooks.map(b=>'<option value="notebook:'+b.id+'">'+esc(tr('notebook',{title:b.title}))+'</option>').join('')+'</select></label><label>'+esc(tr('instructions'))+'<textarea name="message" maxlength="4000" rows="4"></textarea></label><p>'+esc(tr('sharingHelp'))+'</p>'+button('preview','plan')+'<div data-review-plan><p>'+esc(tr('selectionHelp'))+'</p></div><p role="alert" data-review-error></p><button class="button primary" type="submit" disabled>'+esc(tr('create'))+'</button></form>');
 }
 async function action(node){
  const name=node.dataset.action;if(!name?.startsWith('review-'))return false;if(busy)return true;
  const op=name.slice(7);busy=true;operationRoute=location.hash;
  try{
   if(op==='witnesses'){owner=state.selected;await refresh();witnessFrame();}
   else if(op==='identity'){const {contact:c}=await call('identity');contact=c;frame('identity','<p>'+esc(tr('identityHelp'))+'</p><code class="tool-hash">'+await digest(c)+'</code>'+button('downloadContact','download-contact'));}
   else if(op==='download-contact')download(contact,'observanda-review-contact.json');
   else if(op==='contact'){
    contact=null;frame('contact','<form id="review-contact-form"><label>'+esc(tr('contactFile'))+'<input name="file" type="file" accept=".json" required data-review-contact></label><p data-contact-fingerprint>'+esc(tr('chooseContact'))+'</p><label>'+esc(tr('reviewerName'))+'<input name="name" maxlength="160" required></label><label class="checkbox"><input name="verified" type="checkbox" required>'+esc(tr('verifiedContact'))+'</label><p role="alert" data-review-error></p><button class="button primary" type="submit">'+esc(tr('saveContact'))+'</button></form>');
   }
   else if(op==='import')frame('importTitle','<form id="review-import-form"><label>'+esc(tr('reviewFile'))+'<input name="file" type="file" accept=".observanda-review" required></label><p>'+esc(tr('importHelp'))+'</p><p role="alert" data-review-error></p><button class="button primary" type="submit">'+esc(tr('import'))+'</button></form>');
   else if(op==='request'){
    await refresh();if(!list.contacts.some(c=>c.active)){frame('request','<p>'+esc(tr('contactFirst'))+'</p>'+button('contact','contact'));return true;}requestForm(node.dataset.record??'');
   }
   else if(op==='plan'){
    const form=node.form,[kind,id]=form.elements.scope.value.split(':'),scope={kind,id};plan=null;form.querySelector('[type="submit"]').disabled=true;
    const result=await call('plan',{scope});
    if(!form.isConnected||form.elements.scope.value!==kind+':'+id||operationRoute!==location.hash)return true;
    plan=result;form.querySelector('[data-review-error]').textContent='';form.querySelector('[data-review-plan]').innerHTML='<p>'+esc(tr('selectionCount',{count:plan.records.length}))+'</p><ul>'+plan.records.map(r=>'<li>'+esc(r.title)+'<br><code class="tool-hash">'+esc(tr('revision',{revision:r.revision}))+'</code></li>').join('')+'</ul>';form.querySelector('[type="submit"]').disabled=false;
   }
   else if(op==='open'){
    const {packet:p}=await call('read',{id:node.dataset.id});packet=p;const q=p.request.value;
    frame('readTitle','<p>'+esc(q.message)+'</p><p>'+esc(tr('readHelp'))+'</p><form id="review-response-form" data-request-id="'+q.id+'">'+q.records.map((r,i)=>'<fieldset><legend>'+esc(r.record.title)+'</legend><code class="tool-hash">'+esc(tr('revision',{revision:r.revision}))+'</code><div class="review-readable">'+recordRevisionView(r.record,esc)+'</div><details><summary>'+esc(tr('inspect'))+'</summary><pre class="review-snapshot">'+esc(JSON.stringify(r.record,null,2))+'</pre></details>'+(p.direction==='incoming'&&!p.response?'<label>'+esc(tr('decision'))+'<select name="decision-'+i+'" aria-label="'+esc(tr('decision'))+'">'+decisions.map(k=>'<option value="'+k+'">'+esc(tr(k))+'</option>').join('')+'</select></label><label>'+esc(tr('comments'))+'<textarea name="comment-'+i+'" maxlength="8000" rows="3"></textarea></label>':'<p>'+esc(p.response?.value.decisions.find(d=>d.id===r.id)?.comment??tr('awaiting'))+'</p>')+'</fieldset>').join('')+(p.direction==='incoming'&&!p.response?'<label class="checkbox"><input type="checkbox" name="confirm" required>'+esc(tr('confirm'))+'</label><p>'+esc(tr('timeHelp'))+'</p><p role="alert" data-review-error></p><button class="button primary" type="submit">'+esc(tr('sign'))+'</button>':'')+'</form>');
   }
   else if(op==='export'){const result=await call('export',{id:node.dataset.id});download(result.file,'review-'+node.dataset.id+'.observanda-review');}
   else if(op==='untrust'){await call('untrust',{fingerprint:node.dataset.fingerprint});await refresh();render();}
   else if(['refresh','previous','next'].includes(op)){
    await refresh(op==='previous'?list.previousCursor:op==='next'?list.nextCursor:null);
    if(operationRoute!==location.hash)return true;
    if(owner)witnessFrame();else render();
    const container=owner?document.getElementById('dialog'):document.querySelector('main');
    (container?.querySelector('[data-action="review-'+op+'"]:not(:disabled)')??container?.querySelector('[data-action="review-'+(op==='next'?'previous':'next')+'"]:not(:disabled)'))?.focus();
   }
  }catch(e){error(e);}finally{busy=false;}return true;
 }
 async function readFile(file,max=1100000){if(!file||!file.size||file.size>max)throw Error(tr('fileSize'));return JSON.parse(await file.text());}
 function input(el){
  if(el.hasAttribute('data-review-scope')){plan=null;el.form.querySelector('[type="submit"]').disabled=true;el.form.querySelector('[data-review-plan]').innerHTML='<p>'+esc(tr('selectionHelp'))+'</p>';return true;}
  if(!el.hasAttribute('data-review-contact'))return false;const file=el.files?.[0],form=el.form;contact=null;
  void readFile(file,10000).then(async c=>{const hash=await digest(c);if(!form.isConnected||file!==el.files?.[0])return;contact=c;form.querySelector('[data-contact-fingerprint]').textContent=tr('fingerprint',{hash});}).catch(e=>{if(form.isConnected&&file===el.files?.[0])error(e);});return true;
 }
 async function submit(form){
  if(!form.id.startsWith('review-'))return false;if(busy)return true;busy=true;form.dataset.busy='true';operationRoute=location.hash;
  try{
   const d=new FormData(form);
   if(form.id==='review-contact-form'){if(!contact)throw Error(tr('inspectFirst'));await call('contact',{contact,name:d.get('name'),verified:d.has('verified')});}
   if(form.id==='review-import-form')await call('import',{file:await readFile(d.get('file'))});
   if(form.id==='review-request-form'){
    if(state.dirty)throw Error(tr('saveFirst'));if(!plan||d.get('scope')!==plan.scope.kind+':'+plan.scope.id)throw Error(tr('previewFirst'));
    const result=await call('create',{id:form.dataset.requestId,recipient:d.get('recipient'),message:d.get('message'),scope:plan.scope,records:plan.records.map(({id,revision})=>({id,revision}))});download(result.file,'request-'+form.dataset.requestId+'.observanda-review');
   }
   if(form.id==='review-response-form'){
    if(!d.has('confirm'))throw Error(tr('confirmFirst'));
    const selected=packet.request.value.records.map((r,i)=>({id:r.id,revision:r.revision,decision:d.get('decision-'+i),comment:d.get('comment-'+i)})),result=await call('respond',{id:form.dataset.requestId,decisions:selected});download(result.file,'response-'+form.dataset.requestId+'.observanda-review');
   }
   plan=null;packet=null;
   // A successful write is complete even if refreshing fails. Do not invite a
   // duplicate submission by leaving the signing/import form open.
   try{await refresh();}catch(e){if(e.name==='AbortError')return true;listError=message(e);notify(listError,true);}
   if(operationRoute!==location.hash)return true;
   busy=false;close();
   if(state.page==='module')render();else if(['editor','record-reader'].includes(state.page)){owner=state.selected;witnessFrame();}
   if(!listError)notify(tr('saved'));
  }catch(e){error(e);}finally{busy=false;delete form.dataset.busy;}return true;
 }
 async function activate(){owner=null;packet=null;plan=null;context=researchContext(state);try{await refresh();}catch(e){if(e.name!=='AbortError'){list=empty();listError=message(e);}}}
 function release(){if(state.access?.locked||context!==researchContext(state)||!['editor','record-reader'].includes(state.page)&&!(state.page==='module'&&state.moduleId==='collaboration')){reading++;list=empty();owner=null;packet=null;plan=null;contact=null;}}
 return {action,input,submit,release,isBusy:()=>busy,button:()=>button('witnesses','witnesses'),async moduleUI(){await activate();return {view,activate};}};
}
