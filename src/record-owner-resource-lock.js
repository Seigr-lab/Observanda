// A bounded lock set protects resource allocation and reclamation within one
// catalogue. Large publication transactions must not allocate a server lock
// for every immutable block. Colliding keys serialize conservatively.
import {digest} from './storage-format.js';
import {AppError} from './errors.js';
export async function lockRecordOwnerResource(store,key){
 const bucket=parseInt(digest(key).slice(0,8),16)%64;
 const identity=(store.db.id??'')+':record-resource-bucket:'+bucket;
 if(!(await store.db.get('SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended($1,0)) AS locked',identity)).locked)throw new AppError('LOCKED');
}
