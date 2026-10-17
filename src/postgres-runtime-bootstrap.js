// Prepare the application role in a managed cluster. Fresh initdb output
// already contains an empty database; reuse it instead of cloning another.
import {AppError} from './errors.js';
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
