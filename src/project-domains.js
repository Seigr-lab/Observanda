import {cataloguePrefixExists} from './postgres-indexes.js';
import {assertNotRenaming} from './workspace-rename-state.js';
import {moduleDomainOwner} from './module-domain-owner.js';
import {moduleDraftDomain,moduleDraftOwners} from './modules/draft-domains.js';
import {projectDomainLock,projectDomainHandoff} from './project-domain-lock.js';
import {acquireTaskAdmission} from './task-admission-lock.js';
// Domain transactions take only their declared feature locks. Lifecycle
// operations acquire the exclusive handoff before replacing owned storage.
import {projectDomainSchema,createProjectDomainSchema} from './project-domain-schema.js';
import {readProjectDomainRegistry,writeProjectDomainRegistry,checkProjectDomainSchemas,checkProjectDomainOwner} from './project-domain-registry.js';
import {ProjectDomainCatalogue} from './project-domain-catalogue.js';
import {databaseSchemaSession} from './database-schema-session.js';
import {ModuleCatalogue} from './modules/catalogue.js';
import {moduleDomains,validModuleDomain} from './modules/domains.js';
import {waitForWriter} from './writer-wait.js';
import {assertNotDeleting} from './workspace-delete-state.js';
import {assertNotMoving} from './workspace-move-state.js';
import {AppError} from './errors.js';

