import {projectApiRoute,researchOwner} from './project-context.js';
import {materialReferenceReader} from './material-reference-requests.js';
import {materialReferenceElements} from './material-reference-elements.js';
import {recordRevisionView} from './record-revision-view.js';
import {selectorAnchor} from './book-selectors.js';
import {researchReference} from './research-reference.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('recordReferences',key,args),names=['sections','contributors','relations','figures','attachments','tags','fields','preparations','events','assessments'];
export function retainedRecordUI({state,api,esc,showDialog}){
 const dialog=document.getElementById('dialog');let session=null,serial=0;
 const stop=()=>{serial++;session?.request?.abort();session=null;};dialog.addEventListener('close',stop);
 const valid=s=>!!s&&session===s&&s.context===state.storage?.contextId&&s.workspaceId===state.book?.id&&!state.access?.locked&&dialog.open&&!!dialog.querySelector('.retained-record-reader');
 const button=(key,action,disabled=false)=>'<button type="button" class="button" data-retained-action="'+action+'"'+(disabled?' disabled':'')+'>'+esc(text(key))+'</button>';
 const reference=ref=>'<button type="button" class="link-button" data-action="material-reference" data-ref="'+esc(JSON.stringify(ref))+'">'+esc(ref.label||ref.id)+'</button>';
 const view=(page,s)=>recordRevisionView(page.record,esc,{assetUrl:id=>projectApiRoute('/api/media/'+id,s.mediaOwner),anchors:true,attemptReference:reference,attemptWindow:page.attemptWindow,resultReference:reference,fieldsHtml:{relations:page.record.relations.length?'<ul>'+page.record.relations.map(link=>'<li>'+esc(link.type)+' · <a href="'+esc(researchReference(link.target))+'">'+esc(link.label||link.target.id)+'</a></li>').join('')+'</ul>':''},inlineRecord:{...page.record,figures:[...page.record.figures,...page.inline.figures],attachments:[...page.record.attachments,...page.inline.attachments]}});
 function render(s,{loading=false,error=''}={}){
  const result=s.result,previous=result?.previous,current=result?.current;
  const windows=[previous,current].filter(Boolean).map(page=>s.collection==='sections'?page.sections:page.collections[s.collection]),total=Math.max(0,...windows.map(page=>page?.total??0)),offset=Math.max(0,...windows.map(page=>page?.offset??0));
  showDialog('<div class="record-history retained-record-reader"><h2 id="dialog-title" tabindex="-1">'+esc(previous?.record.title??text('title'))+'</h2><div class="record-history-content" tabindex="0"><details><summary>'+esc(text('revisionDetails'))+'</summary><p>'+esc(text('revision',{revision:s.ref.revision}))+'</p></details>'+
   (loading?'<p role="status">'+esc(text('loading'))+'</p>':error?'<p role="alert">'+esc(error)+'</p>'+button('retry','retry'):
    '<nav class="record-section-navigation" aria-label="'+esc(text('navigation'))+'"><label>'+esc(text('collection'))+'<select data-retained-collection>'+names.map(name=>'<option value="'+name+'"'+(name===s.collection?' selected':'')+'>'+esc(text(name))+'</option>').join('')+'</select></label><span role="status">'+esc(text('range',{first:total?offset+1:0,last:Math.min(offset+4,total),total}))+'</span><div class="inline-actions">'+button('previous','previous',offset===0)+button('next','next',offset+4>=total)+'</div><label>'+esc(text('position'))+'<input data-retained-position type="number" min="1" max="'+Math.max(1,total)+'" value="'+(offset+1)+'" required></label>'+button('go','go',!total)+'</nav>'+
    (s.compare?'<details open data-retained-current><summary>'+esc(text('comparison'))+'</summary><p>'+esc(text('comparisonPinned'))+'</p>'+(current?'<h3>'+esc(current.header.title)+'</h3>'+view(current,s):'<p>'+esc(text('removed'))+'</p>')+'</details><h3>'+esc(text('retained'))+'</h3>':'')+view(previous,s))+
   '</div><div class="dialog-actions">'+(!loading&&!error?button(s.compare?'refreshComparison':'compare',s.compare?'refresh':'compare'):'')+button('close','close')+'</div></div>');
  // Structural anchors identify the retained version. A visible comparison
  // must not capture its links or duplicate those document-wide identities.
  const currentView=dialog.querySelector('[data-retained-current]');
  if(currentView){
   const ids=new Map();for(const node of currentView.querySelectorAll('[id]')){ids.set(node.id,'retained-current-'+node.id);node.id=ids.get(node.id);}
   for(const node of currentView.querySelectorAll('*'))for(const attribute of [...node.attributes]){
    let value=attribute.value;
    if(['href','xlink:href'].includes(attribute.name)&&value.startsWith('#')&&ids.has(value.slice(1)))value='#'+ids.get(value.slice(1));
    if(['aria-labelledby','aria-describedby'].includes(attribute.name))value=value.split(' ').map(id=>ids.get(id)??id).join(' ');
    value=value.replace(/url\(#([^)]+)\)/g,(match,id)=>ids.has(id)?'url(#'+ids.get(id)+')':match);
    if(value!==attribute.value)node.setAttribute(attribute.name,value);
   }
  }
  materialReferenceElements(dialog,s.namespaceId??s.ref.workspaceId);
  dialog.querySelector('h2').focus({preventScroll:true});
 }
 async function load(s,{anchor}={}){
  s.request?.abort();const request=new AbortController(),epoch=++serial;s.request=request;s.busy=true;render(s,{loading:true});
  try{
   let result,cursor;const read=materialReferenceReader({api,local:(name,data,options)=>api('/api/research/materials/'+name,data,{...options,owner:s.owner}),onOwner:result=>{if(valid(s)&&epoch===serial){s.namespaceId=result.namespaceId;s.mediaOwner=result.projectId;}}});
   do{
    result=await read('record',{ref:s.ref,offset:s.offset,windows:s.windows,compare:s.compare,...(s.currentSnapshotId?{currentSnapshotId:s.currentSnapshotId}:{}),...(anchor?{anchor}:{}),...(cursor?{cursor}:{})},{adopt:false,signal:request.signal,owner:s.owner});
    if(!valid(s)||epoch!==serial)return;cursor=result.search?.nextCursor;
   }while(cursor);
   if(result.ref?.id!==s.ref.id||result.ref.revision!==s.ref.revision||!result.previous?.record||result.previous.record.id!==s.ref.id)throw Error(text('unavailable'));
   s.result=result;s.currentSnapshotId=result.currentSnapshotId;s.offset=result.offset;s.windows=Object.fromEntries(names.filter(name=>name!=='sections').map(name=>[name,Math.max(result.previous.collections[name]?.offset??0,result.current?.collections[name]?.offset??0)]));s.busy=false;render(s);
   if(anchor){const selected=dialog.querySelector('[id="'+anchor+'"]');if(selected){selected.tabIndex=-1;selected.focus();selected.scrollIntoView({block:'start'});}else{const message=document.createElement('p');message.setAttribute('role','status');message.textContent=text('selectorMissing');dialog.querySelector('.record-history-content').prepend(message);}}
  }catch(error){if(valid(s)&&epoch===serial&&!request.signal.aborted){s.busy=false;render(s,{error:error.message??text('unavailable')});}}
 }
 dialog.addEventListener('click',event=>{
  const control=event.target.closest('[data-retained-action]'),s=session;if(!control||!valid(s))return;event.preventDefault();event.stopPropagation();const action=control.dataset.retainedAction;
  if(action==='close'){stop();dialog.close();return;}if(s.busy||control.disabled)return;
  if(action==='compare'||action==='refresh'){s.compare=true;s.currentSnapshotId=null;void load(s);return;}
  if(action==='retry'){void load(s,{anchor:s.anchor});return;}
  const windows=[s.result.previous,s.result.current].filter(Boolean).map(page=>s.collection==='sections'?page.sections:page.collections[s.collection]);let offset=Math.max(0,...windows.map(page=>page?.offset??0))+(action==='previous'?-4:4);
  if(action==='go'){const input=dialog.querySelector('[data-retained-position]');if(!input.reportValidity())return;offset=Number(input.value)-1;}
  if(s.collection==='sections')s.offset=Math.max(0,offset);else s.windows={...s.windows,[s.collection]:Math.max(0,offset)};
  void load(s);
 });
 dialog.addEventListener('change',event=>{const s=session;if(valid(s)&&event.target.matches('[data-retained-collection]')){s.collection=event.target.value;render(s);dialog.querySelector('[data-retained-collection]').focus();}});
 return {stop,async open(target,{owner=researchOwner(state)}={}){stop();const {selector,...ref}=target;
  const s={ref,owner,mediaOwner:owner,context:state.storage?.contextId,workspaceId:state.book?.id,collection:'sections',offset:0,windows:{},compare:false,result:null,anchor:selector?selectorAnchor(selector):null};session=s;await load(s,{anchor:s.anchor});
 }};
}
