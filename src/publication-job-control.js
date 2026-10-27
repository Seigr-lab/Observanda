import {AppError} from './errors.js';
import {jobSummary} from './jobs.js';
import {publicationJobControlRoutes} from './publication-job-policy.js';

export async function executePublicationJobControl(operation,data,{queue,releases,reviews,worker,signal,check=async()=>{}}){
 const contract=Object.hasOwn(publicationJobControlRoutes,operation)?publicationJobControlRoutes[operation]:null;
 if(!contract||!data||typeof data!=='object'||Array.isArray(data)||typeof data.id!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(data.id))throw new AppError('INVALID');
 if(Object.keys(data).some(key=>key!=='id'&&!(contract.action==='diagnostics'&&key==='attempt'))||data.attempt!==undefined&&(!Number.isSafeInteger(data.attempt)||data.attempt<0))throw new AppError('INVALID');
 const current=async()=>{signal?.throwIfAborted();await check();signal?.throwIfAborted();};await current();
 const job=await queue.read(data.id);if(!job||job.type!==contract.jobType)throw new AppError('NOT_FOUND');
 if(contract.jobType==='publication.analysis-review')await reviews.authorize(job);else await queue.authorize(job);await current();
 if(contract.action==='status')return {job:jobSummary(job)};
 if(contract.action==='diagnostics'){const diagnostic=await queue.diagnostic(job.id,{attempt:data.attempt});await current();return {diagnostic};}
 const next=await (contract.jobType==='publication.analysis-review'?reviews:releases).control(queue,job.id,contract.action);
 if(contract.action==='cancel')worker.cancel(job.id);else worker.wake();return {job:jobSummary(next)};
}
