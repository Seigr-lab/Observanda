import {t} from './i18n/index.js';
// The application's navigation as a drawer over the full-screen website editor,
// so an author reaches any project, lab book or tool without first going back.
// It lives outside the editor's view, so editor redraws never close it.
const ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="m14 9 3 3-3 3"/></svg>';
export function websiteFilesDrawer({navigation,esc}){
 let dialog=null,opener=null;
 function toggle(){
  const label=t('navigation','openMenu');
  return '<button type="button" class="button subtle website-files-drawer-toggle" data-action="website-files-drawer" aria-haspopup="dialog" aria-label="'+esc(label)+'" title="'+esc(label)+'">'+ICON+'<span>'+esc(t('navigation','menu'))+'</span></button>';
 }
 function build(){
  dialog=document.createElement('dialog');dialog.className='website-files-drawer';dialog.dataset.websiteFilesDrawer='';
  dialog.innerHTML='<aside class="sidebar website-files-drawer-navigation"><div class="website-files-drawer-head"><button type="button" class="button subtle" data-website-files-drawer-close></button></div></aside>';
  dialog.addEventListener('click',event=>{if(event.target===dialog||event.target.closest('[data-website-files-drawer-close]'))close();});
  dialog.addEventListener('close',()=>{const target=opener;opener=null;if(target?.isConnected)target.focus();else document.querySelector('[data-action="website-files-drawer"]')?.focus();});
  document.body.append(dialog);
 }
 function open(button){
  if(!dialog)build();
  const closer=dialog.querySelector('[data-website-files-drawer-close]');
  closer.textContent=t('navigation','closeMenu');dialog.setAttribute('aria-label',t('navigation','menu'));
  navigation.update(dialog.querySelector('aside'),dialog.querySelector('.website-files-drawer-head'));
  opener=button??null;if(!dialog.open)dialog.showModal();
  (dialog.querySelector('aside .nav-button.active,aside .nav-button')??closer).focus();
 }
 function close(){if(dialog?.open)dialog.close();}
 // Leaving the editor removes the drawer, so the workspace has one navigation.
 function remove(){if(!dialog)return;opener=null;if(dialog.open)dialog.close();navigation.unmount();dialog.remove();dialog=null;}
 const contains=element=>Boolean(dialog&&element&&dialog.contains(element));
 return {toggle,open,close,remove,contains};
}
