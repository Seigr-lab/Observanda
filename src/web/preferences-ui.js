import {enabledModule,moduleForPage} from './feature-modules.js';
import {t,language} from './i18n/index.js';
import {aboutView} from './about-ui.js';
const tabs=[
 ['preferences','general'],['user-profile',null],['dashboard-settings','modules'],['appearance','appearance'],
 ['integrations','integrations'],['storage','storage'],['help','help']
];
// Labels are obtained at render time so mounted navigation can change language.
export const preferencePage=page=>tabs.some(([id])=>id===page);
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function preferencesFrame(page,content,settings){
 const available=tabs.filter(([id])=>{const module=moduleForPage(id);return !module||enabledModule(settings,module.id);});
 const label=key=>escape(key===null?t('userProfile','title'):t('preferences',key));
 if(page==='preferences')content+=aboutView(escape);
 return `<div class="preferences-heading" lang="${language()}"><h1>${label('title')}</h1></div><label class="preferences-mobile field" lang="${language()}">${label('section')}<select id="preferences-section" aria-label="${label('section')}">${available.map(([id,key])=>`<option value="${id}" ${page===id?'selected':''}>${label(key)}</option>`).join('')}</select></label><nav class="preferences-tabs" lang="${language()}" aria-label="${label('sections')}">${available.map(([id,key])=>`<button class="button ${page===id?'primary':''}" data-action="${id}" ${page===id?'aria-current="page"':''}>${label(key)}</button>`).join('')}</nav><div class="preferences-content">${content}</div>`;
}
