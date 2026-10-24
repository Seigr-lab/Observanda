import {AppError} from './errors.js';
export const quantileAggregationMaterial=value=>value?.content?.aggregation?.version===4;
export const quantileAggregationCommand=value=>value?.aggregation?.version===4;
export function quantileAggregationMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return quantileAggregationCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(quantileAggregationMaterial(value))return true;
 if(relative.startsWith('.observanda/materials/aggregation-work/'))return value?.version===4;
 return relative.startsWith('.observanda/materials/tables/')&&Array.isArray(value)&&value.some(row=>row.aggregation?.some(metric=>Object.hasOwn(metric,'quantile')));
}
export async function assertQuantileAggregationFormat(workspace){if(typeof workspace.storageKind!=='function')return;await workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresQuantileAggregation,catalogueRequiresMeasurementScalarPolicies,catalogueRequiresDatasetResourcePolicies}=await import('./catalogue-format.js');const format=await catalogueFormat(store.catalogueDb??store.db);if(!catalogueRequiresQuantileAggregation(format)||!catalogueRequiresMeasurementScalarPolicies(format)||!catalogueRequiresDatasetResourcePolicies(format))throw new AppError('CATALOGUE_DAMAGED');});}
