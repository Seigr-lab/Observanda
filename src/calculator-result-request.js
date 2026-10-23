import {CalculatorResults} from './calculator-results.js';
import {calculatorResultSource} from './calculator-result-source.js';
import {AppError} from './errors.js';
export async function calculatorResultRequest(materials,operation,data,{jobs,referenceAccess,check=async()=>{},signal}={}){
 const service=await jobs?.();if(!service)throw new AppError('ACCESS_LOCKED');
 const results=new CalculatorResults(materials),options={check,signal,readSource:source=>calculatorResultSource(materials.workspace,source,{referenceAccess,check,signal})};
 const result=await(operation==='calculator-retain'?results.retain(service.queue,data,options):operation==='calculator-repeat'?results.repeat(service.queue,data,options):operation==='calculator-resume'?results.resume(service.queue,data,options):Promise.reject(new AppError('INVALID')));
 service.worker.wake();return {...result,workspaceId:data.workspaceId};
}
