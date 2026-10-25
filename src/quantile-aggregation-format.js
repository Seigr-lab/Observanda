import {AppError} from './errors.js';
export const quantileAggregationMaterial=value=>[4,5,6,7].includes(value?.content?.aggregation?.version);
export const quantileAggregationCommand=value=>[4,5,6,7].includes(value?.aggregation?.version);
export function quantileAggregationMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return quantileAggregationCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(quantileAggregationMaterial(value))return true;
 if(relative.startsWith('.observanda/materials/aggregation-work/'))return [4,5,6,7].includes(value?.version);
 return relative.startsWith('.observanda/materials/tables/')&&Array.isArray(value)&&value.some(row=>row.aggregation?.some(metric=>Object.hasOwn(metric,'quantile')));
}
export async function assertQuantileAggregationFormat(workspace){if(typeof workspace.storageKind!=='function')return;await workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresQuantileAggregation,catalogueRequiresMeasurementScalarPolicies,catalogueRequiresDatasetResourcePolicies}=await import('./catalogue-format.js');const format=await catalogueFormat(store.catalogueDb??store.db);if(!catalogueRequiresQuantileAggregation(format)||!catalogueRequiresMeasurementScalarPolicies(format)||!catalogueRequiresDatasetResourcePolicies(format))throw new AppError('CATALOGUE_DAMAGED');});}
