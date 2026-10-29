import './i18n/catalogues/materialEditors.js';
import {t} from './i18n/index.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=key=>esc(t('materialEditors',key));
const button=(label,action,extra='')=>`<button type="button" class="button" data-action="material-${action}" ${extra}>${label}</button>`;
export function researchMaterialsLaunch(subject,{readonly=false}={}){
 return `<section class="research-links"><header><h3>${text('evidenceAnalysis')}</h3>${button(text('openEvidenceAnalysis'),'open',readonly?'data-readonly="true"':'')}</header><p class="muted">${text(readonly?'readEvidenceHelp':'privateEvidenceHelp')}</p>${!readonly&&subject?.type==='run'?button(esc(t('recordWorkflow','repeatTitle')),'repeat'):''}</section>`;
}
