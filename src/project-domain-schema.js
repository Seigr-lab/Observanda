import {AppError} from './errors.js';
import {validModuleDomain} from './modules/domains.js';
export const projectDomainTables=Object.freeze({state:['slot','payload'],module_entities:['id','revision','payload'],module_events:['command_id','ordinal','payload'],objects:['id','payload']});
export function projectDomainSchema(id,domain){
 if(typeof id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)||!validModuleDomain(domain))throw new AppError('INVALID');
 return 'obm_'+id.replaceAll('-','')+'_'+domain;
}
export async function projectDomainSchemas(db){
 const prefix='obm_'+db.id.replaceAll('-','')+'_',rows=await db.all('SELECT nspname FROM pg_catalog.pg_namespace WHERE starts_with(nspname,$1) ORDER BY nspname COLLATE "C"',prefix),domains=rows.map(row=>row.nspname.slice(prefix.length));
 if(!domains.every(validModuleDomain))throw new AppError('CATALOGUE_DAMAGED');return domains;
}
export async function createProjectDomainSchema(db){
 await db.run('CREATE SCHEMA "'+db.schema+'"');await db.run('REVOKE ALL ON SCHEMA "'+db.schema+'" FROM PUBLIC');
 await db.run(`CREATE TABLE domain_format(version integer PRIMARY KEY CHECK(version=1));
 INSERT INTO domain_format VALUES (1);
 CREATE TABLE state(slot text PRIMARY KEY,payload bytea NOT NULL);
 CREATE TABLE module_entities(id uuid PRIMARY KEY,revision integer NOT NULL CHECK(revision>0),payload bytea NOT NULL);
 CREATE TABLE module_events(command_id uuid PRIMARY KEY,ordinal integer NOT NULL UNIQUE CHECK(ordinal>0),payload bytea NOT NULL);
 CREATE TABLE objects(id text PRIMARY KEY,payload bytea NOT NULL);
 CREATE INDEX state_slot_bytes ON state (slot COLLATE "C");
 CREATE INDEX objects_id_bytes ON objects (id COLLATE "C");`);
 await db.run('REVOKE ALL ON ALL TABLES IN SCHEMA "'+db.schema+'" FROM PUBLIC');
}
export async function dropProjectDomainSchemas(db){for(const domain of await projectDomainSchemas(db))await db.run('DROP SCHEMA "'+projectDomainSchema(db.id,domain)+'" CASCADE');}
