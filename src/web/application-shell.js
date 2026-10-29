import {t,language} from './i18n/index.js';
import {captureFocus,restoreFocus,focusMain,restorePendingFocus} from './focus-management.js';
// Owns the application frame. Feature views render into the page outlet;
// navigation and header lifetime never depend on which feature is displayed.
export function applicationShell({root,mark,navigation,applyLayout,pageKey=()=>location.hash}) {
  let frame=null,previousPage=null;
  function mount() {
    root.innerHTML=`<div class="shell">
      <header class="topbar">
        <button class="shell-menu" data-action="shell-menu" aria-label="" aria-controls="main-navigation" aria-expanded="false" title=""><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path class="menu-divider" d="M9 4v16"/><path class="menu-chevron" d="m14 9 3 3-3 3"/></svg></button>
        <div class="shell-activity" data-activity-slot></div>
      </header>
      <button class="shell-menu-backdrop" data-action="shell-menu-close" tabindex="-1" aria-label="" hidden></button>
      <aside class="sidebar" id="main-navigation"><a href="#" class="brand" data-action="workspace-refresh">${mark}Observanda</a></aside>
      <div class="navigation-resizer" role="separator" aria-label="" aria-orientation="vertical" aria-controls="main-navigation" tabindex="0"></div>
      <div class="main-area"><main id="main" class="main" tabindex="-1"></main></div>
    </div>`;
    frame={shell:root.querySelector('.shell'),sidebar:root.querySelector('#main-navigation'),topbar:root.querySelector('.topbar'),main:root.querySelector('#main')};
  }
  return {
    showWorkspace(renderContent) {
      const nextPage=pageKey(),changed=previousPage!==null&&previousPage!==nextPage;
      const focused=frame?.main.contains(document.activeElement)?captureFocus():null;
      const mounted=!frame;
      if(mounted)mount();
      const resumed=!frame.shell.isConnected;
      if(resumed)root.replaceChildren(frame.shell);
      for(const [selector,attribute,key] of [['.shell-menu','aria-label','menu'],['.shell-menu','title','openMenu'],['.shell-menu-backdrop','aria-label','closeMenu'],['.navigation-resizer','aria-label','resize']]){
        const node=frame.shell.querySelector(selector);node.setAttribute(attribute,t('navigation',key));node.lang=language();
      }
      const navigationChanged=navigation.update(frame.sidebar,frame.topbar);
      frame.main.innerHTML=renderContent();
      const heading=frame.main.querySelector('h1');
      document.title=heading?.textContent.trim()?heading.textContent.trim()+' · Observanda':'Observanda';
      previousPage=nextPage;
      if(mounted||resumed||navigationChanged)applyLayout();
      if(resumed)frame.sidebar.scrollTop=frame.sidebarScroll??0;
      if(changed&&(focused||document.activeElement===document.body)&&!document.querySelector('dialog[open]'))focusMain();
      else restoreFocus(focused,{fallback:false});
      restorePendingFocus();
    },
    // Loading another view pauses this frame; project disclosures and navigation
    // nodes still belong to the same workspace when the read finishes.
    showLoading(content) {
      if(frame?.shell.isConnected)frame.sidebarScroll=frame.sidebar.scrollTop;
      root.innerHTML=content;
    },
    // Workspace access and setup are separate application lifecycles.
    showStandalone(content) {
      navigation.unmount();frame=null;previousPage=null;root.innerHTML=content;document.title='Observanda';
    }
  };
}
