import {t} from './i18n/index.js';
// Shared page controls and scroll targets respect all fixed application chrome.
export function workspaceViewportTop(...controls) {
 const root=document.documentElement,header=document.querySelector('.topbar')?.getBoundingClientRect().bottom??0;
 const topMenu=root.dataset.navigation==='top'&&root.dataset.contextNavigation==='open';
 return Math.max(header,topMenu?document.querySelector('#main-navigation')?.getBoundingClientRect().bottom??0:0,...controls.filter(el=>el&&getComputedStyle(el).position==='sticky').map(el=>el.getBoundingClientRect().bottom));
}

// Navigation visibility is a user choice, independent of research and page drafts.
export function shellNavigation() {
  let page=null, override=null, preference=null,compact=false,compactOpen=false,observedTopbar=null,observedMenu=null;
  const measureTopbar=()=>document.documentElement.style.setProperty('--shell-topbar-height',(observedTopbar?.getBoundingClientRect().height??76)+'px');
  const topbarObserver=new ResizeObserver(measureTopbar);
  const measureMenu=()=>document.documentElement.style.setProperty('--shell-navigation-height',(observedMenu?.getBoundingClientRect().height??0)+'px');
  const menuObserver=new ResizeObserver(measureMenu);
  try{const value=localStorage.getItem('observanda.menu.open');if(value!==null)override=value==='true';}catch{}
  const remember=()=>{try{localStorage.setItem('observanda.menu.open',String(override));}catch{}};
  function apply(next=page) {
    page=next;const nextCompact=window.innerWidth<=760;if(nextCompact!==compact){compact=nextCompact;compactOpen=false;}
    const root=document.documentElement, collapsed=root.dataset.navigationCollapsed==='true';
    if(preference!==null&&preference!==collapsed){override=!collapsed;remember();}preference=collapsed;
    const open=compact?compactOpen:override??!collapsed, drawer=open&&compact;
    root.dataset.contextNavigation=open?(drawer?'drawer':'open'):'closed';
    root.dataset.editorPage=page??'';
    const topbar=document.querySelector('.topbar');if(topbar!==observedTopbar){topbarObserver.disconnect();observedTopbar=topbar;if(topbar)topbarObserver.observe(topbar);}measureTopbar();
    const menu=document.querySelector('#main-navigation');
    if(menu!==observedMenu){menuObserver.disconnect();observedMenu=menu;if(menu)menuObserver.observe(menu);}measureMenu();
    if(menu){menu.inert=!open;menu.setAttribute('aria-hidden',String(!open));}
    document.querySelectorAll('#main,.workspace-heading').forEach(el=>el.inert=drawer);
    document.querySelectorAll('[data-action="shell-menu"]').forEach(b=>{b.setAttribute('aria-expanded',String(open));b.title=t('navigation',open?'closeMenu':'openMenu');b.querySelector('.menu-chevron')?.setAttribute('d',open?'m17 9-3 3 3 3':'m14 9 3 3-3 3');});
    document.querySelectorAll('[data-action="shell-menu-close"]').forEach(b=>b.hidden=!drawer);
  }
  window.addEventListener('resize',()=>apply());
  document.addEventListener('observanda:interface-layout',()=>apply());
  function close(){if(compact)compactOpen=false;else{override=false;remember();}apply();document.querySelector('[data-action="shell-menu"]')?.focus();}
  document.addEventListener('keydown',e=>{if(e.key==='Tab'&&document.documentElement.dataset.contextNavigation==='drawer'){const stops=[...document.querySelectorAll('#main-navigation button,#main-navigation a,#main-navigation summary,[data-action="shell-menu"]')].filter(el=>!el.disabled&&el.tabIndex>=0&&el.checkVisibility()&&!el.closest('[inert]'));const index=stops.indexOf(document.activeElement);if(stops.length){e.preventDefault();stops[(index+(e.shiftKey?-1:1)+stops.length)%stops.length].focus();}}if(e.key==='Escape'&&document.documentElement.dataset.contextNavigation!=='closed'&&(document.documentElement.dataset.contextNavigation==='drawer'||e.target.closest?.('#main-navigation,[data-action="shell-menu"]'))&&!document.querySelector('dialog[open]')){e.preventDefault();close();}});
  return {apply,beforeAction(button){if(document.documentElement.dataset.contextNavigation==='drawer'&&button.closest?.('#main-navigation'))close();},action(button){if(button.dataset.action==='shell-menu'){const open=document.documentElement.dataset.contextNavigation==='closed';if(compact)compactOpen=open;else{override=open;remember();}apply();if(open&&compact)document.querySelector('#main-navigation .nav-button')?.focus();return true;}if(button.dataset.action==='shell-menu-close'){close();return true;}return false;}};
}
