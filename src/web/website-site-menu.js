// One menu in the editor's top bar for the website's less frequent tasks
// (other websites, review, releases, checks, destination, download),
// so the bar itself shows only the website, the page, the save state and
// publishing. Choosing a task, pressing Escape or clicking elsewhere closes it;
// a redraw of the editor keeps it as the author left it.
export function websiteSiteMenu({esc}){
 const selector='[data-website-site-menu]';let open=false;
 function view({label,groups}){
  const content=groups.filter(group=>group.items).map(group=>'<div class="website-site-menu-group" role="group"'+(group.label?' aria-label="'+esc(group.label)+'"':'')+'>'+(group.label?'<span class="website-task-label" aria-hidden="true">'+esc(group.label)+'</span>':'')+group.items+'</div>').join('');
  return '<details class="website-site-menu" data-website-site-menu'+(open?' open':'')+'><summary class="button">'+esc(label)+'</summary><div class="website-site-menu-list">'+content+'</div></details>';
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
