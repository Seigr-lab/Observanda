// Borrow the held project read transaction for explicitly selected domains.
import {ProjectModuleIdentities} from './project-module-identities.js';
import {readProjectDomainRegistry,checkProjectDomainOwner} from './project-domain-registry.js';
import {databaseSchemaSession} from './database-schema-session.js';
import {projectDomainSchema} from './project-domain-schema.js';
import {ProjectDomainCatalogue} from './project-domain-catalogue.js';
import {AppError} from './errors.js';
export async function projectModuleDomainReader(research){
 const registry=await readProjectDomainRegistry(research);if(registry?.commandVersion!==1)return null;
 return {registry,async run(operation){
  const session=databaseSchemaSession(research.db),stores=new Map(),root=research.workspace.catalogueStore(session.schema(research.db.schema));
  const inspect=async domain=>{
   if(!registry.domains.includes(domain))throw new AppError('INVALID');
   if(!stores.has(domain)){const store=new ProjectDomainCatalogue(research.workspace,session.schema(projectDomainSchema(research.db.id,domain)),domain,registry.namespaceId);stores.set(domain,store);await checkProjectDomainOwner(store);}return stores.get(domain);
  };
  try{return await operation({research:root,registry,inspect,identities:new ProjectModuleIdentities(root,registry,inspect)});}
  finally{session.close();for(const store of stores.values())store.close();await research.db.run('SET LOCAL search_path TO "'+research.db.schema+'", pg_catalog').catch(error=>{if(error.code!=='25P02')throw error;});}
 }};
}
