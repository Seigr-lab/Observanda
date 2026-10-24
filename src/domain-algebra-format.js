import {AppError} from './errors.js';
export const domainAlgebraMaterial=value=>value?.content?.tool==='Observanda calculation graph'&&[8,9,10,11,12,13,14].includes(value.content.graphVersion)||[11,12,13,14,15,16,17].includes(value?.content?.calculation?.version);
export function domainAlgebraMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return [11,12,13,14,15,16,17].includes(value?.input?.command?.calculation?.version);
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(relative.startsWith('.observanda/materials/sequences/chunks/'))return value?.kind==='calculation-nodes'&&value.items?.some(node=>node.kind==='domain-arithmetic');
 return domainAlgebraMaterial(value);
}
export async function assertDomainAlgebraFormat(workspace){if(typeof workspace.storageKind!=='function')return;await workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresDomainAlgebra}=await import('./catalogue-format.js');if(!catalogueRequiresDomainAlgebra(await catalogueFormat(store.catalogueDb??store.db)))throw new AppError('CATALOGUE_DAMAGED');});}
