import {t,messageLanguage} from './i18n/index.js';
export function workspaceDatabaseUI({state,esc}){
 const m=key=>esc(t('access',key));
 function panel(){
  const db=state.storage?.database;if(!db)return '';
  return `<section data-i18n-region="access" lang="${messageLanguage('access')}"><h3>${m('databaseLocation')}</h3><p>${m(db.placement==='workspace'?'databaseOwned':'databaseExternal')}</p>${db.path?`<p class="storage-path">${esc(db.path)}</p>`:''}</section>`;
 }
 return {panel};
}
