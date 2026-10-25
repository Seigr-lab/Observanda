import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const profiles=['steady small originals','larger burst arrivals'],OUTPUT_LIMIT=1024*1024;
async function bounded(pending,milliseconds,message){
 let timer;try{return await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),milliseconds);})]);}finally{clearTimeout(timer);}
}
test('sustained intake preserves exact originals and resource budgets in an ordinary process',{timeout:630000},async t=>{
 // node:test tracks asynchronous resources. Keep that bookkeeping outside the
 // measured process; both profiles still share one ordinary Node lifetime.
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const child=spawn(process.execPath,[fileURLToPath(new URL('./intake-sustained-workload.js',import.meta.url))],{env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 const results=[],output=[];let finished,firstFailure,closed=false,shutdown,outputBytes=0,messages=0;
 const ended=new Promise(resolve=>{
  child.once('error',error=>{firstFailure??=error;});
  child.once('close',(code,signal)=>{closed=true;resolve({code,signal});});
 });
 const stop=()=>shutdown??=(async()=>{
  if(closed)return;
  if(child.connected)child.send({type:'cancel'},error=>{if(error&&!closed)firstFailure??=error;});
  try{await bounded(ended,30000,'Sustained intake child did not drain after cancellation');}
  catch{child.kill();await bounded(ended,5000,'Sustained intake child did not exit after termination');}
 })();
 const fail=error=>{firstFailure??=error;void stop().catch(error=>{firstFailure??=error;});};
 const cancelled=()=>fail(t.signal.reason??Error('Sustained intake wrapper cancelled'));
 t.signal.addEventListener('abort',cancelled,{once:true});
 t.after(async()=>{try{await stop();}finally{t.signal.removeEventListener('abort',cancelled);}});
 const consume=(stream,chunk)=>{
  outputBytes+=chunk.length;
  if(outputBytes>OUTPUT_LIMIT){fail(Error('Sustained intake driver exceeded its bounded diagnostic output'));return;}
  output.push({stream,text:chunk.toString('utf8')});
 };
 child.stdout.on('data',chunk=>consume('stdout',chunk));child.stderr.on('data',chunk=>consume('stderr',chunk));
 child.on('message',message=>{
  try{
   assert.ok(++messages<=128,'Too many intake driver reports');assert.ok(message&&typeof message==='object');
   const size=Buffer.byteLength(JSON.stringify(message));outputBytes+=size;assert.ok(outputBytes<=OUTPUT_LIMIT,'Intake driver reports exceed bounded output');
   if(message.type==='diagnostic'){assert.ok(profiles.includes(message.profile));assert.equal(typeof message.value,'string');t.diagnostic(message.value);}
   else if(message.type==='started'){assert.ok(profiles.includes(message.profile));t.diagnostic('Starting '+message.profile);}
   else if(message.type==='profile'){
    assert.equal(message.profile,profiles[results.length]);assert.ok(['passed','failed','skipped'].includes(message.status));results.push(message);t.diagnostic(JSON.stringify(message));
   }else if(message.type==='finished'){assert.equal(finished,undefined);finished=message;if(message.resourceFailure)fail(Error('Intake driver cleanup failed: '+JSON.stringify(message.resourceFailure)));}
   else throw Error('Unknown sustained intake driver report');
  }catch(error){fail(error);}
 });
 let exit;
 try{exit=await bounded(ended,570000,'Sustained intake child exceeded its overall supervision deadline');}
 catch(error){fail(error);await stop();}
 finally{for(const item of output)t.diagnostic(item.stream+': '+item.text.trimEnd());}
 if(firstFailure)throw firstFailure;
 assert.equal(exit?.signal,null);assert.equal(exit?.code,0,'Sustained intake driver failed: '+JSON.stringify(results));
 assert.deepEqual(results.map(result=>result.profile),profiles);assert.ok(results.every(result=>result.status==='passed'),'Every intake profile must pass');
 assert.ok(finished,'Driver must report completed cleanup');assert.equal(finished.status,'passed');assert.equal(finished.profiles,profiles.length);assert.equal(finished.resourceFailure,null);
});
