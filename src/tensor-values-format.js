import {AppError} from './errors.js';
// Declaration generation, never the codec name alone, admits tensor semantics.
export const tensorDeclaration=value=>value?.representation==='domain'&&value.domain?.version===3;
export const tensorValuesMaterial=value=>value?.content?.tensorValues===1||value?.content?.tool==='Observanda calculation graph'&&value.content.graphVersion===10||value?.content?.calculation?.version===13||value?.content?.columns?.some(tensorDeclaration)===true;
export const tensorValuesCommand=value=>value?.calculation?.version===13||value?.columns?.some(tensorDeclaration)===true||value?.columnChanges?.some(change=>tensorDeclaration(change.column))===true;
export function tensorValuesMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return tensorValuesCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(tensorValuesMaterial(value))return true;
 if(!relative.startsWith('.observanda/materials/sequences/chunks/'))return false;
 return ['columns','columns-policy'].includes(value?.kind)&&value.items?.some(tensorDeclaration)===true||value?.kind==='cells'&&value.items?.some(cell=>cell.value?.format==='domain-value'&&cell.value.version===4)===true||value?.kind==='calculation-nodes'&&value.items?.some(node=>node.kind==='domain-reshape')===true;
}
export async function assertTensorValuesFormat(workspace){if(typeof workspace.storageKind!=='function')return;await workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresTensorValues}=await import('./catalogue-format.js');if(!catalogueRequiresTensorValues(await catalogueFormat(store.catalogueDb??store.db)))throw new AppError('CATALOGUE_DAMAGED');});}
