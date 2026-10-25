import {AppError} from './errors.js';
const marker=value=>value?.weightedFit!==undefined;
export const weightedFitCommand=value=>value?.aggregation?.version===7||value?.columns?.some(marker)===true||value?.columnChanges?.some(change=>marker(change?.column))===true||marker(value?.measurement);
export const weightedFitMaterial=value=>value?.content?.weightedFits===1||weightedFitCommand(value?.content);
export function weightedFitMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return weightedFitCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(weightedFitMaterial(value))return true;
 if(relative.startsWith('.observanda/materials/aggregation-work/'))return value?.version===7;
 if(relative.startsWith('.observanda/materials/tables/'))return Array.isArray(value)&&value.some(row=>Array.isArray(row?.aggregation)&&row.aggregation.some(marker));
 return relative.startsWith('.observanda/materials/sequences/chunks/')&&['columns','columns-policy'].includes(value?.kind)&&value.items?.some(marker)===true;
}
export const weightedFitCatalogueRequirements=Object.freeze(['WeightedFit','PairedStatistics','QuantileAggregation','ComputedCells','CalculationPolicies','StructuredCalculator','ApproximateCalculator','MeasurementScalarPolicies','DatasetResourcePolicies','NativeNumericalModels'].map(name=>'catalogueRequires'+name));
export async function assertWeightedFitFormat(workspace){
 if(typeof workspace.storageKind!=='function')return;
 await workspace.catalogue(async store=>{const format=await import('./catalogue-format.js'),generation=await format.catalogueFormat(store.catalogueDb??store.db);if(!weightedFitCatalogueRequirements.every(name=>format[name](generation)))throw new AppError('CATALOGUE_DAMAGED');});
}
