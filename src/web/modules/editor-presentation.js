import '../i18n/catalogues/moduleEditors.js';
import {t} from '../i18n/index.js';
import {locationName} from '../workspace-structure.js';
import {projectToolScope} from '../project-tools.js';
// Presentation only: shared models and saved identifiers remain language-neutral.
export const m=(key,values)=>t('moduleEditors',key,values);
export const ownerLabel=(book,id)=>id?(locationName(book,id)||m('removedLocation')):m('workspaceName',{name:book.title});
export const inventoryLocation=(book,id)=>id?(locationName(book,id)||m('removedLocation')):m('centralStock',{name:book.title});
const states={available:'statusAvailable',hold:'statusHold',retired:'statusRetired',draft:'statusDraft',reserved:'statusReserved',finished:'statusFinished',cancelled:'statusCancelled',active:'statusActive',consumed:'statusConsumed',released:'statusReleased',todo:'statusTodo',doing:'statusDoing',done:'statusDone',confirmed:'statusConfirmed'};
export const statusLabel=value=>states[value]?m(states[value]):value;
export const priorityLabel=value=>({low:'priorityLow',normal:'priorityNormal',high:'priorityHigh'}[value]?m({low:'priorityLow',normal:'priorityNormal',high:'priorityHigh'}[value]):value);
export const bookingKindLabel=value=>value==='work'?m('bookingWork'):value==='maintenance'?m('bookingMaintenance'):value;
export function scopeControl(book,projectId,esc,{recursive=true,moduleId=null}={}){
 return `<div class="operations-scope"><label>${esc(m('showLocation'))}<select data-operation-scope><option value="">${esc(m('allLocations',{name:book.title}))}</option>${book.projects.filter(p=>!moduleId||projectToolScope(book,p.id,moduleId)).map(p=>`<option value="${p.id}" ${p.id===projectId?'selected':''}>${esc(locationName(book,p.id))}</option>`).join('')}</select></label>${projectId?`<label class="checkbox"><input type="checkbox" data-operation-descendants ${recursive?'checked':''}>${esc(m('includeLocations'))}</label>`:''}</div>`;
}
