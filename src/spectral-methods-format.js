import {AppError} from './errors.js';
import {spectrumCatalogueRequirements} from './dataset-spectrum-format.js';
export const spectralMethodsCommand=value=>value?.spectrum?.version===3;
export const spectralMethodsMaterial=value=>value?.content?.spectralMethods===1||spectralMethodsCommand(value?.content)||value?.content?.measurement?.spectrum?.version===3||value?.content?.columns?.some(column=>column?.spectrum?.version===3)===true;
export function spectralMethodsMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return spectralMethodsCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(spectralMethodsMaterial(value))return true;
 if(relative.startsWith('.observanda/materials/numerical-work/'))return value?.kind==='spectrum'&&value.cursor?.version===2;
 if(relative.startsWith('.observanda/materials/tables/'))return Array.isArray(value)&&value.some(row=>row?.spectrum?.version===3);
 if(!relative.startsWith('.observanda/materials/sequences/chunks/'))return false;
 return ['columns','columns-policy'].includes(value?.kind)&&value.items?.some(column=>column?.spectrum?.version===3)===true||value?.kind==='calculation-nodes'&&value.items?.some(node=>node?.value?.spectrum?.version===3)===true;
}
export const spectralMethodsCatalogueRequirements=Object.freeze(['catalogueRequiresSpectralMethods','catalogueRequiresNumericalExecution',...spectrumCatalogueRequirements]);
export async function assertSpectralMethodsFormat(workspace){if(typeof workspace.storageKind!=='function')return;await workspace.catalogue(async store=>{const format=await import('./catalogue-format.js'),generation=await format.catalogueFormat(store.catalogueDb??store.db);if(!spectralMethodsCatalogueRequirements.every(name=>typeof format[name]==='function'&&format[name](generation)))throw new AppError('CATALOGUE_DAMAGED');});}
