// Recovery belongs to the editor that authored it. Planning and inventory can
// retain several related draft types while their saved originals stay separate.
import {AppError} from '../errors.js';
const owners={
 'scientific-calculator':{domain:'calculator',types:['calculation']},
 stoichiometry:{domain:'stoichiometry',types:['reaction']},
 spreadsheet:{domain:'spreadsheet',types:['sheet']},
 'chemical-import':{domain:'chemistry',types:['chemical']},
 timeline:{domain:'timeline',types:['timeline-view']},
 resources:{domain:'inventory',types:['category','resource','movement','reservation','stock-transfer','asset-transfer','bom']},
 planning:{domain:'calendars',types:['task','booking','calendar','event','subscription','calendar-connection']}
};
export const moduleDraftOwners=Object.freeze(Object.keys(owners).sort());
export function moduleDraftDomain(moduleId){if(!Object.hasOwn(owners,moduleId))throw new AppError('ACCESS_UPGRADE');return owners[moduleId].domain;}
export function moduleDraftTypes(moduleId){moduleDraftDomain(moduleId);return owners[moduleId].types;}
