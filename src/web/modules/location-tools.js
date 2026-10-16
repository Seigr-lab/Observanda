import {FEATURE_MODULES,enabledModule} from '../feature-modules.js';
import {projectToolScope} from '../project-tools.js';
import {scopePath} from './scope.js';
import {t} from '../i18n/index.js';
export const availableLocationTools=(settings,modules=FEATURE_MODULES)=>modules.filter(m=>m.locationTool&&enabledModule(settings,m.id,modules));
export const locationTools=(settings,book,projectId,modules=FEATURE_MODULES)=>availableLocationTools(settings,modules).filter(m=>projectToolScope(book,projectId,m.id));
export const locationToolLabel=(book,id,module)=>projectToolScope(book,id,module.id)==='overview'?t('locationTools','overview',{name:module.locationTool.label}):module.locationTool.label;
export function locationToolsView(state,id,esc){
 return `<nav class="location-tools" aria-label="${esc(t('locationTools','label'))}">${locationTools(state.dashboardSettings,state.book,id).map(m=>`<button class="button" data-action="module-open" data-module-id="${m.id}" ${id==null?'data-module-workspace="true"':'data-module-project-id="'+id+'"'} data-module-path="${scopePath(id,m.locationTool.path)}"><strong>${esc(locationToolLabel(state.book,id,m))}</strong><small data-location-tool-count="${m.id}" role="status"></small></button>`).join('')}<span data-location-tool-error></span></nav>`;
}
