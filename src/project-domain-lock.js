import {waitForWriter,withoutWriterWait} from './writer-wait.js';
import {AppError} from './errors.js';
export async function projectDomainLock(db,key,{shared=false}={}){
 const method=shared?'pg_try_advisory_xact_lock_shared':'pg_try_advisory_xact_lock';
 await waitForWriter(async()=>{if(!(await db.get('SELECT pg_catalog.'+method+'(pg_catalog.hashtextextended($1,0)) AS locked',key)).locked)throw new AppError('LOCKED');});
}
// Exclusive handoff already holds the research writer. A shared operation may
// need a short write before releasing its lease, so waiting here would deadlock.
// Reject admission and release the writer; ordinary domain waits remain queued.
export const projectDomainHandoff=(db,{shared=false}={})=>{
 const acquire=()=>projectDomainLock(db,'Observanda/project-domains/lifecycle/'+db.id,{shared});
 return shared?acquire():withoutWriterWait(acquire);
};
