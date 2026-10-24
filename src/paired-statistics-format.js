import {AppError} from './errors.js';
// Recipe generation admits pairing semantics; operation names alone do not.
export const pairedStatisticsMaterial=value=>value?.content?.aggregation?.version===5;
export const pairedStatisticsCommand=value=>value?.aggregation?.version===5;
export function pairedStatisticsMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return pairedStatisticsCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(pairedStatisticsMaterial(value))return true;
 if(relative.startsWith('.observanda/materials/aggregation-work/'))return value?.version===5;
 return relative.startsWith('.observanda/materials/tables/')&&Array.isArray(value)&&value.some(row=>Array.isArray(row?.aggregation)&&row.aggregation.some(metric=>metric&&Object.hasOwn(metric,'pairedStatistic')));
}
export async function assertPairedStatisticsFormat(workspace){
 if(typeof workspace.storageKind!=='function')return;
 await workspace.catalogue(async store=>{
  const {catalogueFormat,catalogueRequiresPairedStatistics,catalogueRequiresQuantileAggregation,catalogueRequiresMeasurementScalarPolicies,catalogueRequiresDatasetResourcePolicies}=await import('./catalogue-format.js'),format=await catalogueFormat(store.catalogueDb??store.db);
  if(![catalogueRequiresPairedStatistics,catalogueRequiresQuantileAggregation,catalogueRequiresMeasurementScalarPolicies,catalogueRequiresDatasetResourcePolicies].every(required=>required(format)))throw new AppError('CATALOGUE_DAMAGED');
 });
}
