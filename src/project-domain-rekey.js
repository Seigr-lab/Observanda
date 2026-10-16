import {readProjectDomainRegistry,checkProjectDomainSchemas} from './project-domain-registry.js';
import {projectDomainSchema,projectDomainTables,createProjectDomainSchema} from './project-domain-schema.js';
import {databaseSchemaSession} from './database-schema-session.js';
import {ProjectDomainCatalogue} from './project-domain-catalogue.js';
import {cataloguePayloadRows} from './catalogue-payload-rows.js';
import {AppError} from './errors.js';
export async function rekeyProjectDomains(from,to){
 const registry=await readProjectDomainRegistry(from);await checkProjectDomainSchemas(from,registry);if(!registry)return;
 if(from.workspace.projectId!==to.workspace.projectId)throw new AppError('DATABASE_LOCATION');
 const sourceSession=databaseSchemaSession(from.db),targetSession=databaseSchemaSession(to.db),stores=[];
 try{
  for(const domain of registry.domains){
   const source=new ProjectDomainCatalogue(from.workspace,sourceSession.schema(projectDomainSchema(from.db.id,domain)),domain,registry.namespaceId),target=new ProjectDomainCatalogue(to.workspace,targetSession.schema(projectDomainSchema(to.db.id,domain)),domain,registry.namespaceId,{writable:true});stores.push(source,target);
   await createProjectDomainSchema(target.db);
   for(const [table,columns] of Object.entries(projectDomainTables))for await(const row of cataloguePayloadRows(source.db,table,columns)){
    const [kind,id]=table==='state'?['state',row.slot]:table==='objects'?['object',row.id]:table==='module_entities'?['module-entity',row.id+'/'+row.revision]:['module-event',row.command_id+'/'+row.ordinal];
    const value=source.decode(kind,id,row.payload),values=columns.slice(0,-1).map(key=>row[key]);values.push(target.encode(kind,id,value));
    await target.db.run('INSERT INTO '+table+' ('+columns.join(',')+') VALUES ('+values.map((_,i)=>'$'+(i+1)).join(',')+')',...values);
   }
   const owner=await target.object('owner');if(!owner||owner.vaultId!==from.workspace.vault.id)throw new AppError('CATALOGUE_DAMAGED');await target.putObject('owner',{...owner,vaultId:to.workspace.vault.id});
  }
 }finally{
  sourceSession.close();targetSession.close();for(const store of stores)store.close();
  for(const store of [from,to])await store.db.run('SET LOCAL search_path TO "'+store.db.schema+'", pg_catalog').catch(error=>{if(error.code!=='25P02')throw error;});
 }
}
