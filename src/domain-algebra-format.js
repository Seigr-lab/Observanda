import {AppError} from './errors.js';
export const domainAlgebraMaterial=value=>value?.content?.tool==='Observanda calculation graph'&&value.content.graphVersion===8||value?.content?.calculation?.version===11;
export function domainAlgebraMetadata(relative,value){
 if(relative.startsWith('.observanda/jobs/'))return value?.input?.command?.calculation?.version===11;
 if(!relative.startsWith('.observanda/materials/'))return false;
 if(relative.startsWith('.observanda/materials/sequences/chunks/'))return value?.kind==='calculation-nodes'&&value.items?.some(node=>node.kind==='domain-arithmetic');
 return domainAlgebraMaterial(value);
}
export async function assertDomainAlgebraFormat(workspace){if(typeof workspace.storageKind!=='function')return;await workspace.catalogue(async store=>{const {catalogueFormat,catalogueRequiresDomainAlgebra}=await import('./catalogue-format.js');if(!catalogueRequiresDomainAlgebra(await catalogueFormat(store.catalogueDb??store.db)))throw new AppError('CATALOGUE_DAMAGED');});}
