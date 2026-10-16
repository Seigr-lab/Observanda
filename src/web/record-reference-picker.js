import {researchReference} from './research-reference.js';
import {t} from './i18n/index.js';
export function recordReferencePicker({state,api,esc,notify}){
 const text=(key,args)=>t('book',key,args),dialog=document.createElement('dialog');dialog.className='record-reference-picker';dialog.setAttribute('aria-labelledby','reference-picker-title');document.body.append(dialog);
 let owner=null,controller=null,page=null,trail=[],cursor=null,pending=null,busy=false,error='',copying=false,generation=0;
 const identity=()=>state.page==='record-reader'&&state.book&&!state.newWorkspace&&!state.access?.locked&&!state.storageUnavailable?JSON.stringify([state.storage?.contextId,state.book.id,state.selected]):null;
 const active=()=>owner!==null&&owner===identity()&&dialog.open;
 const button=(key,action)=>'<button type="button" class="button" data-reference-command="'+action+'">'+esc(text(key))+'</button>';
 function close(){generation++;controller?.abort();controller=null;owner=null;pending=null;page=null;trail=[];busy=false;copying=false;dialog.close();dialog.innerHTML='';}
 function paint(){
  if(!active())return;
  dialog.querySelector('[data-reference-error]').textContent=error;
  dialog.querySelector('[data-reference-status]').textContent=busy?text('selectorLoading'):page?.items.length?text('selectorRange',{first:page.first,last:page.last}):text('selectorEmpty');
  for(const input of dialog.querySelectorAll('input,select'))input.disabled=busy||copying;
  for(const node of dialog.querySelectorAll('[data-reference-command]')){
   const action=node.dataset.referenceCommand;
   node.disabled=action!=='close'&&(busy||copying||action==='previous'&&!trail.length||action==='next'&&!page?.next||action==='copy'&&!page?.items.length);
   if(action==='stop'){node.hidden=!busy;node.disabled=false;}
   if(action==='retry')node.hidden=!pending||busy;
  }
 }
 async function load(request,nextTrail=[],start=request.cursor??null,retry=false){
  controller?.abort();const operation=new AbortController();controller=operation;
  const fallback=dialog.querySelector('[data-reference-fallback]');fallback.hidden=true;fallback.value='';
  pending=retry?pending:{request:{...request},trail:nextTrail,start};busy=true;error='';paint();
  try{
   for(;;){
    const command=pending.request,result=await api('/api/workspace/read/record-selectors',command,{adopt:false,signal:operation.signal});
    if(operation.signal.aborted||controller!==operation||!active())return;
    if(result.workspaceId!==command.workspaceId||result.recordId!==command.recordId||command.snapshotId&&result.etag!==command.snapshotId||result.next&&result.next===command.cursor)throw Error(text('unavailable'));
    if(!result.items.length&&result.next){pending.request={...command,snapshotId:result.etag,cursor:result.next};continue;}
    page={...result,search:command.search??''};trail=pending.trail;cursor=pending.start;pending=null;
    dialog.querySelector('#book-selector').innerHTML=result.items.map((s,i)=>'<option value="'+i+'">'+esc(s.label||s.kind)+'</option>').join('');break;
   }
  }catch(failure){if(!operation.signal.aborted&&controller===operation&&active())error=failure.message||text('unavailable');}
  finally{if(controller===operation){controller=null;busy=false;paint();}}
 }
 function command(after){return {workspaceId:state.book.id,recordId:state.selected,snapshotId:page.etag,search:page.search,...(after?{cursor:after}:{})};}
 async function copy(){
  if(!page?.items.length||busy||copying)return;
  const item=page.items[Number(dialog.querySelector('#book-selector').value)],target={workspaceId:page.workspaceId,kind:'record',id:page.recordId,selector:{version:1,kind:item.kind,id:item.id}},captured=generation;
  copying=true;error='';paint();const valid=()=>active()&&captured===generation;
  const fallback=dialog.querySelector('[data-reference-fallback]');fallback.hidden=true;fallback.value='';
  try{
   if(dialog.querySelector('#book-selector-version').value==='exact'){
    const pinned=await api('/api/research/materials/pin',{id:page.recordId,expectedRevision:page.revision},{adopt:false});if(!valid())return;
    if(pinned.workspaceId!==page.workspaceId||pinned.id!==page.recordId||pinned.kind!=='record'||pinned.revision!==page.revision)throw Error(text('unavailable'));target.revision=pinned.revision;
   }
   const reference=researchReference(target);
   try{await navigator.clipboard.writeText(reference);if(valid()){close();notify(text('copied'));}}
   catch{if(valid()){const fallback=dialog.querySelector('[data-reference-fallback]');fallback.hidden=false;fallback.value=reference;fallback.focus();fallback.select();}}
  }catch(failure){if(valid())error=failure.message||text('unavailable');}
  finally{if(valid()){copying=false;paint();}}
 }
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('change',()=>{const fallback=dialog.querySelector('[data-reference-fallback]');if(fallback){fallback.hidden=true;fallback.value='';}});
 dialog.addEventListener('click',event=>{
  const action=event.target.closest('[data-reference-command]')?.dataset.referenceCommand;if(!action)return;event.preventDefault();
  if(action==='close'){close();return;}
  if(action==='stop'){controller?.abort();controller=null;busy=false;error=text('selectorStopped');paint();return;}
  if(busy||copying||!active())return;
  if(action==='copy'){void copy();return;}
  if(action==='retry'&&pending){void load(pending.request,pending.trail,pending.start,true);return;}
  if(action==='next'&&page?.next){void load(command(page.next),[...trail,cursor]);return;}
  if(action==='previous'&&trail.length){void load(command(trail.at(-1)),trail.slice(0,-1));return;}
  if(action==='search'||action==='refresh'){
   const search=dialog.querySelector('[data-reference-search]').value.trim();
   void load({workspaceId:state.book.id,recordId:state.selected,search,...(action==='search'&&page?{snapshotId:page.etag}:{})});
  }
 });
 dialog.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('[data-reference-search]')){event.preventDefault();dialog.querySelector('[data-reference-command="search"]').click();}});
 return {checkContext(){if(owner!==null&&owner!==identity())close();},open(){
  close();owner=identity();if(!owner)return;
  dialog.innerHTML='<h2 id="reference-picker-title">'+esc(text('selectorTitle'))+'</h2><div class="record-section-find"><label>'+esc(text('selectorSearch'))+'<input type="search" maxlength="160" data-reference-search></label>'+button('selectorFind','search')+'</div><p role="status" data-reference-status></p><label>'+esc(text('chooseSelector'))+'<select id="book-selector"></select></label><div class="inline-actions">'+button('selectorPrevious','previous')+button('selectorNext','next')+'</div><label>'+esc(text('version'))+'<select id="book-selector-version"><option value="current">'+esc(text('current'))+'</option><option value="exact">'+esc(text('exact'))+'</option></select></label><p role="alert" data-reference-error></p><textarea readonly hidden data-reference-fallback aria-label="'+esc(text('copy'))+'"></textarea><div class="dialog-actions">'+button('cancel','close')+button('selectorRefresh','refresh')+button('selectorStop','stop')+button('selectorRetry','retry')+button('copyButton','copy')+'</div>';
  dialog.showModal();void load({workspaceId:state.book.id,recordId:state.selected,snapshotId:state.etag});
 }};
}
