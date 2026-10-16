import {operationProgress} from './operation-progress-ui.js';
import {localizedText} from './i18n/index.js';
const text=localizedText('recordSaveProgress');
export const recordSaveProgress=()=>{
 const selected=document.querySelector('dialog.record-writing[open]');
 return operationProgress({stageText:text,title:()=>text('title'),hint:()=>text(selected?'selectedPending':'pending'),className:'record-save-progress',...(selected?{host:selected,before:selected.querySelector('[data-writing-error]')}:{before:document.querySelector('.section-save')}),disableControls:false});
};
