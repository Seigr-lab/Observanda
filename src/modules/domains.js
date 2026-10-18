// Storage ownership is explicit. A command may join participating owners in
// one project database transaction; unrelated domains keep independent locks.
import {AppError} from '../errors.js';
const owners={
 calculator:['calculation'],stoichiometry:['reaction'],spreadsheet:['sheet'],
 chemistry:['chemical'],timeline:['timeline-view'],
 inventory:['category','resource','movement','reservation','stock-transfer','asset-transfer'],
 bom:['bom'],tasks:['task'],equipment:['booking'],
 calendars:['calendar','event','subscription','calendar-connection'],
 samples:[],pdf:[],
 laboratory:['lab-space','lab-entry']
};
export const moduleDomains=Object.freeze(Object.keys(owners).sort());
const types=new Map(Object.entries(owners).flatMap(([domain,types])=>types.map(type=>[type,domain])));
export const moduleDomainOf=type=>types.get(type)??null;
export function moduleDomain(type){const domain=moduleDomainOf(type);if(!domain)throw new AppError('MODULE_FORMAT');return domain;}
export function validModuleDomain(domain){return moduleDomains.includes(domain);}
