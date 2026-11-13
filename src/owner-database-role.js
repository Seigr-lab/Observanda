// Every project and lab book keeps its catalogue schemas in its workspace's
// PostgreSQL database under a login role of its own. The role password is
// derived from the owner's vault key, so code that does not hold that key
// cannot log in as the owner. The schemas the owner creates belong to its role
// and are revoked from PUBLIC; the workspace application role and sibling
// owners cannot read them. The cluster administrator (sealed with the
// workspace key) creates each role once and never resets its password.
import {hkdfSync} from 'node:crypto';
import {Client} from 'pg';
import {AppError} from './errors.js';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const rolePattern=/^obo_[a-f0-9]{32}$/;
export const validOwnerRole=value=>typeof value==='string'&&rolePattern.test(value);
export function ownerRoleName(ownerId){
 if(!uuid(ownerId))throw new AppError('INVALID');
 return 'obo_'+ownerId.replaceAll('-','');
}
export function ownerRoleCredentials(ownerId,vault){
 if(!uuid(ownerId))throw new AppError('INVALID');
 if(!Buffer.isBuffer(vault?.key)||vault.key.length!==32)throw new AppError('ACCESS_LOCKED');
 if(!uuid(vault.id))throw new AppError('ACCESS_DENIED');
 const derived=Buffer.from(hkdfSync('sha256',vault.key,Buffer.from(vault.id),Buffer.from('Observanda/owner-postgresql-role/v1/'+ownerId),32));
 try{return {role:ownerRoleName(ownerId),password:derived.toString('hex')};}finally{derived.fill(0);}
}
// Runs as the cluster administrator in the application database. The role
// cannot create databases or roles, inherit other roles or bypass row
// security; an existing role with any wider attribute or membership is refused.
export async function ensureOwnerRole(admin,{role,password}){
 if(!validOwnerRole(role)||typeof password!=='string'||!/^[a-f0-9]{64}$/.test(password))throw new AppError('DATABASE_RUNTIME');
 await admin.query('BEGIN');
 try{
  await admin.query('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))',['Observanda/owner-role/v1/'+role]);
  const existing=(await admin.query('SELECT rolsuper,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolinherit FROM pg_catalog.pg_roles WHERE rolname=$1',[role])).rows[0];
  if(!existing)await admin.query('CREATE ROLE '+role+" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");
  else if(existing.rolsuper||existing.rolcreaterole||existing.rolcreatedb||existing.rolreplication||existing.rolbypassrls||existing.rolinherit||!existing.rolcanlogin)throw new AppError('DATABASE_RUNTIME');
  if((await admin.query('SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname=$1',[role])).rowCount)throw new AppError('DATABASE_RUNTIME');
  await admin.query('GRANT CONNECT,TEMPORARY,CREATE ON DATABASE observanda TO '+role);
  // Catalogue access verifies the cluster identity named by each binding.
  await admin.query('GRANT USAGE ON SCHEMA obs_cluster TO '+role);
  await admin.query('GRANT SELECT ON obs_cluster.identity TO '+role);
  await admin.query('COMMIT');
  return {created:!existing};
 }catch(error){await admin.query('ROLLBACK').catch(()=>{});throw error;}
}
// Runs as the cluster administrator. Removes one catalogue of an owner (its
// obs_ schema and obm_ domain schemas) in one transaction, then the owner's
// role once it owns no schema in this database. Every step tolerates a step
// already done, so an interrupted deletion or retirement repeats it safely.
// A schema owned by any other role is refused unchanged.
export async function dropOwnerCatalogue(admin,{role,catalogueId=null}){
 if(!validOwnerRole(role)||catalogueId!==null&&!uuid(catalogueId))throw new AppError('DATABASE_RUNTIME');
 await admin.query('BEGIN');
 try{
  await admin.query('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))',['Observanda/owner-role/v1/'+role]);
  if(catalogueId!==null){
   const hex=catalogueId.replaceAll('-','');
   const schemas=(await admin.query("SELECT nspname,pg_catalog.pg_get_userbyid(nspowner) AS owner FROM pg_catalog.pg_namespace WHERE nspname=$1 OR starts_with(nspname,$2) ORDER BY nspname COLLATE \"C\"",['obs_'+hex,'obm_'+hex+'_'])).rows;
   if(schemas.some(row=>row.owner!==role||!/^ob[sm]_[a-z0-9_]+$/.test(row.nspname)))throw new AppError('DATABASE_LOCATION');
   for(const {nspname} of schemas)await admin.query('DROP SCHEMA "'+nspname+'" CASCADE');
  }
  const owner=(await admin.query('SELECT oid FROM pg_catalog.pg_roles WHERE rolname=$1',[role])).rows[0];
  let dropped=false;
  if(owner&&!(await admin.query('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner=$1 LIMIT 1',[owner.oid])).rowCount){
   await admin.query('DROP OWNED BY '+role+' CASCADE');await admin.query('DROP ROLE '+role);dropped=true;
  }
  await admin.query('COMMIT');
  return {roleDropped:dropped};
 }catch(error){await admin.query('ROLLBACK').catch(()=>{});throw error;}
}
// A wrong owner key derives a different password: the login is refused and
// nothing in the database changes.
export async function verifyOwnerLogin(url,{signal}={}){
 signal?.throwIfAborted();
 const parsed=new URL(url),client=new Client({host:parsed.hostname,port:Number(parsed.port),user:decodeURIComponent(parsed.username),password:decodeURIComponent(parsed.password),database:'observanda',connectionTimeoutMillis:5000,statement_timeout:5000,application_name:'Observanda'});
 client.on('error',()=>{});
 try{
  await client.connect();
  const row=(await client.query('SELECT current_user AS role')).rows[0];
  if(row?.role!==decodeURIComponent(parsed.username))throw new AppError('DATABASE_RUNTIME');
 }catch(error){
  if(error instanceof AppError)throw error;
  if(signal?.aborted)throw new AppError('DATABASE_CANCELLED');
  throw new AppError(error.code==='28P01'||error.code==='28000'?'ACCESS_DENIED':'DATABASE_UNAVAILABLE');
 }finally{await client.end().catch(()=>{});}
}
