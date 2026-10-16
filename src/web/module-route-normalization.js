import {FEATURE_MODULES} from './feature-modules.js';
import {normalizeScopePath} from './modules/scope.js';

// A restored address names the same screen after normalization. Replace that
// history entry before activation can render, preserving its owner and state.
export function replaceRestoredModuleRoute(state,{current,history,routeFor,modules=FEATURE_MODULES}){
 if(!current()||state.page!=='module')return null;
 const location=modules.find(module=>module.id===state.moduleId)?.locationTool;
 if(!location)return null;
 const path=normalizeScopePath(state.modulePath??'',location.path);
 if(path===state.modulePath)return null;
 const next=routeFor({...state,modulePath:path});
 history.replaceState(history.state,'',next);state.modulePath=path;
 return next;
}
