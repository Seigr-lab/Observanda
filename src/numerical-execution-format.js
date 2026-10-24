import {AppError} from './errors.js';
export const numericalExecutionCommand=value=>value?.spectrum?.version===2||value?.cusum?.version===1;
export const numericalExecutionMaterial=value=>value?.content?.numericalExecution===1||numericalExecutionCommand(value?.content)||value?.content?.measurement?.spectrum?.version===2||value?.content?.measurement?.cusum?.version===1;
export function numericalExecutionMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return numericalExecutionCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(relative.startsWith('.observanda/materials/numerical-work/')||['nodes','values','chunks'].some(kind=>relative.startsWith('.observanda/materials/sequences/numerical-work-'+kind+'/')))return true;
 if(numericalExecutionMaterial(value))return true;
 return relative.startsWith('.observanda/materials/sequences/chunks/')&&['columns','columns-policy'].includes(value?.kind)&&value.items?.some(column=>column?.spectrum?.version===2||column?.cusum?.version===1)===true;
}
export const numericalExecutionCatalogueRequirements=Object.freeze(['catalogueRequiresNumericalExecution','catalogueRequiresDatasetResourcePolicies']);
export async function assertNumericalExecutionFormat(workspace){
 if(typeof workspace.storageKind!=='function')return;
 await workspace.catalogue(async store=>{const format=await import('./catalogue-format.js'),generation=await format.catalogueFormat(store.catalogueDb??store.db);if(!numericalExecutionCatalogueRequirements.every(name=>typeof format[name]==='function'&&format[name](generation)))throw new AppError('CATALOGUE_DAMAGED');});
}
