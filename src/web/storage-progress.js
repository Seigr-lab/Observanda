import {operationProgress} from './operation-progress-ui.js';
import {localizedText} from './i18n/index.js';
import {storageProgressPresentation} from './storage-progress-presentation.js';
const text=localizedText('storageProgress');
export const storageProgress=()=>operationProgress({stageText:text,presentation:storageProgressPresentation,className:'storage-progress',compact:!document.querySelector('#dialog[open]')});
