// Every PostgreSQL cluster that holds Observanda catalogues records one
// identity. Catalogue bindings name it, so a folder can prove which cluster
// holds its schema. A physical copy of a stopped cluster keeps the identity.
import {randomUUID} from 'node:crypto';
import {databaseQuery} from './database-query.js';
import {AppError} from './errors.js';

export const CLUSTER_SCHEMA='obs_cluster';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export const validClusterId=uuid;
const tableSQL='CREATE TABLE IF NOT EXISTS obs_cluster.identity(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),format integer NOT NULL CHECK(format=1),id uuid NOT NULL)';
const lock="SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('Observanda/cluster-identity/v1',0))";
const identitySQL='SELECT format,id::text AS id FROM obs_cluster.identity';
const verified=rows=>{if(rows.length!==1||rows[0].format!==1||!uuid(rows[0].id))throw new AppError('DATABASE_RUNTIME');return rows[0].id;};
// Inside a transaction an error would abort it, so presence is checked first.
async function stored(query){
 if(!(await query("SELECT pg_catalog.to_regclass('obs_cluster.identity') IS NOT NULL AS present")).rows[0].present)return null;
 return verified((await query(identitySQL)).rows);
}
// Outside a transaction one round trip suffices: a missing schema or table
// is reported by PostgreSQL itself.
async function current(query){
 try{return verified((await query(identitySQL)).rows);}
 catch(error){if(error.code==='42P01'||error.code==='3F000')return null;throw error;}
}
async function record(query,clusterId,{application=null}={}){
 await query('BEGIN');
 try{
  await query(lock);
  await query('CREATE SCHEMA IF NOT EXISTS obs_cluster');
  // Only the role that recorded the identity may own it. Managed clusters
  // record it as their administrator, so the application role can only read.
  if(!(await query("SELECT pg_catalog.pg_get_userbyid(nspowner)=current_user AS owned FROM pg_catalog.pg_namespace WHERE nspname='obs_cluster'")).rows[0]?.owned)throw new AppError('DATABASE_RUNTIME');
  await query(tableSQL);
  await query('INSERT INTO obs_cluster.identity(format,id) VALUES (1,$1) ON CONFLICT (singleton) DO NOTHING',[clusterId]);
  await query('REVOKE ALL ON SCHEMA obs_cluster FROM PUBLIC');
  await query('REVOKE ALL ON obs_cluster.identity FROM PUBLIC');
  if(application){await query('GRANT USAGE ON SCHEMA obs_cluster TO '+application);await query('GRANT SELECT ON obs_cluster.identity TO '+application);}
  const id=await stored(query);
  await query('COMMIT');
  return id;
 }catch(error){await query('ROLLBACK').catch(()=>{});throw error;}
}
// Managed bootstrap: the administrator records the identity created with the
// cluster's service state, before the cluster is published as ready. A resumed
// bootstrap finds the same row; any other identity is refused.
export async function recordClusterIdentity(admin,clusterId){
 if(!uuid(clusterId))throw new AppError('DATABASE_RUNTIME');
 const id=await record((sql,values)=>admin.query(sql,values),clusterId,{application:'observanda'});
 if(id!==clusterId)throw new AppError('DATABASE_RUNTIME');
 return id;
}
// Catalogue access. A managed cluster always carries its identity; one
// without it predates cluster identities and is refused. An organization's
// own PostgreSQL server has no managed bootstrap, so the application role
// records the identity there once, the first time a catalogue needs it.
export async function databaseClusterIdentity(client,{managed}){
 const query=(sql,values)=>databaseQuery(client,sql,values);
 const id=await current(query);if(id)return id;
 if(managed)throw new AppError('DATABASE_CLUSTER_RETIRED');
 try{return await record(query,randomUUID());}
 catch(error){if(error.code==='42501')throw new AppError('DATABASE_PERMISSION');throw error;}
}
