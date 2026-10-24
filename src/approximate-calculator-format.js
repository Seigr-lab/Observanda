import {AppError} from './errors.js';
export const approximateCalculatorMaterial=value=>value?.content?.tool==='Observanda clock synchronization'&&value.content.computation!==undefined||value?.content?.approximateComputations===1||value?.content?.measurement?.computation!==undefined||value?.content?.summary?.computation!==undefined||value?.content?.recipe?.version===3&&value.content.tool==='Observanda calculator recipe'||value?.content?.calculatorResult?.version===3;
export const approximateCalculatorCommand=value=>!!value&&(value.calculatorResult?.version===3||value.measurement?.computation!==undefined||value.columns?.some(column=>column?.computation!==undefined)||value.columnChanges?.some(change=>change.column?.computation!==undefined));
export function approximateCalculatorMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return approximateCalculatorCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(approximateCalculatorMaterial(value))return true;
 if(relative.startsWith('.observanda/materials/comparison-work/'))return value?.summary?.computation!==undefined;
 if(relative.startsWith('.observanda/materials/figures/value/'))return value?.type==='property'&&value.name==='computation'||value?.type==='inline'&&value.value?.computation!==undefined;
 return relative.startsWith('.observanda/materials/sequences/chunks/')&&['columns','columns-policy'].includes(value?.kind)&&Array.isArray(value.items)&&value.items.some(column=>column?.computation!==undefined);
}
export async function ensureApproximateCalculatorFormat(workspace){await workspace.catalogue(async store=>{const {requireApproximateCalculator}=await import('./catalogue-format.js');await requireApproximateCalculator(store.catalogueDb??store.db);});}
export async function assertApproximateCalculatorFormat(workspace){await workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresApproximateCalculator}=await import('./catalogue-format.js');if(!catalogueRequiresApproximateCalculator(await catalogueFormat(store.catalogueDb??store.db)))throw new AppError('CATALOGUE_DAMAGED');});}
