import {measurementScalarPolicies} from './measurement-scalar-storage.js';
import {AppError} from './errors.js';
export const measurementScalarMaterial=value=>{const c=value?.content;return !!c&&(c.tool==='Observanda clock synchronization'||c.scalarPolicies===1||[3,4,5].includes(c.aggregation?.version)||c.comparison?.version===3||[7,8,9,10,11,12,13,14,15,16].includes(c.graphVersion)&&c.tool==='Observanda calculation graph'||[10,11,12,13,14,15,16,17,18,19].includes(c.calculation?.version)||c.measurement?.version===2||measurementScalarPolicies(c.measurement));};
export function measurementScalarCommand(value){return !!value&&([10,11,12,13,14,15,16,17,18,19].includes(value.calculation?.version)||[3,4,5].includes(value.aggregation?.version)||value.comparison?.version===3||[7,8,9,10,11,12,13,14,15,16].includes(value.graphVersion)||value.measurement?.version===2||measurementScalarPolicies(value.measurement)||value.columns?.some(measurementScalarPolicies)||value.columnChanges?.some(change=>measurementScalarPolicies(change.column)));}
export function measurementScalarMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return measurementScalarCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(relative.startsWith('.observanda/materials/sequences/chunks/'))return value?.kind==='columns-policy'||['columns','calculation-nodes'].includes(value?.kind)&&value.items?.some(measurementScalarPolicies)||value?.kind==='cells'&&value.items?.some(cell=>cell.value?.format==='domain-value'&&[3,4,5].includes(cell.value.version))||value?.kind==='domain-components'&&value.items?.some(item=>item.spelling?.format==='dataset-cell');
 return measurementScalarMaterial(value);
}
export async function assertMeasurementScalarFormat(workspace){if(typeof workspace.storageKind!=='function')return;await workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresMeasurementScalarPolicies}=await import('./catalogue-format.js');if(!catalogueRequiresMeasurementScalarPolicies(await catalogueFormat(store.catalogueDb??store.db)))throw new AppError('CATALOGUE_DAMAGED');});}
