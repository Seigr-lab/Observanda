// The website editor's left sidebar: every way to add to and shape the website, as one list of
// sections that expand and collapse in place. The sidebar itself collapses to a slim strip of
// section pictures, like the application's own navigation, so the page gets the window's width.
const icon=paths=>'<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+paths+'</svg>';
// kind page: a panel of the page editor (several may be open); tool: a site tool shown in its section
// while it is open (one at a time, it is the editor's mode); sheet: a tool that opens beside the page.
const SECTIONS=[
 {id:'add',key:'railAdd',kind:'page',action:'left-add',picture:icon('<path d="M12 5v14M5 12h14"/>')},
 {id:'layers',key:'railLayers',kind:'page',action:'left-layers',picture:icon('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>')},
 {id:'content',key:'railContent',kind:'page',action:'left-content',picture:icon('<path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M17 7h2v13H8M8 9h6M8 13h6"/>')},
 {id:'pages',key:'pagePanel',kind:'tool',action:'pages',mode:'pages',picture:icon('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>')},
 {id:'menu',key:'menu',kind:'tool',action:'menu',mode:'menu',picture:icon('<path d="M4 6h16M4 12h16M4 18h16"/>')},
 {id:'appearance',key:'siteAppearance',kind:'sheet',action:'appearance',group:true,picture:icon('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/>')},
 {id:'themes',key:'designThemes',kind:'sheet',action:'themes',picture:icon('<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.9 1.2-1.8-.5-1-.1-2.2 1.1-2.2H17a4 4 0 0 0 4-4c0-5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>')},
 {id:'styles',key:'styleLibrary',kind:'sheet',action:'styles',picture:icon('<path d="M5 19L19 5M7 5h4M5 7v4M13 19h6v-6"/>')},
 {id:'regions',key:'regions',kind:'tool',action:'regions',mode:'regions',picture:icon('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M3 16h18"/>')},
 {id:'galleries',key:'gallery',kind:'tool',action:'galleries',mode:'gallery',group:true,picture:icon('<rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5-5 4 4 3-3 4 4"/>')},
 {id:'media',key:'recordings',kind:'tool',action:'media',mode:'media',picture:icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/>')},
 {id:'exchange',key:'designExchange',kind:'tool',action:'exchange',mode:'exchange',group:true,picture:icon('<path d="M7 7h11l-3-3M17 17H6l3 3"/>')},
 {id:'versions',key:'versionsTitle',kind:'tool',action:'versions',mode:'versions',picture:icon('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>')}
];
const PAGE_SECTIONS=SECTIONS.filter(section=>section.kind==='page').map(section=>section.id);
const TOOL_MODES=new Map(SECTIONS.filter(section=>section.kind==='tool').map(section=>[section.action,section.mode]));
const chevron='<svg class="website-sidebar-chevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m7 10 5 5 5-5"/></svg>';
const besidePage='<svg class="website-sidebar-chevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M10 5v14"/></svg>';
// The same picture as the application's navigation toggle: a panel with its edge and an arrow.
// side start: the panel is on the left; end: on the right. open: the arrow points to where it closes.
export function panelToggleIcon(side,open){
 const divider=side==='start'?'M9 4v16':'M15 4v16',arrow=side==='start'?(open?'m17 9-3 3 3 3':'m14 9 3 3-3 3'):(open?'m7 9 3 3-3 3':'m10 9-3 3 3 3');
 return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="'+divider+'"/><path d="'+arrow+'"/></svg>';
}
// What each viewer last chose: open sections and collapsed panels. Storage can be absent or refuse.
const STORE='observanda.website.editor.layout';
function load(){
 try{const value=JSON.parse(localStorage.getItem(STORE)??'null');if(value&&typeof value==='object')return value;}catch{}
 return null;
}
export function websiteEditorLayout(){
 const saved=load();
 const open=new Set(Array.isArray(saved?.sections)?saved.sections.filter(id=>PAGE_SECTIONS.includes(id)):['add']);
 const state={collapsed:saved?.collapsed===true,inspector:saved?.inspector===true};
 const remember=()=>{try{localStorage.setItem(STORE,JSON.stringify({sections:[...open],collapsed:state.collapsed,inspector:state.inspector}));}catch{}};
 return {
  isOpen:id=>open.has(id),
  setOpen(id,value){if(!PAGE_SECTIONS.includes(id))return;if(value)open.add(id);else open.delete(id);remember();},
  get collapsed(){return state.collapsed;},set collapsed(value){state.collapsed=Boolean(value);remember();},
  get inspector(){return state.inspector;},set inspector(value){state.inspector=Boolean(value);remember();}
 };
}
export function websiteEditorSidebar({t,esc,layout}){
 // A site tool's section shows while its tool is the editor's mode; the page panels show in the visual editor.
 function view({mode,visual,panel='',close='visual',bodies={}}){
  const toolOpen=section=>section.kind==='tool'&&section.mode===mode;
  const strip=SECTIONS.map(section=>{
   const current=section.kind==='page'?visual&&layout.isOpen(section.id):toolOpen(section);
   return (section.group?'<span class="website-sidebar-rule" aria-hidden="true"></span>':'')+'<button type="button" class="website-sidebar-icon" data-action="website-files-'+section.action+'" data-sidebar-reveal="'+section.id+'" title="'+esc(t(section.key))+'"'+(current?' aria-current="true"':'')+(section.kind==='sheet'?' aria-haspopup="dialog"':'')+'>'+section.picture+'<span class="website-hidden-label">'+esc(t(section.key))+'</span></button>';
  }).join('');
  const dock=body=>'<div class="website-files-dock-head">'+body+'</div>';
  const closeButton='<button type="button" class="button subtle" data-action="website-files-'+esc(close)+'">'+esc(t('closePanel'))+'</button>';
  // A docked task that has no section of its own (publishing, releases, checks) opens at the top.
  const ownSection=SECTIONS.some(toolOpen);
  // The task names itself in its own panel; its own close is its way back.
  const taskSection=panel&&!ownSection?'<section class="website-sidebar-section website-files-dock" data-sidebar-section="task"><div class="website-sidebar-body">'+dock(closeButton)+panel+'</div></section>':'';
  const sections=SECTIONS.map(section=>{
   const id='website-sidebar-'+section.id,label='<span class="website-sidebar-label">'+esc(t(section.key))+'</span>';
   const rule=section.group?' data-sidebar-group':'';
   if(section.kind==='sheet')return '<section class="website-sidebar-section" data-sidebar-section="'+section.id+'"'+rule+'><h3 class="website-sidebar-heading"><button type="button" class="website-sidebar-toggle" data-action="website-files-'+section.action+'" aria-haspopup="dialog">'+section.picture+label+besidePage+'</button></h3></section>';
   const open=section.kind==='page'?visual&&layout.isOpen(section.id):toolOpen(section);
   const body=section.kind==='page'?(visual?bodies[section.id]??'':''):open?dock(closeButton)+panel:'';
   return '<section class="website-sidebar-section'+(section.kind==='tool'&&open?' website-files-dock':'')+'" data-sidebar-section="'+section.id+'"'+rule+(open?' data-open':'')+'><h3 class="website-sidebar-heading"><button type="button" class="website-sidebar-toggle" data-action="website-files-'+section.action+'" aria-expanded="'+open+'" aria-controls="'+id+'">'+section.picture+label+chevron+'</button></h3><div class="website-sidebar-body" id="'+id+'"'+(open?'':' hidden')+'>'+body+'</div></section>';
  }).join('');
  const collapsed=layout.collapsed;
  return '<aside class="website-sidebar" tabindex="0" aria-label="'+esc(t('siteTools'))+'"'+(collapsed?' data-collapsed':'')+'>'+
   '<div class="website-sidebar-strip" id="website-sidebar-strip"'+(collapsed?'':' hidden')+'><button type="button" class="website-sidebar-icon website-panel-toggle" data-action="website-files-sidebar-expand" aria-expanded="false" aria-controls="website-sidebar-panel" aria-label="'+esc(t('sidebarExpand'))+'" title="'+esc(t('sidebarExpand'))+'">'+panelToggleIcon('start',false)+'</button><span class="website-sidebar-rule" aria-hidden="true"></span>'+strip+'</div>'+
   '<div class="website-sidebar-panel" id="website-sidebar-panel"'+(collapsed?' hidden':'')+'><div class="website-sidebar-head"><h2>'+esc(t('siteTools'))+'</h2><button type="button" class="website-panel-toggle" data-action="website-files-sidebar-collapse" aria-expanded="true" aria-controls="website-sidebar-panel" aria-label="'+esc(t('sidebarCollapse'))+'" title="'+esc(t('sidebarCollapse'))+'">'+panelToggleIcon('start',true)+'</button></div>'+
   '<div class="website-sidebar-sections">'+taskSection+sections+'</div></div></aside>';
 }
 // Shows the stored open sections and collapsed state on the screen as it is, so the page stays loaded.
 function paint(root=document){
  const aside=root.querySelector('.website-sidebar');if(!aside)return;
  const collapsed=layout.collapsed;
  aside.toggleAttribute('data-collapsed',collapsed);aside.closest('.website-files-editor,.website-files-code-layout')?.toggleAttribute('data-sidebar-collapsed',collapsed);
  aside.querySelector('.website-sidebar-strip').hidden=!collapsed;aside.querySelector('.website-sidebar-panel').hidden=collapsed;
 }
 function paintSection(id,open,root=document){
  const section=root.querySelector('.website-sidebar [data-sidebar-section="'+id+'"]');if(!section)return;
  section.toggleAttribute('data-open',open);section.querySelector('.website-sidebar-toggle').setAttribute('aria-expanded',String(open));
  section.querySelector('.website-sidebar-body').hidden=!open;
  root.querySelector('.website-sidebar-strip [data-sidebar-reveal="'+id+'"]')?.toggleAttribute('aria-current',open);
 }
 // An opened section moves to the top of the sidebar, just under its heading, so what it holds is in view.
 function reveal(id,root=document){
  const aside=root.querySelector('.website-sidebar'),section=aside?.querySelector('[data-sidebar-section="'+id+'"]');if(!section||aside.hasAttribute('data-collapsed'))return;
  const head=aside.querySelector('.website-sidebar-head');
  aside.scrollTop+=section.getBoundingClientRect().top-(head?head.getBoundingClientRect().bottom:aside.getBoundingClientRect().top);
 }
 // Up and Down move between the section headings (or the strip's pictures), Home and End to the first and last.
 function bind(root=document){
  const aside=root.querySelector('.website-sidebar');if(!aside)return;
  aside.onkeydown=event=>{
   if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||event.altKey||event.ctrlKey||event.metaKey)return;
   const stops=[...aside.querySelectorAll(':scope>.website-sidebar-strip:not([hidden])>button,:scope>.website-sidebar-panel:not([hidden]) .website-sidebar-toggle')];
   const index=stops.indexOf(event.target);if(index<0)return;
   event.preventDefault();
   const next=event.key==='Home'?0:event.key==='End'?stops.length-1:(index+(event.key==='ArrowDown'?1:-1)+stops.length)%stops.length;
   stops[next].focus();
  };
 }
 return {view,paint,paintSection,reveal,bind,pageSections:PAGE_SECTIONS,toolMode:action=>TOOL_MODES.get(action)};
}
