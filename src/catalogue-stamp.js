import {createHash} from 'node:crypto';
import {databaseSchemaSession} from './database-schema-session.js';
import {projectDomainSchema,projectDomainSchemas,projectDomainTables} from './project-domain-schema.js';
import {serialize} from './storage-format.js';
import {operationAdvance} from './operation-progress.js';
import {AppError} from './errors.js';
// The caller supplies one repeatable-read snapshot. Hash ciphertext in the
// database so inventory never transports large retained values to the app.
export async function readCatalogueStamp(db){
 const hash=createHash('sha256'),session=databaseSchemaSession(db);let found=false,bytes=0;
 try{
  for(const domain of [null,...await projectDomainSchemas(db)]){
   const selected=session.schema(domain?projectDomainSchema(db.id,domain):db.schema);
   if(domain)hash.update(serialize(['domain',domain]));
   for await(const row of selected.rows('SELECT slot,pg_catalog.sha256(payload) AS checksum FROM state ORDER BY slot',[],{batchSize:32})){
    if(domain===null&&row.slot==='head')found=true;
    hash.update(serialize([row.slot,row.checksum.toString('hex')]));operationAdvance();
   }
   const tables=domain?Object.keys(projectDomainTables):['scope_keys','records','snapshots','state','module_entities','module_events','objects'];
   const count=await selected.get('SELECT COALESCE(sum(octet_length(payload)),0)::text AS bytes FROM ('+tables.map(table=>'SELECT payload FROM '+table).join(' UNION ALL ')+') AS payloads');bytes+=Number(count.bytes);
  }
  if(!found||!Number.isSafeInteger(bytes))throw new AppError('CATALOGUE_DAMAGED');
  return {revision:hash.digest('hex'),bytes};
 }finally{session.close();await db.run('SET LOCAL search_path TO "'+db.schema+'", pg_catalog').catch(error=>{if(error.code!=='25P02')throw error;});}
}
