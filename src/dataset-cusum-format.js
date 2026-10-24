import {AppError} from './errors.js';
export const cusumCommand=value=>value?.cusum?.version===1;
export const cusumMaterial=value=>value?.content?.tool==='Observanda dataset CUSUM'||value?.content?.cusums===1||cusumCommand(value?.content)||value?.content?.measurement?.cusum?.version===1;
export function cusumMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return cusumCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(relative.startsWith('.observanda/materials/numerical-work/'))return value?.kind==='cusum';
 if(cusumMaterial(value))return true;
 if(relative.startsWith('.observanda/materials/tables/'))return Array.isArray(value)&&value.some(row=>row?.cusum?.version===1);
 return relative.startsWith('.observanda/materials/sequences/chunks/')&&['columns','columns-policy'].includes(value?.kind)&&value.items?.some(column=>column?.cusum?.version===1)===true;
}
export const cusumCatalogueRequirements=Object.freeze(['catalogueRequiresDatasetCusum','catalogueRequiresNumericalExecution','catalogueRequiresComputedCells','catalogueRequiresNativeNumericalModels','catalogueRequiresCalculationPolicies','catalogueRequiresStructuredCalculator','catalogueRequiresApproximateCalculator','catalogueRequiresMeasurementScalarPolicies','catalogueRequiresDatasetResourcePolicies']);
export async function assertCusumFormat(workspace){
 if(typeof workspace.storageKind!=='function')return;
 await workspace.catalogue(async store=>{const format=await import('./catalogue-format.js'),generation=await format.catalogueFormat(store.catalogueDb??store.db);if(!cusumCatalogueRequirements.every(name=>typeof format[name]==='function'&&format[name](generation)))throw new AppError('CATALOGUE_DAMAGED');});
}
