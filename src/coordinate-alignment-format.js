import {AppError} from './errors.js';
const marker=value=>value?.coordinateAlignment!==undefined||value?.coordinateAxis!==undefined;
export const coordinateAlignmentCommand=value=>value?.calculation?.version===20||value?.columns?.some(marker)===true||value?.columnChanges?.some(change=>marker(change?.column))===true||marker(value?.measurement);
export const coordinateAlignmentMaterial=value=>value?.content?.coordinateAlignments===1||coordinateAlignmentCommand(value?.content)||value?.content?.tool==='Observanda calculation graph'&&value.content.graphVersion===17;
export function coordinateAlignmentMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return coordinateAlignmentCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(coordinateAlignmentMaterial(value))return true;
 if(relative.startsWith('.observanda/materials/tables/'))return Array.isArray(value)&&value.some(row=>row.cellCoordinateAlignments?.some(Boolean));
 if(!relative.startsWith('.observanda/materials/sequences/chunks/'))return false;
 return ['coordinate-alignment-contexts','coordinate-alignment-decisions','coordinate-alignment-evidence'].includes(value?.kind)||['columns','columns-policy','cells'].includes(value?.kind)&&value.items?.some(marker)===true||value?.kind==='calculation-bindings'&&value.items?.some(item=>item.match?.method==='coordinate-neighbor-v1')===true||value?.kind==='calculation-row-bindings'&&value.items?.some(item=>item.alignment!==undefined)===true;
}
export const coordinateAlignmentCatalogueRequirements=Object.freeze(['CoordinateAlignment','TopologyValues','SequenceValues','ReferencedCalculations','WindowCalculations','DatasetResourcePolicies','MeasurementScalarPolicies','DomainAlgebra','ClockSynchronization','TensorValues','AxisPermutation','SegmentedClockSynchronization','CoordinateFrames','NativeDomainValues','NativeNumericalModels','ComputedCells','CalculationPolicies','StructuredCalculator','ApproximateCalculator'].map(name=>'catalogueRequires'+name));
export async function assertCoordinateAlignmentFormat(workspace){if(typeof workspace.storageKind!=='function')return;await workspace.catalogue(async store=>{const format=await import('./catalogue-format.js'),generation=await format.catalogueFormat(store.catalogueDb??store.db);if(!coordinateAlignmentCatalogueRequirements.every(name=>typeof format[name]==='function'&&format[name](generation)))throw new AppError('CATALOGUE_DAMAGED');});}
