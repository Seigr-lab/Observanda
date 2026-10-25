import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import os from 'node:os';

const DEADLINE_MS=2400000,OUTPUT_LIMIT=1024*1024;
async function bounded(pending,ms,message){
 let timer;try{return await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]);}finally{clearTimeout(timer);}
}
function capacityDriver(t){
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const child=spawn(process.execPath,[fileURLToPath(new URL('./adoption-capacity-workload.js',import.meta.url))],{env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 let resolveReady,rejectReady,resolveExit,pending=null,closed=false,stopping=false,shutdown,firstFailure,bytes=0,messages=0,readySeen=false;
 const reports=[],ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;}),exit=new Promise(resolve=>{resolveExit=resolve;});
 ready.catch(()=>{});
 const send=message=>{if(child.connected)child.send(message,error=>{if(error&&!closed)fail(error);});else if(!closed)fail(Error('Capacity child IPC unavailable'));};
 const stop=()=>shutdown??=(async()=>{
  stopping=true;if(!closed&&child.connected)child.send({type:'shutdown'},error=>{if(error&&!closed)firstFailure??=error;});
  try{return await bounded(exit,35000,'Combined workload child did not settle after shutdown');}
  catch{child.kill();return bounded(exit,5000,'Combined workload child did not terminate');}
 })();
 const fail=error=>{
  firstFailure??=error;rejectReady(error);
  if(pending){const current=pending;pending=null;current.reject(error);}
  void stop().catch(error=>{firstFailure??=error;});
 };
 child.once('error',fail);
 child.once('close',(code,signal)=>{
  closed=true;const value={code,signal};resolveExit(value);
  if(!readySeen)rejectReady(firstFailure??Error('Capacity child exited before ready'));
  if(pending){const current=pending;pending=null;current.reject(firstFailure??Error('Capacity child exited during the workload ('+(signal??code)+')'));}
  if(!stopping&&!reports.some(report=>!report.cleanupComplete))firstFailure??=Error('Capacity child exited unexpectedly ('+(signal??code)+')');
 });
 const output=(stream,chunk)=>{
  bytes+=chunk.length;if(bytes>OUTPUT_LIMIT){fail(Error('Capacity child exceeded bounded output'));return;}
  stream.write(chunk);
 };
 child.stdout.on('data',chunk=>output(process.stdout,chunk));child.stderr.on('data',chunk=>output(process.stderr,chunk));
 child.on('message',message=>{
  try{
   assert.ok(++messages<=128,'Too many capacity driver messages');assert.ok(message&&typeof message==='object');
   bytes+=Buffer.byteLength(JSON.stringify(message));assert.ok(bytes<=OUTPUT_LIMIT,'Capacity reports exceeded bounded output');
   if(message.type==='ready'){assert.equal(readySeen,false);readySeen=true;resolveReady();}
   else if(message.type==='diagnostic'){assert.ok([1,10].includes(message.copies));assert.equal(typeof message.value,'string');t.diagnostic(message.value);}
   else if(message.type==='result'){
    assert.ok(pending);assert.equal(message.copies,pending.copies);assert.ok(['passed','failed'].includes(message.status));assert.equal(typeof message.cleanupComplete,'boolean');assert.equal(typeof message.bodySettled,'boolean');
    reports.push(message);t.diagnostic(JSON.stringify(message));const current=pending;pending=null;current.resolve(message);
    // The driver has already cancelled and bounded its own drain. It retains
    // the disposable fixture if owned work or cleanup cannot settle.
    if(!message.cleanupComplete){stopping=true;child.kill();}
   }else if(message.type==='fatal')throw Error('Capacity driver failed: '+message.message);
   else throw Error('Unknown capacity driver message');
  }catch(error){fail(error);}
 });
 t.after(async()=>{
  const ended=await stop();
  if(firstFailure)throw firstFailure;
  assert.equal(ended.signal,null,'Capacity driver required termination');
  assert.equal(ended.code,reports.some(report=>report.status==='failed')?1:0,'Capacity driver exit must agree with its reports');
 });
 return {
  async ready(){try{await bounded(ready,60000,'Capacity child startup exceeded its separate 60-second budget');}catch(error){fail(error);throw error;}},
  async run(copies,context){
   if(firstFailure)throw firstFailure;assert.equal(closed,false);assert.equal(stopping,false);assert.equal(pending,null);
   const result=new Promise((resolve,reject)=>{pending={copies,resolve,reject};});
   const cancel=()=>send({type:'cancel',copies});context.signal.addEventListener('abort',cancel,{once:true});
   // Teardown may drain beyond the test deadline, but cannot turn an overrun
   // into a pass or clear a fixture still owned by asynchronous work.
   const completion=bounded(result,DEADLINE_MS+65000,'Capacity child did not acknowledge cancellation and cleanup');
   completion.catch(()=>{});
   context.after(async()=>{try{await completion;}catch(error){fail(error);await stop();throw error;}finally{context.signal.removeEventListener('abort',cancel);}});
   send({type:'run',copies});if(context.signal.aborted)cancel();
   try{return await completion;}catch(error){fail(error);throw error;}
  }
 };
}

test('A1-sized and tenfold authored work, physical evidence, datasets and recovery coexist within declared budgets',async t=>{
 t.diagnostic(JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,cpu:os.cpus()[0].model,memoryGiB:Math.round(os.totalmem()/1024**3)}));
 const driver=capacityDriver(t);await driver.ready();
 for(const copies of [1,10])await t.test(copies+' combined corpus copies',{timeout:DEADLINE_MS},async context=>{
  const result=await driver.run(copies,context);
  assert.equal(result.status,'passed',JSON.stringify(result.errors));assert.equal(result.bodySettled,true);assert.equal(result.cleanupComplete,true);assert.ok(result.elapsedMs<DEADLINE_MS,'Combined workload exceeded its unchanged 40-minute deadline');
 });
});
