import {AppError} from './errors.js';
const column=value=>value?.synchronization?.version===2;
export const segmentedClockSynchronizationCommand=value=>[15,16,17,18,19,20].includes(value?.calculation?.version)||value?.columns?.some(column)===true||value?.columnChanges?.some(change=>column(change?.column))===true;
export const segmentedClockSynchronizationMaterial=value=>value?.content?.tool==='Observanda clock synchronization'&&value.content.version===2||value?.content?.tool==='Observanda calculation graph'&&[12,13,14,15,16,17].includes(value.content.graphVersion)||segmentedClockSynchronizationCommand(value?.content)||value?.content?.segmentedClockSynchronization===1||column(value?.content?.measurement);
export function segmentedClockSynchronizationMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return segmentedClockSynchronizationCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(segmentedClockSynchronizationMaterial(value))return true;
 if(relative.startsWith('.observanda/materials/tables/'))return Array.isArray(value)&&value.some(row=>row?.calculationLineage?.outputExcluded!==undefined);
 if(!relative.startsWith('.observanda/materials/sequences/chunks/'))return false;
 return ['clock-sync-segments','clock-sync-anchors'].includes(value?.kind)||['columns','columns-policy'].includes(value?.kind)&&value.items?.some(column)===true||value?.kind==='calculation-lineage'&&value.items?.some(leaf=>leaf.synchronization?.version===2)===true;
}
export async function assertSegmentedClockSynchronizationFormat(workspace){
 if(typeof workspace.storageKind!=='function')return;
 await workspace.catalogue(async store=>{
  const {catalogueFormat,catalogueRequiresSegmentedClockSynchronization,catalogueRequiresClockSynchronization,catalogueRequiresMeasurementScalarPolicies,catalogueRequiresDatasetResourcePolicies}=await import('./catalogue-format.js'),format=await catalogueFormat(store.catalogueDb??store.db);
  if(![catalogueRequiresSegmentedClockSynchronization,catalogueRequiresClockSynchronization,catalogueRequiresMeasurementScalarPolicies,catalogueRequiresDatasetResourcePolicies].every(required=>required(format)))throw new AppError('CATALOGUE_DAMAGED');
 });
}
