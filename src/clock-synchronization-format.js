import {AppError} from './errors.js';
export const clockSynchronizationMaterial=value=>value?.content?.tool==='Observanda clock synchronization'||value?.content?.tool==='Observanda calculation graph'&&[9,10,11].includes(value.content.graphVersion)||[12,13,14].includes(value?.content?.calculation?.version)||value?.content?.clockSynchronization===1||value?.content?.measurement?.synchronization!==undefined||value?.content?.columns?.some(column=>column.synchronization!==undefined)===true;
export function clockSynchronizationMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/')){const command=value?.input?.command;return [12,13,14].includes(command?.calculation?.version)||command?.columns?.some(column=>column.synchronization!==undefined)||command?.columnChanges?.some(change=>change.column?.synchronization!==undefined);}
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(clockSynchronizationMaterial(value))return true;
 return relative.startsWith('.observanda/materials/sequences/chunks/')&&(['columns','columns-policy'].includes(value?.kind)&&value.items?.some(column=>column.synchronization!==undefined)||value?.kind==='calculation-nodes'&&value.items?.some(node=>node.kind==='clock-synchronize')||value?.kind==='calculation-lineage'&&value.items?.some(leaf=>leaf.synchronization!==undefined));
}
export async function assertClockSynchronizationFormat(workspace){if(typeof workspace.storageKind!=='function')return;await workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresClockSynchronization}=await import('./catalogue-format.js');if(!catalogueRequiresClockSynchronization(await catalogueFormat(store.catalogueDb??store.db)))throw new AppError('CATALOGUE_DAMAGED');});}
