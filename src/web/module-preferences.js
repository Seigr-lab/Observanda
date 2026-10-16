import {moduleChildren,enabledModule} from './feature-modules.js';
import {t,language} from './i18n/index.js';
import labBookMessages from './locales/en/labBookTypes.json' with {type:'json'};

const translated=(module,field,fallback)=>{const key=module.labBookType?.id+'.'+field;return Object.hasOwn(labBookMessages,key)?t('labBookTypes',key):fallback;};
const label=module=>translated(module,'label',module.settingsHeading??module.label);
const description=module=>translated(module,'description',module.description);
export const sortedPreferenceModules=modules=>[...modules].sort((a,b)=>label(a).localeCompare(label(b),language(),{sensitivity:'base'})||a.id.localeCompare(b.id));

function branches({settings,esc,error,configuration},roots){
 function branch(module){
  const enabled=enabledModule(settings,module.id),children=sortedPreferenceModules(moduleChildren(module.id)),title=label(module);
  return `<section class="module-preference-branch" data-module-preference="${module.id}">
   <${module.required?'div':'label'} class="desk-module"><span><strong>${esc(title)}</strong><small>${esc(description(module))}</small>
   ${module.sectionLabels?.length?`<small class="module-section-preview">${module.sectionLabels.map(esc).join(' \u00b7 ')}</small>`:''}
   ${error(module.id)?`<small class="desk-error">${esc(t('templatePreferences','loadFailed'))}</small>`:''}
   </span>${module.required?'':`<input type="checkbox" role="switch" aria-label="${esc(t('templatePreferences','enable',{name:title}))}" data-desk-module="${module.id}" ${enabled?'checked':''} ${children.length?`aria-controls="submodules-${module.id}" aria-expanded="${enabled}"`:''}>`}</${module.required?'div':'label'}>
   ${enabled?configuration(module):''}
   ${children.length&&enabled?`<div class="module-preference-children" id="submodules-${module.id}" role="group" aria-label="${esc(title)}">${children.map(branch).join('')}</div>`:''}
   </section>`;
 }
 return sortedPreferenceModules(roots).map(branch).join('');
}
export function modulePreferences(services){
 const modules=moduleChildren().filter(module=>module.id!=='research'&&(!module.required||moduleChildren(module.id).length));
 return `<section class="desk-modules">${branches(services,modules)}</section>`;
}
export function templatePreferences(services){
 const {esc}=services;
 return `<section class="desk-modules"><h2>${esc(t('templatePreferences','title'))}</h2><p>${esc(t('templatePreferences','intro'))}</p><div role="group" aria-label="${esc(t('templatePreferences','title'))}">${branches(services,moduleChildren('research'))}</div></section>`;
}
