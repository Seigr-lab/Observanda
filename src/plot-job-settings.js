import {jobSummary} from './jobs.js';
import {serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';

// Read the saved intent, never prepare it or change its output identity. A later
// command is independently admitted after the author reviews these settings.
export async function plotJobSettings(materials,queue,data,{signal,check=async()=>{}}={}){
 if(!data||Array.isArray(data)||Object.keys(data).sort().join()!=='id,recordId'||!researchId(data.id)||!researchId(data.recordId))throw new AppError('INVALID');
 const current=async()=>{signal?.throwIfAborted();await check();await queue.check?.();signal?.throwIfAborted();};
 const read=async()=>{
  const job=await queue.read(data.id);if(!job)throw new AppError('NOT_FOUND');
  await queue.authorize(job);
  if(job.type!=='figure.calculate'||!['failed','cancelled'].includes(job.state)||job.scope!==data.recordId||job.input.command?.recordId!==data.recordId||job.input.command.dataset?.kind!=='dataset')throw new AppError('JOB_CHANGED');
  return job;
 };
 await current();const job=await read(),command=job.input.command;
 const source=await materials.read(command.dataset);await materials.assertOwner(source.recordId);
 await current();const latest=await read();
 if(serialize(latest.input.command)!==serialize(command))throw new AppError('JOB_CHANGED');
 await current();return {job:jobSummary(latest),command:structuredClone(command)};
}
