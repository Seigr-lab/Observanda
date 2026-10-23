import {AnalysisComparisons} from './analysis-comparisons.js';
import {createComparisonInputReader} from './comparison-input-reader.js';
import {AppError} from './errors.js';
export async function prepareComparisonAdmission(materials,command,{sourceAccess,signal,check=async()=>{}}={}){
 await check();await materials.comparisons.validateOutput(command);
 const workspaceId=(await materials.workspace.outline()).metadata.id;
 const references=materials.comparisons.references(command.method,command.comparison);
 const required=command.comparison.version>=2||references.some(ref=>ref.workspaceId&&ref.workspaceId!==workspaceId);
 if(!required){await materials.comparisons.validate(command);return {workspaceId,verify:async()=>{},validateOutput:()=>materials.comparisons.validateOutput(command),close:async()=>{}};}
 if(typeof sourceAccess!=='function')throw new AppError('ANALYSIS_SOURCE_ACCESS');
 const access=await sourceAccess(materials.workspace,{signal}),inputs=createComparisonInputReader(materials,{workspaceId,access,signal}),comparisons=new AnalysisComparisons(materials,{inputs});
 let routes;
 try{await comparisons.validate(command);await access.verify();routes=await access.captureRoutes(references);}
 catch(error){await inputs.close();throw error;}
 // Closing request-owned keys does not discard the original grant checks. The
 // worker opens its own keys only after those exact initiating grants still pass.
 return {workspaceId,verify:async()=>{await check();await access.verify();},validateOutput:()=>comparisons.validateOutput(command),close:()=>inputs.close(),
  open:async(workspace,{signal}={})=>{
   await check();await access.verifyGrants();const selected=await sourceAccess(workspace,{signal});
   try{await selected.assertRoutes(routes);await selected.verify();return {...selected,verify:async()=>{await check();await selected.verify();}};}
   catch(error){await selected.close();throw error;}
  }
 };
}
export async function retryComparison(materials,service,job,{sourceAccess,signal}={}){
 if(!['failed','cancelled'].includes(job.state))throw new AppError('JOB_CHANGED');
 const admission=await prepareComparisonAdmission(materials,job.input.command,{sourceAccess,signal,check:()=>service.queue.check?.()});let rollback;
 try{return await service.queue.transaction(async()=>{
  const current=await service.queue.read(job.id);if(!current||JSON.stringify(current.input)!==JSON.stringify(job.input)||!['failed','cancelled'].includes(current.state))throw new AppError('JOB_CHANGED');
  await admission.verify();await admission.validateOutput();
  if(admission.open){if(!service.comparisonAccess)throw new AppError('ANALYSIS_SOURCE_ACCESS');rollback=service.comparisonAccess.bind(admission.workspaceId,job.id,job.input.command,admission.open);}
  return service.queue.controlLocked(job.id,'retry');
 });}catch(error){rollback?.();throw error;}finally{await admission.close();}
}
