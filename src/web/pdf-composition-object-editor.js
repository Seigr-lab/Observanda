// The page designer borrows the selected object's existing controls. The
// rich selection, validation, autosave and edition history keep one owner.
export function pdfCompositionObjectEditor({root,getSection,docs,tr}){
 let closeCurrent=null;
 function close(){closeCurrent?.();}
 function open(target){
  close();if(!target)return;
  const host=root(),section=getSection();if(!host||!section)return;
  const title=target.kind==='title',block=target.kind==='block',image=target.kind==='image';
  const control=title?host.querySelector('[data-pdf-section="title"]')?.closest('label'):
   block?host.querySelector('[data-document-key="'+section.id+'"]'):
   image?host.querySelector('[data-pdf-image="'+target.id+'"]'):host.querySelector('[data-pdf-notes]');
  if(!control)return;
  const id=block?'block:'+target.index:image?'image:'+target.id:target.kind;
  const origin=host.querySelector('[data-pdf-composition-handle="'+id+'"]');
  const dialog=document.createElement('dialog'),heading=document.createElement('h2'),done=document.createElement('button');
  const location=document.createComment('page object controls');
  heading.textContent=tr(title?'section':block?'compositionBlock':image?'imageTitle':'notesTitle');
  heading.id='pdf-page-object-title';dialog.setAttribute('aria-labelledby',heading.id);dialog.className='pdf-page-object-editor';dialog.dataset.pdfObjectEditor='';
  done.type='button';done.className='button';done.textContent=tr('compositionBackToPage');
  control.before(location);dialog.append(heading,control,done);host.append(dialog);
  const wasOpen=control.tagName==='DETAILS'?control.open:null;if(wasOpen!==null)control.open=true;
  closeCurrent=()=>{
   closeCurrent=null;if(dialog.open)dialog.close();location.replaceWith(control);
   if(wasOpen!==null)control.open=wasOpen;dialog.remove();
   if(origin?.isConnected&&!origin.closest('[inert],[hidden]'))origin.focus({preventScroll:true});
  };
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();},{once:true});
  done.addEventListener('click',close,{once:true});dialog.showModal();
  if(block)void docs.focusTopLevelBlock(section.id,target.index,()=>dialog.open&&dialog.isConnected);
  else control.querySelector(title?'input':image?'[data-pdf-image-field="alt"]':'[contenteditable="true"]')?.focus();
 }
 return {open,close};
}
