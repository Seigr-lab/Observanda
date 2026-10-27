import {mkdir,lstat,open,rename,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {performance} from 'node:perf_hooks';
import errors from './web/locales/en/errors.json' with {type:'json'};

const current=new AsyncLocalStorage();
const events=new Set(['service-start','service-ready','service-stop','service-failed','service-exit','service-output','request','worker-claim','worker-release','worker-idle','resource','phase','dropped']);
const phases=new Set(['startup','shutdown','request','waiting-writer','database-inventory','activate','claim','release','idle','probe-media','convert-media']);
const routes=new Set(['access','health','intake','media','projects','publication-jobs','records','research','storage','notebook','websites','website-editor']);
const measures=Object.freeze({'database-admission':['databaseAdmissions','databaseAdmissionMs'],'database-connect':['databaseConnections','databaseConnectMs'],'database-query':['databaseQueries','databaseQueryMs']});
const counters=new Set(['durationMs','queued','active','pendingRequests','activeRequests','queuedRequests','activeWrites','queuedWriters','requestBytes','rssBytes','heapBytes','externalBytes','cpuUserUs','cpuSystemUs','bytes','attempt','delayMs','dropped','exitCode','status',...Object.values(measures).flat()]);
const systemCodes=new Set(['EACCES','EPERM','ENOSPC','ENOENT','EIO','EMFILE','ENFILE','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ABORT_ERR']);
const codeOf=error=>{let code;try{code=error?.code;}catch{}return typeof code==='string'&&(Object.hasOwn(errors,code)||systemCodes.has(code))?code:'IO';};
const correlation=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

// Deliberately no free-text field: error messages, paths, URLs, query strings,
// headers, record/job IDs and SQL parameters cannot enter ordinary diagnostics.
export function diagnosticEvent(event,data={}){
 if(!events.has(event))return null;
 const value={time:new Date().toISOString(),event};
 if(correlation(data.correlation))value.correlation=data.correlation;
 if(phases.has(data.phase))value.phase=data.phase;
 if(routes.has(data.route))value.route=data.route;
 if(['GET','POST'].includes(data.method))value.method=data.method;
 if(data.error)value.code=codeOf(data.error);
 for(const key of counters)if(Number.isFinite(data[key])&&data[key]>=0&&data[key]<=Number.MAX_SAFE_INTEGER)value[key]=Math.round(data[key]);
 return value;
}

export class OperationalDiagnostics{
 constructor({directory=null,maxBytes=256*1024,files=4,maxPending=64}={}){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>1024*1024||!Number.isSafeInteger(files)||files<1||files>8||!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>256)throw new RangeError('Invalid diagnostic limits');
  this.directory=directory;this.maxBytes=maxBytes;this.files=files;this.maxPending=maxPending;this.pending=[];this.recent=[];this.dropped=0;this.failed=false;this.closed=false;this.running=null;this.bytes=0;this.ready=false;this.retryAt=0;
 }
 record(event,data){
  if(this.closed)return;
  const value=diagnosticEvent(event,data);if(!value)return;
  this.recent.push(value);if(this.recent.length>this.maxPending)this.recent.shift();
  if(!this.directory)return;
  if(this.pending.length===this.maxPending){this.dropped++;return;}
  this.pending.push(value);this.schedule();
 }
 schedule(){
  if(this.running||Date.now()<this.retryAt)return;
  this.running=Promise.resolve().then(()=>this.drain()).catch(()=>{this.failed=true;this.retryAt=Date.now()+5000;this.dropped+=this.pending.length;this.pending.length=0;}).finally(()=>{this.running=null;if(this.pending.length&&!this.failed)this.schedule();});
 }
 file(index=0){return path.join(this.directory,'operations-'+index+'.jsonl');}
 async prepare(){
  if(this.ready)return;
  await mkdir(this.directory,{recursive:true,mode:0o700});
  if(!(await lstat(this.directory)).isDirectory())throw Error('Invalid diagnostic directory');
  for(let i=0;i<this.files;i++){
   try{const stat=await lstat(this.file(i));if(!stat.isFile()||stat.isSymbolicLink()||stat.size>this.maxBytes)throw Error('Invalid diagnostic file');if(i===0)this.bytes=stat.size;}
   catch(error){if(error.code!=='ENOENT')throw error;}
  }
  this.ready=true;
 }
 async rotate(){
  await rm(this.file(this.files-1),{force:true});
  for(let i=this.files-2;i>=0;i--)try{await rename(this.file(i),this.file(i+1));}catch(error){if(error.code!=='ENOENT')throw error;}
  this.bytes=0;
 }
 async drain(){
  await this.prepare();
  while(this.pending.length){
   const rows=this.pending.splice(0),dropped=this.dropped;this.dropped=0;
   if(dropped)rows.unshift(diagnosticEvent('dropped',{dropped}));
   let batch='',batchBytes=0;
   const write=async()=>{if(!batch)return;const file=await open(this.file(),'a',0o600);try{await file.writeFile(batch);}finally{await file.close();}this.bytes+=batchBytes;batch='';batchBytes=0;};
   for(const row of rows){
    const line=JSON.stringify(row)+'\n',bytes=Buffer.byteLength(line);
    if(this.bytes+batchBytes+bytes>this.maxBytes){await write();await this.rotate();}
    batch+=line;batchBytes+=bytes;
   }
   await write();
  }
 }
 status(){return {available:!this.failed,queued:this.pending.length,dropped:this.dropped,retainedLimitBytes:this.directory?this.files*this.maxBytes:0};}
 async snapshot(){
  await this.flush();const entries=[];
  if(this.directory&&!this.failed){
   for(let i=this.files-1;i>=0;i--){
    let raw;try{const stat=await lstat(this.file(i));if(!stat.isFile()||stat.isSymbolicLink()||stat.size>this.maxBytes)throw Error('Invalid diagnostic file');raw=await readFile(this.file(i),'utf8');}catch(error){if(error.code==='ENOENT')continue;this.failed=true;break;}
    // Re-validate on export: never trust another process's file contents.
    for(const line of raw.split('\n'))if(line)try{const parsed=JSON.parse(line),entry=diagnosticEvent(parsed.event,{...parsed,error:parsed.code?{code:parsed.code}:undefined});if(entry){if(typeof parsed.time==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(parsed.time))entry.time=parsed.time;entries.push(entry);}}catch{}
   }
  }else entries.push(...this.recent);
  return {format:1,status:this.status(),entries};
 }
 async flush(){while(this.running)await this.running;}
 async close(){this.closed=true;await this.flush();}
}

