import {waitForWriter} from './writer-wait.js';
import {AppError} from './errors.js';
export async function projectDomainLock(db,key,{shared=false}={}){
 const method=shared?'pg_try_advisory_xact_lock_shared':'pg_try_advisory_xact_lock';
 await waitForWriter(async()=>{if(!(await db.get('SELECT pg_catalog.'+method+'(pg_catalog.hashtextextended($1,0)) AS locked',key)).locked)throw new AppError('LOCKED');});
}
export const projectDomainHandoff=(db,{shared=false}={})=>projectDomainLock(db,'Observanda/project-domains/lifecycle/'+db.id,{shared});
