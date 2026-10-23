import {moduleDomainOwner} from './module-domain-owner.js';
// Used only inside a new owner's existing initialization transaction.
import {workspaceFile,assertRegular} from './storage.js';
import {databaseSchemaSession} from './database-schema-session.js';
import {readProjectDomainRegistry,writeProjectDomainRegistry,checkProjectDomainSchemas,checkProjectDomainOwner} from './project-domain-registry.js';
import {projectDomainSchema,createProjectDomainSchema} from './project-domain-schema.js';
import {ProjectDomainCatalogue} from './project-domain-catalogue.js';
import {ProjectModuleIdentities} from './project-module-identities.js';
import {ModuleCatalogue} from './modules/catalogue.js';
import {moduleDomains} from './modules/domains.js';
import {AppError} from './errors.js';
export async function withProjectModuleInitialization(to,namespaceId,operation){
 if(await assertRegular(await workspaceFile(to.workspace.root),{missing:true}))throw new AppError('EXISTS');
 const session=databaseSchemaSession(to.db),root=to.workspace.catalogueStore(session.schema(to.db.schema)),stores=new Map();
 try{
  let registry=await readProjectDomainRegistry(root);await checkProjectDomainSchemas(root,registry);
  if((await new ModuleCatalogue(root).head(namespaceId)).revision)throw new AppError('ACCESS_UPGRADE');
  if(registry&&(registry.commandVersion!==1||registry.authoringVersion!==1||registry.domains.join()!==moduleDomains.join()))throw new AppError('ACCESS_UPGRADE');
  for(const domain of moduleDomains){const store=new ProjectDomainCatalogue(to.workspace,session.schema(projectDomainSchema(to.db.id,domain)),domain,namespaceId,{writable:true,catalogueDb:root.db});stores.set(domain,store);
   if(!registry){await createProjectDomainSchema(store.db);await store.putObject('owner',{...moduleDomainOwner(to.workspace,namespaceId),domain,vaultId:to.workspace.vault.id});}await checkProjectDomainOwner(store);
  }
  if(!registry){await writeProjectDomainRegistry(root,moduleDomains,namespaceId,{commandVersion:1,authoringVersion:1});registry=await readProjectDomainRegistry(root);}
  const identities=new ProjectModuleIdentities(root,registry,async domain=>stores.get(domain));
  const checkpoint=async operation=>{await root.db.run('SELECT 1');try{return await operation();}finally{session.invalidate();}};
  return await operation({root,registry,identities,checkpoint,research:root,inspect:async domain=>{const store=stores.get(domain);if(!store)throw new AppError('INVALID');return store;}});
 }finally{session.close();for(const store of stores.values())store.close();await to.db.run('SET LOCAL search_path TO "'+to.db.schema+'", pg_catalog').catch(error=>{if(error.code!=='25P02')throw error;});}
}