export function withDiagnostics(recorder,operation){const correlation=randomUUID();return current.run({recorder,correlation,measurements:{},finished:false},()=>operation(correlation));}
export function independentDiagnostics(operation){const recorder=current.getStore()?.recorder;return recorder?withDiagnostics(recorder,operation):current.exit(operation);}
export function diagnostic(event,data={}){const scope=current.getStore();if(!scope?.recorder)return;scope.recorder.record(event,{...data,...(event==='request'?scope.measurements:{}),correlation:scope.correlation});if(event==='request')scope.finished=true;}
const noMeasurement=()=>{};
// Aggregate numeric timings in the current request, not one log row per SQL
// statement. Never retain SQL, parameters, connection addresses or owner IDs.
// Concurrent elapsed times are sums and are not exclusive wall-clock phases.
export function diagnosticMeasurement(kind){
 const scope=current.getStore(),keys=measures[kind];if(!scope?.recorder||scope.finished||!keys)return noMeasurement;
 const start=performance.now();let ended=false;
 return ()=>{if(ended)return;ended=true;if(scope.finished)return;const [count,duration]=keys;scope.measurements[count]=(scope.measurements[count]??0)+1;scope.measurements[duration]=(scope.measurements[duration]??0)+performance.now()-start;};
}
export async function diagnosticPhase(phase,operation){
 if(!current.getStore()?.recorder)return operation();
 const start=performance.now();let error;
 try{return await operation();}catch(value){error=value;throw value;}
 finally{diagnostic('phase',{phase,durationMs:performance.now()-start,error});}
}
