// A website editor tool that opens beside the live page instead of over it:
// the dialog sits over the tool rail and the left column, the page stays in
// view, and the editor behind it is held still until the tool closes.
// Escape closes it as it would a modal dialog, through the same cancel event,
// so a tool that refuses to close while it works keeps refusing.
// wide: a tool with its own preview keeps its own width; others cover exactly the rail and the left column.
export function showSideSheet(dialog,{doc=document,wide=false}={}){
 const editor=doc.querySelector('[data-website-file-controls]'),area=doc.querySelector('.website-files-editor,.website-files-code-layout');
 dialog.classList.add('website-side-sheet');
 const place=()=>{
  const box=area?.getBoundingClientRect();if(!box)return;
  dialog.style.top=Math.max(8,box.top)+'px';dialog.style.left=Math.max(8,box.left)+'px';
  const column=area.querySelector(':scope > aside:not(.website-files-inspection)')?.getBoundingClientRect();
  if(!wide&&column)dialog.style.width=Math.max(416,Math.round(column.right-box.left))+'px';
  // A full-height column beside the page, like the editor's own panels.
  const height=Math.max(240,Math.min(box.bottom,doc.defaultView.innerHeight-8)-Math.max(8,box.top))+'px';dialog.style.height=dialog.style.maxHeight=height;
 };
 place();
 if(!dialog.isConnected)doc.body.append(dialog);
 dialog.show();
 if(editor)editor.inert=true;
 const resize=()=>place();doc.defaultView.addEventListener('resize',resize);
 const keys=event=>{
  if(event.key!=='Escape'||event.defaultPrevented||!dialog.open)return;
  // A dialog opened from the tool (a confirmation) closes first.
  if(doc.querySelector('dialog:modal'))return;
  event.preventDefault();const cancel=new Event('cancel',{cancelable:true});dialog.dispatchEvent(cancel);if(!cancel.defaultPrevented)dialog.close();
 };
 // Escape closes it wherever focus is, as it would a modal dialog.
 doc.addEventListener('keydown',keys);
 dialog.addEventListener('close',()=>{doc.defaultView.removeEventListener('resize',resize);doc.removeEventListener('keydown',keys);if(editor?.isConnected)editor.inert=false;},{once:true});
 const first=dialog.querySelector('[autofocus],select,input:not([type=hidden]),button,textarea,[tabindex]:not([tabindex="-1"])');first?.focus({preventScroll:true});
}
