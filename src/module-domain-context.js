import {readProjectDomainRegistry} from './project-domain-registry.js';
import {AppError} from './errors.js';
import {projectModuleDomainReader} from './project-module-domain-reader.js';
import {projectModuleReadContext} from './project-module-read-context.js';
// Reuse the caller's read snapshot. No module view acquires the research writer.
export async function moduleDomainContext(research,operation,{domains=null,scoped=true}={}){
 const reader=await projectModuleDomainReader(research);
 return reader.run(async context=>operation(await projectModuleReadContext(research.workspace,reader.registry.namespaceId,context.identities,domains??reader.registry.domains,{scoped})));
}

// Remember only routing for this storage object and key. Each selected owner
// still authenticates its namespace and registry in its own transaction.
// A catalogue without the registry holds an earlier, unsupported layout.
const routes=new WeakMap();
export async function moduleDomainRoute(storage){
 const known=routes.get(storage);if(known&&known.root===storage.root&&known.vaultId===storage.vault?.id)return known.namespaceId;
 const registry=await storage.catalogue(readProjectDomainRegistry);if(registry?.commandVersion!==1)throw new AppError('ACCESS_UPGRADE');
 routes.set(storage,{root:storage.root,vaultId:storage.vault?.id,namespaceId:registry.namespaceId});return registry.namespaceId;
}
