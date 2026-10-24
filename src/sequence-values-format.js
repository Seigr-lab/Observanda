// A new declaration generation admits variable-length sequences. Older codec
// names remain opaque until an explicitly authored current declaration is saved.
import {AppError} from './errors.js';
export const sequenceDeclaration=value=>value?.representation==='domain'&&value.domain?.version===4&&value.domain.codec==='observanda.sequence';
const sequenceValue=value=>value?.format==='domain-value'&&value.version===5&&value.definition?.version===4&&value.definition.codec==='observanda.sequence';
export const sequenceValuesMaterial=value=>value?.content?.sequenceValues===1||value?.content?.tool==='Observanda calculation graph'&&[15,16].includes(value.content.graphVersion)||[18,19].includes(value?.content?.calculation?.version)||value?.content?.columns?.some(sequenceDeclaration)===true||sequenceDeclaration(value?.content?.measurement?.value);
export const sequenceValuesCommand=value=>[18,19].includes(value?.calculation?.version)||value?.columns?.some(sequenceDeclaration)===true||value?.columnChanges?.some(change=>sequenceDeclaration(change.column))===true||sequenceDeclaration(value?.measurement?.value);
export function sequenceValuesMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return sequenceValuesCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(sequenceValuesMaterial(value))return true;
 if(!relative.startsWith('.observanda/materials/sequences/chunks/'))return false;
 return ['columns','columns-policy'].includes(value?.kind)&&value.items?.some(sequenceDeclaration)===true||value?.kind==='cells'&&value.items?.some(cell=>sequenceValue(cell.value))===true||value?.kind==='calculation-nodes'&&value.items?.some(node=>node.kind==='domain-sequence')===true;
}
export const sequenceValuesCatalogueRequirements=Object.freeze(['catalogueRequiresSequenceValues','catalogueRequiresNativeDomainValues','catalogueRequiresNativeNumericalModels','catalogueRequiresTensorValues','catalogueRequiresComputedCells','catalogueRequiresCalculationPolicies','catalogueRequiresStructuredCalculator','catalogueRequiresApproximateCalculator','catalogueRequiresMeasurementScalarPolicies','catalogueRequiresDatasetResourcePolicies']);
export async function assertSequenceValuesFormat(workspace){if(typeof workspace.storageKind!=='function')return;await workspace.catalogue(async store=>{const format=await import('./catalogue-format.js'),generation=await format.catalogueFormat(store.catalogueDb??store.db);if(!sequenceValuesCatalogueRequirements.every(name=>typeof format[name]==='function'&&format[name](generation)))throw new AppError('CATALOGUE_DAMAGED');});}
