import {AppError} from './errors.js';
const tools=['Observanda uncertainty definition','Observanda statistical uncertainty'];
const column=value=>value?.statisticalUncertainty!==undefined;
export const statisticalUncertaintyCommand=value=>value?.uncertainty!==undefined||value?.columns?.some(column)===true||value?.columnChanges?.some(change=>column(change?.column))===true;
export const statisticalUncertaintyMaterial=value=>tools.includes(value?.content?.tool)||statisticalUncertaintyCommand(value?.content)||value?.content?.statisticalUncertainties!==undefined||value?.content?.measurement?.statisticalUncertainty!==undefined;
export function statisticalUncertaintyMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return statisticalUncertaintyCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(statisticalUncertaintyMaterial(value))return true;
 return relative.startsWith('.observanda/materials/sequences/chunks/')&&(['uncertainty-inputs','uncertainty-covariance'].includes(value?.kind)||['columns','columns-policy'].includes(value?.kind)&&value.items?.some(column)===true);
}
export async function assertStatisticalUncertaintyFormat(workspace){
 if(typeof workspace.storageKind!=='function')return;
 await workspace.catalogue(async store=>{
  const {catalogueFormat,catalogueRequiresStatisticalUncertainty,catalogueRequiresNativeNumericalModels,catalogueRequiresMeasurementScalarPolicies,catalogueRequiresDatasetResourcePolicies,catalogueRequiresStructuredCalculator,catalogueRequiresApproximateCalculator}=await import('./catalogue-format.js'),format=await catalogueFormat(store.catalogueDb??store.db);
  if(![catalogueRequiresStatisticalUncertainty,catalogueRequiresNativeNumericalModels,catalogueRequiresMeasurementScalarPolicies,catalogueRequiresDatasetResourcePolicies,catalogueRequiresStructuredCalculator,catalogueRequiresApproximateCalculator].every(required=>required(format)))throw new AppError('CATALOGUE_DAMAGED');
 });
}
