import {localizedText} from './i18n/index.js';
const text=localizedText('operationProgress');
const units=new Set(['files','folders','books','bytes','rows','snapshots','checkpoints','records','projects','items','objects','blocks','indexes']);
// A newer operation may introduce a unit before this client knows its label.
// Keep its measurements readable without interrupting the completion response.
export const progressUnit=unit=>text(units.has(unit)?unit:'items');
