import {projectDomainSchema,projectDomainSchemas} from './project-domain-schema.js';
import {validModuleDomain} from './modules/domains.js';
import {databaseSchemaSession} from './database-schema-session.js';
// Small, content-derived proofs of every retained research revision and module
// event. New destination work may append history; it cannot erase this history
// before a pending move retires its recovery source.
import {createHash} from 'node:crypto';
import {serialize,workspaceFile} from './storage.js';
import {AppError} from './errors.js';

const tables={snapshots:'id',module_events:'command_id'};
async function retainedTable(db,table,key,before){
 const max=before?before.max:Number((await db.get('SELECT COALESCE(MAX(ordinal),-1)::text AS ordinal FROM '+table)).ordinal),digest=createHash('sha256');let count=0;
 for await(const row of db.rows('SELECT '+key+' AS id,ordinal,pg_catalog.sha256(payload) AS checksum FROM '+table+' WHERE ordinal<=$1 ORDER BY ordinal',[max])){digest.update(serialize([row.id,row.ordinal,row.checksum.toString('hex')]));count++;}
 return {max,count,digest:digest.digest('hex')};
}
export async function databaseRetention(db,before=null){
 const result={};
 for(const [table,key] of Object.entries(tables))result[table]=await retainedTable(db,table,key,before?.[table]);
 const domains=before?Object.keys(before.domains??{}):await projectDomainSchemas(db);
 if(domains.length){
  const session=databaseSchemaSession(db);result.domains={};
  try{for(const domain of domains)result.domains[domain]=await retainedTable(session.schema(projectDomainSchema(db.id,domain)),'module_events','command_id',before?.domains[domain]);}
  finally{session.close();await db.run('SET LOCAL search_path TO "'+db.schema+'", pg_catalog').catch(error=>{if(error.code!=='25P02')throw error;});}
 }
 return result;
}
const validProof=v=>v&&Object.keys(v).sort().join()==='count,digest,max'&&Number.isSafeInteger(v.max)&&v.max>=-1&&Number.isSafeInteger(v.count)&&v.count>=0&&/^[a-f0-9]{64}$/.test(v.digest);
export function validDatabaseRetention(value){return value&&['module_events,snapshots','domains,module_events,snapshots'].includes(Object.keys(value).sort().join())&&validProof(value.snapshots)&&validProof(value.module_events)&&(!Object.hasOwn(value,'domains')||value.domains&&typeof value.domains==='object'&&!Array.isArray(value.domains)&&Object.keys(value.domains).length>0&&Object.keys(value.domains).every(validModuleDomain)&&Object.values(value.domains).every(validProof));}
export async function verifyDatabaseRetention(workspace,proof,{verify=true}={}){
 if(!validDatabaseRetention(proof))throw new AppError('STORAGE_MOVE_STATE');
 return workspace.catalogue(async store=>{
  if(JSON.stringify(await databaseRetention(store.db,proof))!==JSON.stringify(proof))throw new AppError('STORAGE_COPY');
  if(verify)await workspace.catalogueStore(store.db).verify(JSON.parse(await workspace.readFile(await workspaceFile(workspace.root),'utf8')));
 });
}
