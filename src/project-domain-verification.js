import {PdfDocumentStore} from './pdf-document-store.js';
import {verifyInventoryOperations} from './inventory-operation-verification.js';
import {verifySampleAnalysisCatalogue} from './sample-analysis-catalogue.js';
import {cataloguePrefixExists} from './postgres-indexes.js';
import {verifyProjectModuleDrafts} from './project-module-draft-verification.js';
import {operationStage} from './operation-progress.js';
import {verifyProjectModuleIdentities} from './project-module-identity-verification.js';
import {readProjectDomainRegistry,checkProjectDomainSchemas,checkProjectDomainOwner} from './project-domain-registry.js';
import {projectDomainSchema} from './project-domain-schema.js';
import {databaseSchemaSession} from './database-schema-session.js';
import {ProjectDomainCatalogue} from './project-domain-catalogue.js';
import {ModuleCatalogue} from './modules/catalogue.js';
import {workspaceModules} from './modules/index.js';
import {moduleConstraintSource} from './modules/constraint-source.js';
import {moduleDomain} from './modules/domains.js';
import {withScratch} from './scratch-work.js';
import {AppError} from './errors.js';
export async function verifyProjectDomains(research){
 const registry=await readProjectDomainRegistry(research);await checkProjectDomainSchemas(research,registry);if(!registry)return;
 const session=databaseSchemaSession(research.db),stores=[],sources=new Map(),owner=workspaceModules(research.workspace);
 try{
  if(registry.domains.includes('samples')&&await research.object('laboratory'))throw new AppError('CATALOGUE_DAMAGED');
  await withScratch(async identities=>{
   for(const domain of registry.domains){
    const store=new ProjectDomainCatalogue(research.workspace,session.schema(projectDomainSchema(research.db.id,domain)),domain,registry.namespaceId);stores.push(store);await checkProjectDomainOwner(store);
    if(domain==='samples')await verifySampleAnalysisCatalogue(store);
    if(domain==='pdf')await new PdfDocumentStore(store).verify();
    const catalogue=new ModuleCatalogue(store),head=await catalogue.head(registry.namespaceId);sources.set(domain,moduleConstraintSource(catalogue,head));
    await catalogue.verify(registry.namespaceId,{
     entity:entity=>{store.assertModuleType(entity.type);owner.validateEntity(entity);},
     event:event=>{for(const entity of event.changes)store.assertModuleType(entity.type);owner.validateEvent(event);},
     constraints:async()=>{}
    });
    for await(const member of catalogue.members(head))if(!await identities.add(member.id))throw new AppError('CATALOGUE_DAMAGED');
    await operationStage('verify-domain-objects',{unit:'objects',item:domain},async()=>{for await(const value of store.verifiedObjects())void value;});
   }
   const context={research:research.workspace.catalogueStore(session.schema(research.db.schema)),registry,inspect:async domain=>stores.find(store=>store.domain===domain)};
   if(registry.authoringVersion===1&&await cataloguePrefixExists(context.research.db,'objects','metadata:.observanda/module-draft'))throw new AppError('CATALOGUE_DAMAGED');
   for(const domain of registry.domains)await verifyProjectModuleDrafts(context,domain);
   const source={workspaceId:registry.namespaceId,
    async get(id){for(const current of sources.values()){const value=await current.get(id);if(value)return value;}return null;},
    async *all(types=null){const selected=types===null?null:new Set((Array.isArray(types)?types:[types]).map(moduleDomain));for(const [domain,current] of sources)if(!selected||selected.has(domain))yield* current.all(types);},
    async has(type,id){return (await source.get(id))?.type===type;},
    async some(types,predicate){for await(const value of source.all(types))if(await predicate(value))return true;return false;}
   };
   await owner.validateSource(source);
   await verifyProjectModuleIdentities(research.workspace.catalogueStore(session.schema(research.db.schema)),registry,async domain=>stores.find(store=>store.domain===domain));
   await verifyInventoryOperations(context);
  });
 }finally{session.close();for(const store of stores)store.close();await research.db.run('SET LOCAL search_path TO "'+research.db.schema+'", pg_catalog').catch(error=>{if(error.code!=='25P02')throw error;});}
}
