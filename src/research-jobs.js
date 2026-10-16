// Research owns import semantics; the worker owns durable execution and leases.
import {ResearchMaterials} from './research-materials.js';
import {AppError} from './errors.js';
import {authorizeLive,liveRecord} from './collaboration/live-access.js';
import {auditLive} from './collaboration/live-audit.js';
export function researchJobDefinitions(workspace,queue){
 const materials=new ResearchMaterials(workspace);
 return {'analysis.compare':{
  authorize:async job=>{if(job.scope!==job.input.command?.recordId)throw new AppError('JOB_CHANGED');await materials.assertOwner(job.scope);},
  prepare:(job,options)=>materials.comparisons.prepare(job.input.command,{...options,jobId:job.id,writePage:fn=>queue().transaction(async()=>{await queue().held(job.id,job.lease.token);return fn();})}),
  commit:(job,prepared)=>materials.comparisons.commit(job.input.command,prepared)
 },'figure.calculate':{
  authorize:async job=>{if(job.scope!==job.input.command?.recordId)throw new AppError('JOB_CHANGED');await materials.assertOwner(job.scope);},
  prepare:async(job,options)=>{
   const writePage=fn=>queue().transaction(async()=>{await queue().held(job.id,job.lease.token);return fn();});
   await materials.cleanPlotWork(job.id,undefined,writePage);
   return materials.preparePlot(job.input.command,{...options,writePage,jobId:job.id,attempt:job.lease.token});
  },
  discard:job=>materials.cleanPlotWork(job.id,job.lease.token),
  commit:(job,prepared)=>materials.commitPlot(job.input.command,prepared)
 },'dataset.prepare':{
  authorize:async job=>{if(job.scope!==job.input.command?.recordId)throw new AppError('JOB_CHANGED');await materials.assertOwner(job.scope);},
  prepare:(job,options)=>materials.prepareDataset(job.input.command,{...options,jobId:job.id,writePage:fn=>queue().transaction(async()=>{await queue().held(job.id,job.lease.token);return fn();})}),
  commit:(job,prepared)=>materials.commitDataset(job.input.command,prepared)
 },'evidence.finalize':{
  authorize:async job=>{
   const session=await materials.importState(job.input.importId);if(session.batchId||session.id!==job.id||session.recordId!==job.scope||session.size!==job.input.size)throw new AppError('JOB_CHANGED');await materials.assertOwner(job.scope);
   if(session.live){const access=await authorizeLive(workspace,session.live.identity,session.live.scope,{write:true});await workspace.catalogue(store=>liveRecord(store,access,job.scope));}
  },
  prepare:async(job,options)=>{
   // Only the current lease may discard unpublished files left by a lost process.
   // A stale worker cannot commit after this fence, even if it finishes writing.
   await queue().transaction(async()=>{await queue().held(job.id,job.lease.token);await materials.cleanAttempts(job.id);});
   return materials.prepareImport(job.input.importId,{...options,storageId:job.lease.token});
  },
  discard:job=>materials.cleanAttempts(job.id,{only:job.lease.token}),
  commit:async(job,prepared)=>{
   const session=await materials.importState(job.input.importId),ref=await materials.commitImport(job.input.importId,prepared);
   if(session.live&&!session.completed){
    const access=await authorizeLive(workspace,session.live.identity,session.live.scope,{write:true});
    await auditLive(workspace,access,job.scope,'evidence',{reference:ref,name:session.name,size:session.size,sha256:prepared.sha256});
    await workspace.removeMetadata(session.live.pendingFile);
   }
   return ref;
  }
 },'evidence.batch':{
  authorize:job=>materials.intakes.authorize(job),
  prepare:(job,options)=>materials.intakes.prepare(job,options,fn=>queue().transaction(async()=>{await queue().held(job.id,job.lease.token);return fn();})),
  commit:(job,prepared)=>materials.intakes.commit(job,prepared)
 }};
}