const selection=(domains,allowEmpty=false)=>{
 if(!Array.isArray(domains)||!allowEmpty&&!domains.length||domains.length>moduleDomains.length||new Set(domains).size!==domains.length||!domains.every(validModuleDomain))throw new AppError('INVALID');
 return [...domains].sort();
};
export class ProjectDomains{
 constructor(storage,namespaceId){moduleDomainOwner(storage,namespaceId);this.storage=storage;this.namespaceId=namespaceId;}
 async connection(){
  await this.storage.requireStorageKey();const db=await this.storage.openCatalogue();
  try{
   await db.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   if((await this.storage.catalogueStore(db).snapshot()).metadata.id!==this.namespaceId)throw new AppError('WORKSPACE_CHANGED');
   await db.run('COMMIT');return db;
  }catch(error){await db.close();throw error;}
 }
 async initialize(domains,{commands=false}={}){
  domains=selection(domains);const db=await this.connection(),session=databaseSchemaSession(db),stores=[];
  try{
   await db.run('BEGIN');await waitForWriter(()=>db.lock());await projectDomainHandoff(db);await assertNotDeleting(this.storage.root);await assertNotMoving(this.storage.root);await assertNotRenaming(this.storage.root);
   const research=this.storage.catalogueStore(session.schema(db.schema)),registry=await readProjectDomainRegistry(research);await checkProjectDomainSchemas(research,registry);
   const owned=new Set(registry?.domains??[]);
   for(const domain of domains){
    const connection=session.schema(projectDomainSchema(db.id,domain)),store=new ProjectDomainCatalogue(this.storage,connection,domain,this.namespaceId,{writable:true});stores.push(store);
    if(!owned.has(domain)){if(domain==='samples'&&await research.object('laboratory'))throw new AppError('ACCESS_UPGRADE');await createProjectDomainSchema(connection);await store.putObject('owner',{...moduleDomainOwner(this.storage,this.namespaceId),domain,vaultId:this.storage.vault.id});owned.add(domain);}
    await checkProjectDomainOwner(store);
   }
   if(commands&&!registry?.commandVersion){
    // Existing shared/domain history requires its explicit migration owner.
    if((await new ModuleCatalogue(research).head(this.namespaceId)).revision)throw new AppError('ACCESS_UPGRADE');
    for(const domain of owned){
     const store=new ProjectDomainCatalogue(this.storage,session.schema(projectDomainSchema(db.id,domain)),domain,this.namespaceId);stores.push(store);
     if((await new ModuleCatalogue(store).head(this.namespaceId)).revision)throw new AppError('ACCESS_UPGRADE');
    }
   }
   if(commands&&!registry?.authoringVersion&&await cataloguePrefixExists(research.db,'objects','metadata:.observanda/module-draft'))throw new AppError('ACCESS_UPGRADE');
   await writeProjectDomainRegistry(research,[...owned],this.namespaceId,{commandVersion:commands||registry?.commandVersion?1:undefined,authoringVersion:commands||registry?.authoringVersion?1:undefined});await db.run('COMMIT');
  }finally{session.close();for(const store of stores)store.close();await db.close();}
 }
 async run(domains,operation,{write=[],authoring=[],signal,consistent=false,check=async()=>{}}={}){
  domains=selection(domains,Array.isArray(write)&&write.length===0);if(typeof operation!=='function'||typeof check!=='function'||!Array.isArray(write)||new Set(write).size!==write.length||write.some(domain=>!domains.includes(domain)))throw new AppError('INVALID');
  if(!Array.isArray(authoring)||new Set(authoring).size!==authoring.length||authoring.some(id=>!moduleDraftOwners.includes(id)||!domains.includes(moduleDraftDomain(id))))throw new AppError('INVALID');
  signal?.throwIfAborted();const db=await this.connection(),session=databaseSchemaSession(db),stores=new Map();
  try{
   await db.run(write.length||authoring.length?(consistent?'BEGIN ISOLATION LEVEL REPEATABLE READ':'BEGIN'):'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   // Separate from the research writer. Lifecycle handoff takes this gate
   // exclusively; ordinary commands share it and lock only declared domains.
   if(write.length||authoring.length){
    await projectDomainHandoff(db,{shared:true});
    if(write.includes('tasks'))await acquireTaskAdmission(db,this.namespaceId);
    if(write.length)for(const domain of domains)await projectDomainLock(db,'Observanda/project-domain/'+db.id+'/'+domain,{shared:!write.includes(domain)});
    for(const moduleId of [...authoring].sort())await projectDomainLock(db,'Observanda/project-authoring/'+db.id+'/'+moduleId);
   }
   signal?.throwIfAborted();await check();await assertNotDeleting(this.storage.root);await assertNotMoving(this.storage.root);await assertNotRenaming(this.storage.root);
   const research=this.storage.catalogueStore(session.schema(db.schema)),registry=await readProjectDomainRegistry(research);
   if(authoring.length&&registry?.authoringVersion!==1)throw new AppError('ACCESS_UPGRADE');
   if(domains.some(domain=>!registry?.domains.includes(domain)))throw new AppError('CATALOGUE_UNAVAILABLE');
   for(const domain of domains){
    const connection=session.schema(projectDomainSchema(db.id,domain)),store=new ProjectDomainCatalogue(this.storage,connection,domain,this.namespaceId,{writable:write.includes(domain)});stores.set(domain,store);await checkProjectDomainOwner(store);
   }
   const get=domain=>{const store=stores.get(domain);if(!store)throw new AppError('INVALID');return store;};
   // inspect is an internal, read-only identity lookup in the same snapshot;
   // it does not grant an undeclared command participant or writer.
   const inspect=async domain=>{
    if(!registry?.domains.includes(domain))throw new AppError('INVALID');
    if(!stores.has(domain)){
     const store=new ProjectDomainCatalogue(this.storage,session.schema(projectDomainSchema(db.id,domain)),domain,this.namespaceId);stores.set(domain,store);await checkProjectDomainOwner(store);
    }
    return stores.get(domain);
   };
   const participant=domain=>{if(!domains.includes(domain))throw new AppError('INVALID');return get(domain);};
   const result=await db.scope(()=>operation(participant,{research,registry,inspect}));signal?.throwIfAborted();await check();await db.run('COMMIT');return result;
  }finally{session.close();for(const store of stores.values())store.close();await db.close();}
 }
}
