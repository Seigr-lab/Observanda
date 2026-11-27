// A menu in the editor's top bar: the websites menu (other websites, managing this one)
// and the screen size control. Choosing a task, pressing Escape or clicking elsewhere
// closes it; a redraw of the editor keeps it as the author left it.
// summary: markup for the button that opens it (label when absent), named by label when it
// is an icon; body: its own content instead of groups of tasks.
export function websiteSiteMenu({esc,name='site'}){
 const selector='[data-website-site-menu="'+name+'"]';let open=false;
 function view({label,groups=[],summary=null,icon=false,body=null,className=''}){
  const content=body??groups.filter(group=>group.items).map(group=>'<div class="website-site-menu-group" role="group"'+(group.label?' aria-label="'+esc(group.label)+'"':'')+'>'+(group.label?'<span class="website-task-label" aria-hidden="true">'+esc(group.label)+'</span>':'')+group.items+'</div>').join('');
  return '<details class="website-site-menu'+(className?' '+className:'')+'" data-website-site-menu="'+name+'"'+(open?' open':'')+'><summary class="button"'+(icon?' aria-label="'+esc(label)+'" title="'+esc(label)+'"':'')+'>'+(summary??esc(label))+'</summary><div class="website-site-menu-list">'+content+'</div></details>';
 }
 function close(doc=document,{focus=false}={}){
  open=false;const menu=doc.querySelector(selector+'[open]');if(!menu)return;
  menu.open=false;if(focus)menu.querySelector('summary')?.focus();
 }
 let bound=null;
 function bind(doc=document){
  if(bound===doc)return;bound=doc;
  doc.addEventListener('toggle',event=>{if(event.target.matches?.(selector))open=event.target.open;},true);
  doc.addEventListener('pointerdown',event=>{if(!event.target.closest?.(selector))close(doc);});
  doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&event.target.closest?.(selector+'[open]')){event.preventDefault();close(doc,{focus:true});}});
  // A chosen task closes the menu; the task itself runs through the editor's actions.
  doc.addEventListener('click',event=>{if(event.target.closest?.(selector+' .website-site-menu-list [data-action]'))close(doc);});
 }
 function reset(){open=false;}
 return {view,bind,close,reset};
}
