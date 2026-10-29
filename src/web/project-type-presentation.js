import './i18n/catalogues/projectEditors.js';
import {t} from './i18n/index.js';
import profiles from './locales/en/labBookTypes.json' with {type:'json'};

// Saved project kinds and template labels remain source data. Only display
// known built-in values through the selected interface language.
const labels=new Map(Object.entries(profiles).filter(([key])=>key.endsWith('.label')).map(([key,label])=>[label,key.slice(0,-6)]));
export const labBookProfileLabel=(id,fallback=id)=>Object.hasOwn(profiles,id+'.label')?t('labBookTypes',id+'.label'):fallback;
export const projectKindLabel=kind=>!kind||kind==='Project'?t('projectEditors','project'):labels.has(kind)?labBookProfileLabel(labels.get(kind)):kind;
export const projectToolLabel=(id,fallback=id)=>id==='resources'?t('projectEditors','inventoryTool'):id==='planning'?t('projectEditors','planningTool'):fallback;
