
import {moduleChildren,enabledModule} from './feature-modules.js';
export function modulePreferences({settings,esc,error,configuration}){
 function branch(module){
  const enabled=enabledModule(settings,module.id),children=moduleChildren(module.id),label=module.settingsHeading??module.label;
  return `<section class="module-preference-branch" data-module-preference="${module.id}">
   <${module.required?'div':'label'} class="desk-module"><span><strong>${esc(label)}</strong><small>${esc(module.description)}</small>
   ${module.sectionLabels?.length?`<small class="module-section-preview">${module.sectionLabels.map(esc).join(' · ')}</small>`:''}
   ${error(module.id)?`<small class="desk-error">${module.required?'Could not load lab-book tools. Reload the application to retry.':'Could not load this module. Turn it off and on to retry.'}</small>`:''}
   </span>${module.required?'':`<input type="checkbox" role="switch" aria-label="Enable ${esc(module.label)}" data-desk-module="${module.id}" ${enabled?'checked':''} ${children.length?`aria-controls="submodules-${module.id}" aria-expanded="${enabled}"`:''}>`}</${module.required?'div':'label'}>
   ${enabled?configuration(module):''}
   ${children.length&&enabled?`<div class="module-preference-children" id="submodules-${module.id}" role="group" aria-label="${esc(label)}"><p class="module-children-hint">${esc(module.childrenDescription??'Choose the submodules you use. Turning a module off keeps your data and settings.')}</p>${children.map(branch).join('')}</div>`:''}
   </section>`;
 }
 return `<section class="desk-modules">${moduleChildren().filter(module=>!module.required||moduleChildren(module.id).length).map(branch).join('')}</section>`;
}
