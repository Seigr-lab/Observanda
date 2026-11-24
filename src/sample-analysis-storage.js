import {ProjectDomains} from './project-domains.js';
import {readProjectDomainRegistry} from './project-domain-registry.js';
import {AppError} from './errors.js';
// Cache only authenticated routing, never data or a grant. Every transaction
// checks the live owner and access again. Every owner has had a samples domain
// since the first release; storage without one is an earlier format.
const routes=new WeakMap();
export async function sampleAnalysisDomain(storage){
 const known=routes.get(storage);if(known&&known.root===storage.root&&known.vaultId===storage.vault?.id)return known.namespaceId;
 const registry=await storage.catalogue(readProjectDomainRegistry);if(!registry?.domains.includes('samples'))throw new AppError('ACCESS_UPGRADE');
 routes.set(storage,{root:storage.root,vaultId:storage.vault?.id,namespaceId:registry.namespaceId});return registry.namespaceId;
}
export async function sampleAnalysisTransaction(storage,namespaceId,operation,{write=false,inventory=false,signal,check}={}){
 return new ProjectDomains(storage,namespaceId).run(inventory?['samples','inventory']:['samples'],async get=>{
  return operation(get('samples'),inventory?get('inventory'):null);
 },{write:write?['samples']:[],signal,check});
}
