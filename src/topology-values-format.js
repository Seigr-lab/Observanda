import {AppError} from './errors.js';
import {sequenceValuesCatalogueRequirements} from './sequence-values-format.js';
export const topologyDeclaration=value=>value?.representation==='domain'&&value.domain?.version===4&&value.domain.codec==='observanda.topology';
const topologyValue=value=>value?.format==='domain-value'&&value.version===5&&value.definition?.version===4&&value.definition.codec==='observanda.topology';
export const topologyValuesMaterial=value=>value?.content?.topologyValues===1||value?.content?.tool==='Observanda calculation graph'&&value.content.graphVersion===16||value?.content?.calculation?.version===19||value?.content?.columns?.some(topologyDeclaration)===true||topologyDeclaration(value?.content?.measurement?.value);
export const topologyValuesCommand=value=>value?.calculation?.version===19||value?.columns?.some(topologyDeclaration)===true||value?.columnChanges?.some(change=>topologyDeclaration(change.column))===true||topologyDeclaration(value?.measurement?.value);
export function topologyValuesMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return topologyValuesCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(topologyValuesMaterial(value))return true;
 if(!relative.startsWith('.observanda/materials/sequences/chunks/'))return false;
 return ['topology-vertices','topology-edges'].includes(value?.kind)||['columns','columns-policy'].includes(value?.kind)&&value.items?.some(topologyDeclaration)===true||value?.kind==='cells'&&value.items?.some(cell=>topologyValue(cell.value))===true||value?.kind==='calculation-nodes'&&value.items?.some(node=>node.kind==='domain-topology')===true;
}
export const topologyValuesCatalogueRequirements=Object.freeze(['catalogueRequiresTopologyValues',...sequenceValuesCatalogueRequirements]);
export async function assertTopologyValuesFormat(workspace){if(typeof workspace.storageKind!=='function')return;await workspace.catalogue(async store=>{const format=await import('./catalogue-format.js'),generation=await format.catalogueFormat(store.catalogueDb??store.db);if(!topologyValuesCatalogueRequirements.every(name=>typeof format[name]==='function'&&format[name](generation)))throw new AppError('CATALOGUE_DAMAGED');});}
