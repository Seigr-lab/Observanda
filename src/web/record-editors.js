import {retryModule} from './retry-module.js';
import {deferredDialog} from './deferred-dialog.js';
import {researchContext} from './project-context.js';
import {t} from './i18n/index.js';

// Reading controls are eager; opening or recovering selected writing/values
// loads the corresponding editor. Lock invalidates even a lock/unlock cycle
// which finishes before the chunk arrives.
export function deferredRecordEditor(options,load){
 const {state}=options;let generation=0;
 const changed=()=>Error(t('recordWriting','changedWorkspace'));
 const ui=deferredDialog({load:()=>load().then(create=>()=>create(options)),context:()=>JSON.stringify([generation,researchContext(state),state.storage?.contextId,state.book?.id,state.page,state.selected,state.access?.locked]),changed});
 const invoke=(method,args)=>state.access?.locked?Promise.reject(changed()):ui.invoke(method,...args);
 return {
  open:(...args)=>invoke('open',args),
  recover:(...args)=>invoke('recover',args),
  locked(){generation++;ui.current()?.locked();}
 };
}

// A dialog whose code failed to load once is fetched again on the next open (retry-module.js).
const writingModule=retryModule(()=>import('./record-writing-ui.js'),'/record-writing-ui.js'),valuesModule=retryModule(()=>import('./record-values-ui.js'),'/record-values-ui.js');
export const recordWritingUI=options=>deferredRecordEditor(options,()=>writingModule().then(module=>module.recordWritingUI));
export const recordValuesUI=options=>deferredRecordEditor(options,()=>valuesModule().then(module=>module.recordValuesUI));
