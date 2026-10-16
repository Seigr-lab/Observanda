// Lightweight catalogue transport fixtures include the schema identity and
// PostgreSQL metadata boundary used by the real connection wrapper.
import {randomUUID} from 'node:crypto';
export function archiveDatabaseFixture(db){
 db.id=randomUUID();db.schema='obs_'+db.id.replaceAll('-','');
 const run=db.run??(async()=>{}),all=db.all;
 db.run=async(sql,...values)=>{if(sql==='SET LOCAL search_path TO "'+db.schema+'", pg_catalog')return;return run(sql,...values);};
 db.all=async(sql,...values)=>sql.startsWith('SELECT nspname FROM pg_catalog.pg_namespace ')?[]:all(sql,...values);
 return db;
}
