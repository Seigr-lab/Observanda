import {AppError} from './errors.js';
// Axis mapping changes graph meaning without changing domain declarations or values.
export const axisPermutationMaterial=value=>value?.content?.tool==='Observanda calculation graph'&&[11,12,13,14].includes(value.content.graphVersion)||[14,15,16,17].includes(value?.content?.calculation?.version);
export const axisPermutationCommand=value=>[14,15,16,17].includes(value?.calculation?.version);
export function axisPermutationMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return axisPermutationCommand(value?.input?.command);
 if(!relative.startsWith('.observanda/materials/'))return false;
 return axisPermutationMaterial(value)||relative.startsWith('.observanda/materials/sequences/chunks/')&&value?.kind==='calculation-nodes'&&value.items?.some(node=>node.kind==='domain-permute')===true;
}
export async function assertAxisPermutationFormat(workspace){if(typeof workspace.storageKind!=='function')return;await workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresAxisPermutation}=await import('./catalogue-format.js');if(!catalogueRequiresAxisPermutation(await catalogueFormat(store.catalogueDb??store.db)))throw new AppError('CATALOGUE_DAMAGED');});}
