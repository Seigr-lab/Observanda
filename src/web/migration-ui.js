import {t} from './i18n/index.js';
import {migrationImportUI} from './migration-import-ui.js';
// A private, read-only inspection. Opening this view never starts a scan.
export function migrationUI({state,api,esc,field,render,showDialog}){
 const importer=migrationImportUI({state,api,esc,field,render,showDialog});
 const messageText=(key,values)=>t('migration',key,values),text=(key,values)=>esc(messageText(key,values));
 let report=null,pending=null,context=null,source='',manifest='inventory.observanda-source.json',filter='all',query='',page=0,message='',issues=[];
 const labels=()=>Object.fromEntries(['mapped','excluded','unsupported','missing','conflict'].map(key=>[key,messageText(key)]));
 function clear(){pending?.abort();pending=null;report=null;source='';manifest='inventory.observanda-source.json';message='';issues=[];page=0;filter='all';query='';}
 function bind(){
  importer.bind();
  if(context!==state.storage?.contextId||state.access?.locked){clear();context=state.storage?.contextId;}
  if(state.page!=='migration'&&pending){pending.abort();pending=null;message=messageText('cancelled');}
 }
 function items(){
  if(!report)return [];
  const originals=new Map(report.files.map(f=>[f.path,f]));
  const objects=report.objects.map(o=>({name:o.title,id:o.id,revision:o.revision,status:o.status,object:o,data:{declaration:o,verifiedFiles:o.files.map(f=>originals.get(f.path)??{path:f.path,status:'missing'})},issues:o.issues}));
  const files=report.files.filter(f=>['unaccounted','unsafe'].includes(f.status)).map(f=>({name:f.path,status:'unsupported',data:f,issues:[{message:messageText(f.status==='unsafe'?'unsafe':'unaccounted')}]}));
  const term=query.trim().toLowerCase();
  return [...objects,...files].filter(o=>(filter==='all'||o.status===filter)&&(!term||[o.name,o.id,o.revision,...(o.object?.files.map(f=>f.path)??[])].join(' ').toLowerCase().includes(term)));
 }
 function details(o){
  if(!o)return '';
  const datum=(name,value)=>'<dt>'+text(name)+'</dt><dd>'+value+'</dd>';
  const target=s=>s.kind==='whole'?messageText('whole'):s.kind==='bytes'?messageText('byteRange',{offset:s.offset,end:s.offset+s.length-1}):s.kind==='anchor'?messageText('htmlAnchor',{value:s.value}):s.value?messageText('jsonPointer',{value:s.value}):messageText('rootPointer');
  return '<dl>'+datum('kind',esc(o.kind))+datum('mapping',o.mapping?esc(o.mapping.kind):text('none'))+datum('audience',text(o.audience))+'</dl>'+
   '<details class="inventory-targets"><summary>'+text('targets')+'</summary><ul>'+o.files.map(f=>'<li><strong>'+text('fileDescription',{path:f.path,bytes:f.bytes})+'</strong><p>'+text('targetDescription',{target:target(f.selector),status:messageText(f.verification?.status??'notChecked')})+'</p></li>').join('')+'</ul></details>'+
   '<details><summary>'+text('dates')+'</summary><ul>'+o.dates.map(d=>'<li>'+esc(d.meaning)+': '+(d.value===null?text('unknown'):esc(d.value))+'</li>').join('')+'</ul>'+(o.dates.length?'':text('none'))+'</details>'+
   '<details><summary>'+text('relationships')+'</summary><ul>'+o.links.map(l=>'<li>'+esc(l.type)+': '+esc(l.id)+' @ '+esc(l.revision)+' · '+text(l.required?'required':'optional')+'</li>').join('')+'</ul>'+(o.links.length?'':text('none'))+'</details>'+
   (o.urls.length?'<details><summary>'+text('links')+'</summary><ul>'+o.urls.map(url=>'<li>'+esc(url)+'</li>').join('')+'</ul></details>':'');
 }
 function results(){
  if(!report)return '';
  const c=report.counts,rows=items(),last=Math.max(0,Math.ceil(rows.length/50)-1);page=Math.min(page,last);
  return '<section class="panel inventory-report" aria-labelledby="inventory-result-title"><h2 id="inventory-result-title" tabindex="-1">'+text(report.complete?'complete':'incomplete')+'</h2>'+
   '<p>'+esc(report.source.title)+ ' / ' +esc(report.source.revision)+'</p><p>'+text('counts',{objects:c.objects,files:c.files,bytes:(c.bytes/1024/1024).toFixed(2),links:c.relationships})+'</p>'+
   '<p>'+text('coverage',{mapped:c.mapped,excluded:c.excluded,blocked:c.unsupported+c.conflict+c.missing,files:c.unaccountedFiles+c.unsafeFiles})+'</p>'+
   '<p>'+text('boundary')+'</p>'+
   '<details><summary>'+text('identity')+'</summary><dl><dt>'+text('namespace')+'</dt><dd>'+esc(report.source.namespace)+'</dd><dt>'+text('pin')+'</dt><dd>'+esc(report.source.pin)+'</dd><dt>'+text('adapter')+'</dt><dd>'+esc(report.adapter.id)+' / '+report.adapter.version+'</dd></dl><p>'+esc(report.qualification)+'</p><p>'+text('limits')+'</p>'+(report.inspection?'<p>'+text('verificationMetrics',{seconds:(report.inspection.durationMs/1000).toFixed(2),memory:(report.inspection.peakMemoryBytes/1024/1024).toFixed(1)})+'</p>':'')+'</details>'+
   '<label class="field" for="inventory-filter"><span id="inventory-filter-label">'+text('show')+'</span><select id="inventory-filter" aria-labelledby="inventory-filter-label">'+[['all',messageText('all')],...Object.entries(labels())].map(([value,label])=>'<option value="'+value+'" '+(filter===value?'selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
   field(messageText('search'),'<input id="inventory-search" type="search" maxlength="2048" autocomplete="off" value="'+esc(query)+'">')+
   '<p role="status">'+text('page',{count:rows.length,page:page+1,pages:last+1})+'</p><div class="inventory-objects">'+rows.slice(page*50,page*50+50).map(o=>'<article><strong>'+esc(o.name)+'</strong><span>'+esc(labels()[o.status]??o.status)+'</span>'+
     (o.id?'<small>'+esc(o.id)+' @ '+esc(o.revision)+'</small>':'')+
     (o.issues.length?'<ul>'+o.issues.map(i=>'<li>'+esc(i.message)+'</li>').join('')+'</ul>':'')+
     details(o.object)+'<details><summary>'+text('declaration')+'</summary><pre>'+esc(JSON.stringify(o.data,null,2))+'</pre></details></article>').join('')+'</div>'+
   '<div class="inline-actions"><button class="button" data-action="inventory-previous" '+(!page?'disabled':'')+'>'+text('previous')+'</button><button class="button" data-action="inventory-next" '+(page>=last?'disabled':'')+'>'+text('next')+'</button></div></section>';
 }
 function view(){
  bind();
  if(importer.active())return importer.view();
  return '<div class="page-heading"><h1>'+text('title')+'</h1><button class="button" data-action="storage-workspaces">'+text('back')+'</button></div>'+
   '<p>'+text('intro')+'</p>'+
   '<form id="inventory-form" class="panel" data-no-draft><h2>'+text('sourceTitle')+'</h2>'+
   field(messageText('sourceFolder'),'<input id="inventory-source" name="source" required autocomplete="off" spellcheck="false" value="'+esc(source)+'" '+(pending?'disabled':'')+'>')+
   '<button class="button" type="button" data-action="storage-browse" data-target="inventory-source" '+(pending?'disabled':'')+'>'+text(state.storage?.folderPicker?.mode==='server'?'browseServer':'chooseFolder')+'</button>'+
   field(messageText('manifest'),'<input name="manifest" required value="'+esc(manifest)+'" '+(pending?'disabled':'')+'>')+
   '<p class="muted">'+text('sourceGuidance')+'</p>'+
   '<div class="inline-actions"><button class="button primary" type="submit" '+(pending?'disabled':'')+'>'+text('inspect')+'</button><button class="button" type="button" data-action="inventory-cancel" '+(!pending?'disabled':'')+'>'+text('cancel')+'</button></div>'+
   '<p id="inventory-progress" role="status" tabindex="-1">'+esc(message)+'</p>'+
   (issues.length?'<ul role="alert">'+issues.map(i=>'<li>'+esc(i.field)+': '+esc(i.message)+'</li>').join('')+'</ul>':'')+'</form>'+results()+importer.entry(report,source,manifest);
 }
 async function submit(form){
  if(await importer.submit(form,{report,source,manifest}))return;
  if(pending)return;const data=new FormData(form);source=data.get('source');manifest=data.get('manifest');filter='all';query='';page=0;report=null;issues=[];message=messageText('inspecting');
  const controller=new AbortController(),requestContext=state.storage?.contextId;pending=controller;render();
  const current=()=>pending===controller&&requestContext===state.storage?.contextId&&state.page==='migration'&&!state.access?.locked;
  try{
   const result=await api('/api/migration/inventory',{source,manifest},{signal:controller.signal,onProgress:p=>{
    if(!current()||controller.signal.aborted)return;
    const el=document.getElementById('inventory-progress');if(el)el.textContent=p.phase==='verifying'?messageText('verifying'):p.phase==='selectors'?messageText('selectors'):messageText('hashing',{files:p.filesRead,bytes:(p.bytesRead/1024/1024).toFixed(1),total:(p.totalBytes/1024/1024).toFixed(1)});
   }});
   if(controller.signal.aborted||!current())return;
   report=result;message=messageText('finished');
  }catch(error){
   if(!current())return;
   message=controller.signal.aborted?messageText('cancelled'):error.message??messageText('interrupted');
   issues=error.details??[];
  }finally{
   if(current()){pending=null;render();document.getElementById(report?'inventory-result-title':'inventory-progress')?.focus();}
  }
 }
 function input(el){
  if(el.id==='inventory-search'){query=el.value.slice(0,2048);page=0;const start=el.selectionStart,end=el.selectionEnd;render();const input=document.getElementById('inventory-search');input?.focus();input?.setSelectionRange(start,end);return true;}
  if(el.id==='inventory-filter'){filter=el.value;page=0;render();document.getElementById('inventory-filter')?.focus();return true;}
  if(el.closest('#inventory-form')){if(el.name==='source')source=el.value;if(el.name==='manifest')manifest=el.value;if(report){report=null;message=messageText('changed');document.querySelector('.inventory-report')?.remove();const progress=document.getElementById('inventory-progress');if(progress)progress.textContent=message;}return true;}
  return false;
 }
 async function action(button){
  if(await importer.action(button))return true;
  const name=button.dataset.action;
  if(name==='migration-open'){document.getElementById('dialog').close();state.page='migration';render();return true;}
  if(name==='inventory-cancel'){pending?.abort();return true;}
  if(['inventory-next','inventory-previous'].includes(name)){page+=name==='inventory-next'?1:-1;render();document.getElementById('inventory-result-title')?.focus();return true;}
  return false;
 }
 return {view,bind,submit,input,action};
}
