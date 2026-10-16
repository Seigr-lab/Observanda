import {ProjectDomains} from './project-domains.js';
import {readProjectDomainRegistry} from './project-domain-registry.js';
import {AppError} from './errors.js';
// Cache only authenticated routing, never data or a grant. Every transaction
// checks the live owner and access again; older catalogues keep their reader.
const routes=new WeakMap();
export async function sampleAnalysisDomain(storage){
 const known=routes.get(storage);if(known&&known.root===storage.root&&known.vaultId===storage.vault?.id)return known.namespaceId;
 if(await storage.storageKind()!=='catalogue')return null;
 const registry=await storage.catalogue(readProjectDomainRegistry);if(!registry?.domains.includes('samples'))return null;
 routes.set(storage,{root:storage.root,vaultId:storage.vault?.id,namespaceId:registry.namespaceId});return registry.namespaceId;
}
export async function sampleAnalysisTransaction(storage,namespaceId,operation,{write=false,signal,check}={}){
 return new ProjectDomains(storage,namespaceId).run(['samples'],async(get,{research})=>{
  // Two writable authorities must never silently mask one another.
  if(await research.object('laboratory'))throw new AppError('CATALOGUE_DAMAGED');
  return operation(get('samples'));
 },{write:write?['samples']:[],signal,check});
}
