// Prepare the application role in a managed cluster. Fresh initdb output
// already contains an empty database; reuse it instead of cloning another.
import {AppError} from './errors.js';
import {recordClusterIdentity} from './database-cluster-identity.js';
import {connectManagedAdmin} from './postgres-runtime-readiness.js';
// A cluster copied from the installation's template starts with the
// template's administrator password. Its own password replaces it before
// anything else is done; a resumed bootstrap finds it already replaced.
export async function adoptClusterCredentials(config,{signal,deadline}={}){
 const hex=/^[a-f0-9]{64}$/;
 if(config.phase!=='initializing'||!hex.test(config.bootstrapPassword??'')||!hex.test(config.adminPassword)||config.bootstrapPassword===config.adminPassword)throw new AppError('DATABASE_RUNTIME');
 let admin;
 try{admin=await connectManagedAdmin({...config,adminPassword:config.bootstrapPassword},{signal,deadline});}
 catch(error){if(error.code==='28P01')return false;throw error;}
 try{await admin.query("ALTER ROLE observanda_admin PASSWORD '"+config.adminPassword+"'");}finally{await admin.end();}
 return true;
}
export async function initializeManagedApplication(admin,config,{freshCluster=false}={}){
 if(config.phase!=='initializing'||!/^([a-f0-9]{64})$/.test(config.appPassword))throw new AppError('DATABASE_RUNTIME');
 if(!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='observanda'")).rowCount)await admin.query("CREATE ROLE observanda LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+config.appPassword+"'");
 if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='observanda'")).rowCount){
  if(freshCluster)await admin.query('ALTER DATABASE postgres RENAME TO observanda');
  // Older interrupted bootstrap state may have an existing maintenance
  // database. Preserve it when this invocation did not create the cluster.
  else await admin.query('CREATE DATABASE observanda OWNER observanda');
 }
 // A prior attempt can stop after rename but before ownership or permissions
 // are set. Complete both before application readiness is published.
 await admin.query('ALTER DATABASE observanda OWNER TO observanda');
 await admin.query('REVOKE ALL ON DATABASE observanda FROM PUBLIC');
}
// The cluster identity lives in the application database, owned by the
// administrator and readable by the application role. It is written while the
// service state is still initializing, so readiness always implies identity.
export async function initializeClusterIdentity(admin,config){
 if(config.phase!=='initializing'||admin.connectionParameters?.database!=='observanda')throw new AppError('DATABASE_RUNTIME');
 return recordClusterIdentity(admin,config.clusterId);
}
