import {AppError} from './errors.js';
import {readProjectDomainRegistry,checkProjectDomainOwner} from './project-domain-registry.js';
import {projectDomainSchema} from './project-domain-schema.js';
import {databaseSchemaSession} from './database-schema-session.js';
import {ProjectDomainCatalogue} from './project-domain-catalogue.js';
import {hasInventoryObligations} from './inventory-operation-store.js';
// Call again inside the exclusive storage handoff. A preview alone cannot
// prevent a new reservation from racing with copying or permanent deletion.
export async function assertInventoryObligationsSettled(storage){
 if(await storage.storageKind()!=='catalogue')return;
 return storage.catalogue(async research=>{
  const registry=await readProjectDomainRegistry(research);if(!registry)return;
  const session=databaseSchemaSession(research.db),stores=[];
  try{
   for(const domain of ['bom','inventory'])if(registry.domains.includes(domain)){
    const store=new ProjectDomainCatalogue(storage,session.schema(projectDomainSchema(research.db.id,domain)),domain,registry.namespaceId);stores.push(store);await checkProjectDomainOwner(store);
    if(await hasInventoryObligations(store))throw new AppError('INVENTORY_OBLIGATIONS');
   }
  }finally{session.close();for(const store of stores)store.close();await research.db.run('SET LOCAL search_path TO "'+research.db.schema+'", pg_catalog').catch(error=>{if(error.code!=='25P02')throw error;});}
 });
}
