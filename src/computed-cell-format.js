import {AppError} from './errors.js';
const interpreted=value=>value?.computation?.version===2;
export const computedCellCommand=value=>[6,7].includes(value?.aggregation?.version)||[17,18,19,20].includes(value?.calculation?.version)||value?.columns?.some(interpreted)===true||value?.columnChanges?.some(change=>interpreted(change?.column))===true;
export const computedCellMaterial=value=>computedCellCommand(value?.content)||value?.content?.cellComputations===1||value?.content?.tool==='Observanda calculation graph'&&[14,15,16,17].includes(value.content.graphVersion)||interpreted(value?.content?.measurement);
export function computedCellMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return computedCellCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(computedCellMaterial(value))return true;
 if(relative.startsWith('.observanda/materials/aggregation-work/'))return [6,7].includes(value?.version);
 if(relative.startsWith('.observanda/materials/tables/'))return Array.isArray(value)&&value.some(row=>row.aggregation?.some(metric=>metric?.pairedStatistic?.version===2||metric?.weightedFit!==undefined));
 if(!relative.startsWith('.observanda/materials/sequences/chunks/'))return false;
 return ['columns','columns-policy'].includes(value?.kind)&&value.items?.some(interpreted)===true||value?.kind==='cells'&&value.items?.some(cell=>Object.hasOwn(cell,'computation'))===true;
}
export async function assertComputedCellFormat(workspace){
 if(typeof workspace.storageKind!=='function')return;
 await workspace.catalogue(async store=>{
  const format=await import('./catalogue-format.js'),generation=await format.catalogueFormat(store.catalogueDb??store.db);
  if(!['catalogueRequiresComputedCells','catalogueRequiresCalculationPolicies','catalogueRequiresStructuredCalculator','catalogueRequiresApproximateCalculator','catalogueRequiresMeasurementScalarPolicies','catalogueRequiresDatasetResourcePolicies'].every(name=>format[name](generation)))throw new AppError('CATALOGUE_DAMAGED');
 });
}
