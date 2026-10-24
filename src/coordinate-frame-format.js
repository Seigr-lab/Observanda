import {AppError} from './errors.js';
const column=value=>value?.coordinateFrame!==undefined;
export const coordinateFrameCommand=value=>[16,17,18,19].includes(value?.calculation?.version)||value?.columns?.some(column)===true||value?.columnChanges?.some(change=>column(change?.column))===true;
export const coordinateFrameMaterial=value=>['Observanda coordinate frame','Observanda coordinate frame transform'].includes(value?.content?.tool)||value?.content?.tool==='Observanda calculation graph'&&[13,14,15,16].includes(value.content.graphVersion)||coordinateFrameCommand(value?.content)||value?.content?.coordinateFrames===1;
export function coordinateFrameMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return coordinateFrameCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(coordinateFrameMaterial(value))return true;
 if(!relative.startsWith('.observanda/materials/sequences/chunks/'))return false;
 return value?.kind==='coordinate-frame-axes'||['columns','columns-policy'].includes(value?.kind)&&value.items?.some(column)===true||value?.kind==='calculation-nodes'&&value.items?.some(node=>node.kind==='coordinate-transform')===true||value?.kind==='calculation-lineage'&&value.items?.some(leaf=>leaf.coordinateTransform!==undefined||leaf.coordinateComponent!==undefined)===true;
}
export async function assertCoordinateFrameFormat(workspace){
 if(typeof workspace.storageKind!=='function')return;
 await workspace.catalogue(async store=>{
  const format=await import('./catalogue-format.js'),generation=await format.catalogueFormat(store.catalogueDb??store.db);
  if(!['catalogueRequiresCoordinateFrames','catalogueRequiresDomainAlgebra','catalogueRequiresNativeDomainValues','catalogueRequiresMeasurementScalarPolicies','catalogueRequiresDatasetResourcePolicies'].every(name=>typeof format[name]==='function'&&format[name](generation)))throw new AppError('CATALOGUE_DAMAGED');
 });
}
