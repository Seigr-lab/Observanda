import {AppError} from './errors.js';
export const spectrumCommand=value=>[1,2,3].includes(value?.spectrum?.version);
export const spectrumMaterial=value=>value?.content?.tool==='Observanda dataset spectrum'||value?.content?.spectra===1||spectrumCommand(value?.content)||[1,2,3].includes(value?.content?.measurement?.spectrum?.version);
export function spectrumMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return spectrumCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(spectrumMaterial(value))return true;
 if(relative.startsWith('.observanda/materials/tables/'))return Array.isArray(value)&&value.some(row=>[1,2,3].includes(row?.spectrum?.version));
 return relative.startsWith('.observanda/materials/sequences/chunks/')&&['columns','columns-policy'].includes(value?.kind)&&value.items?.some(column=>[1,2,3].includes(column?.spectrum?.version))===true;
}
export const spectrumCatalogueRequirements=Object.freeze(['catalogueRequiresDatasetSpectra','catalogueRequiresComputedCells','catalogueRequiresNativeDomainValues','catalogueRequiresNativeNumericalModels','catalogueRequiresCalculationPolicies','catalogueRequiresStructuredCalculator','catalogueRequiresApproximateCalculator','catalogueRequiresMeasurementScalarPolicies','catalogueRequiresDatasetResourcePolicies']);
export async function assertSpectrumFormat(workspace){
 if(typeof workspace.storageKind!=='function')return;
 await workspace.catalogue(async store=>{const format=await import('./catalogue-format.js'),generation=await format.catalogueFormat(store.catalogueDb??store.db);if(!spectrumCatalogueRequirements.every(name=>typeof format[name]==='function'&&format[name](generation)))throw new AppError('CATALOGUE_DAMAGED');});
}
