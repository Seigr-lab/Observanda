import {AsyncLocalStorage} from 'node:async_hooks';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';

// Diagnostic causes are private encrypted metadata, never activity messages or
// publication input. Keep only bounded, known fields, not arbitrary error data
// (which may contain query parameters, credentials or complete record bodies).
const scopes=new AsyncLocalStorage(),contexts=new WeakMap();
const object=value=>value!==null&&(typeof value==='object'||typeof value==='function');
const text=(value,limit=4096)=>typeof value==='string'?value.slice(0,limit)
 .replace(/(\b(?:password|passphrase|token|secret|authorization|cookie|api[_-]?key)\b["']?\s*[:=]\s*)[^\r\n,;}]+/gi,'$1[redacted]')
 .replace(/(\bBearer\s+)[^\s"']+/gi,'$1[redacted]')
 .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[redacted]@'):undefined;
const fields=context=>Object.fromEntries(Object.entries(context??{}).filter(([key,value])=>
 key==='operation'?typeof value==='string'&&/^[a-z][a-z0-9-]{0,79}$/.test(value):
 ['workspaceId','recordId','figureId','resultId','jobId'].includes(key)?researchId(value):
 key==='revision'?typeof value==='string'&&/^[a-f0-9]{64}$/.test(value):false));
export async function withJobDiagnosticContext(context,operation){
 return scopes.run({...scopes.getStore(),...fields(context)},async()=>{
  try{return await operation();}catch(error){
   if(!object(error))error=new Error('A non-error value was thrown');
   if(!contexts.has(error))contexts.set(error,scopes.getStore());throw error;
  }
 });
}
export function jobDiagnosticContext(error){return object(error)?contexts.get(error)??{}:{};}
function causes(error){
 const result=[],seen=new Set();
 for(let current=error;object(current)&&result.length<4&&!seen.has(current);){
  seen.add(current);const entry={};
  for(const [key,limit] of [['name',128],['message',2048],['stack',4096],['code',128],['syscall',128],['path',1024],['dest',1024]]){
   // Accessors supplied by a library must not prevent the durable failure receipt.
   try{const value=text(current[key],limit);if(value!==undefined)entry[key]=value;}catch{}
  }
  result.push(entry);
  try{current=current.cause;}catch{break;}
 }
 return result;
}
export const jobDiagnosticFile=(id,attempt)=>{
 if(!researchId(id)||!Number.isSafeInteger(attempt)||attempt<0)throw new AppError('INVALID');
 return '.observanda/job-diagnostics/'+id+'/'+attempt+'.json';
};
export function jobFailureDiagnostic(job,error){
 const result={version:1,jobId:job.id,type:job.type,attempt:job.attempt,at:job.updatedAt,stage:job.progress.stage,context:fields(jobDiagnosticContext(error)),causes:causes(error)};
 // Unicode and JSON escapes can expand beyond the per-string character caps.
 while(Buffer.byteLength(JSON.stringify(result))>60000){
  if(result.causes.length>1)result.causes.pop();
  else for(const key of Object.keys(result.causes[0]))result.causes[0][key]=result.causes[0][key].slice(0,Math.ceil(result.causes[0][key].length/2));
 }
 return result;
}
export async function readJobDiagnostic(workspace,job,attempt=job.diagnostic?.attempt){
 if(attempt===undefined)return null;
 if(!Number.isSafeInteger(attempt)||attempt<0||attempt>job.attempt)throw new AppError('INVALID');
 const raw=await workspace.readMetadata(jobDiagnosticFile(job.id,attempt),65536);if(raw===null)return null;
 let value;try{value=JSON.parse(raw);}catch{throw new AppError('JOB_DAMAGED');}
 if(value?.version!==1||value.jobId!==job.id||value.type!==job.type||value.attempt!==attempt||!Array.isArray(value.causes)||value.causes.length>4)throw new AppError('JOB_DAMAGED');
 return value;
}
