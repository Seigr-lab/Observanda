import {bookSelectors} from './book-selectors.js';
import {researchReference} from './research-reference.js';
import {t} from './i18n/index.js';
import {recordReferencePicker} from './record-reference-picker.js';
export function bookReferenceUI({state,esc,showDialog,notify,api,revisions}){
 const text=k=>t('book',k),picker=recordReferencePicker({state,api,esc,notify});let record=null;
 return {checkContext:picker.checkContext,button:()=>'<button class="button" data-action="record-content-reference">'+esc(text('copy'))+'</button>',async action(control){
  if(control.dataset.action==='record-content-reference'){
   if(state.page==='record-reader'){picker.open();return true;}
   record=structuredClone(state.book.entries.find(e=>e.id===state.selected));const selectors=bookSelectors(record);
   showDialog('<h2 id="dialog-title">'+esc(text('copy'))+'</h2><label>'+esc(text('chooseSelector'))+'<select id="book-selector">'+selectors.map((s,i)=>'<option value="'+i+'">'+esc(s.label||s.kind)+'</option>').join('')+'</select></label><label>'+esc(text('version'))+'<select id="book-selector-version"><option value="current">'+esc(text('current'))+'</option><option value="exact">'+esc(text('exact'))+'</option></select></label><div class="dialog-actions"><button class="button" data-action="close-dialog">'+esc(text('cancel'))+'</button><button class="button primary" data-action="record-content-copy"'+(!selectors.length?' disabled':'')+'>'+esc(text('copyButton'))+'</button></div>');return true;
  }
  if(control.dataset.action!=='record-content-copy')return false;
  const selector=bookSelectors(record)[Number(document.querySelector('#book-selector').value)],workspaceId=state.book.id,context=state.storage?.contextId,owner=record.id,dialog=control.closest('dialog');
  const active=()=>context===state.storage?.contextId&&!state.access?.locked&&state.selected===owner&&dialog.open&&control.isConnected;
  const target={workspaceId,kind:'record',id:owner,selector:{version:1,kind:selector.kind,id:selector.id}};
  control.disabled=true;
  try{
   if(document.querySelector('#book-selector-version').value==='exact'){
    if(state.dirty||!revisions()[owner])throw Error(t('recordWorkflow','saveFirst'));
    const revision=revisions()[owner],pinned=await api('/api/research/materials/pin',{id:owner,expectedRevision:revision},{adopt:false});
    if(!active())return true;
    if(pinned.workspaceId!==workspaceId||pinned.id!==owner||pinned.kind!=='record'||pinned.revision!==revision)throw Error(text('unavailable'));
    target.revision=pinned.revision;
   }
   const reference=researchReference(target);
   try{await navigator.clipboard.writeText(reference);if(active()){dialog.close();notify(text('copied'));}}
   catch{if(active())showDialog('<h2 id="dialog-title">'+esc(text('copy'))+'</h2><textarea readonly aria-label="'+esc(text('copy'))+'">'+esc(reference)+'</textarea><button class="button" data-action="close-dialog">'+esc(text('cancel'))+'</button>');}
  }finally{if(control.isConnected)control.disabled=false;}
  return true;
 }};
}
