import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {materialHttp} from '../src/material-http.js';
import {materialRequest} from '../src/material-requests.js';
import {operationStage,operationAdvance} from '../src/operation-progress.js';

test('dependency review streams independently of the ordinary socket deadline and cancels on disconnect',{timeout:10000},async t=>{
 let release,aborted,completed=false;
 const gate=new Promise(resolve=>{release=resolve;}),cancelled=new Promise(resolve=>{aborted=resolve;});
 const server=http.createServer(async(req,res)=>{
  const request=materialRequest('/api/research/materials/dependency-review');
  await materialHttp(req,res,request,{contextId:'fixture',body:async()=>({}),json:value=>res.end(JSON.stringify(value)),execute:async(_data,{signal})=>{
   try{return await operationStage('checking-evidence-references',{unit:'references'},async()=>{
    if(req.url==='/cancel'){await delay(10000,undefined,{signal});throw Error('Cancellation was not received');}
    await gate;signal.throwIfAborted();operationAdvance();completed=true;return {items:[]};
   });}finally{if(signal.aborted)aborted();}
  }});
 });
 server.setTimeout(40,socket=>socket.destroy());server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{release();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const url='http://127.0.0.1:'+server.address().port,response=await fetch(url,{method:'POST',headers:{Accept:'application/x-ndjson'}});
 assert.match(response.headers.get('content-type'),/application\/x-ndjson/);
 const reader=response.body.getReader();assert.match(Buffer.from((await reader.read()).value).toString(),/"progress"/);
 await delay(100);assert.equal(completed,false);release();let text='';for(;;){const part=await reader.read();if(part.done)break;text+=Buffer.from(part.value).toString();}
 const events=text.trim().split('\n').filter(Boolean).map(JSON.parse);assert.deepEqual(events.at(-1),{result:{items:[]}});assert.ok(events.some(event=>event.progress?.completed===1));
 const controller=new AbortController(),pending=await fetch(url+'/cancel',{method:'POST',headers:{Accept:'application/x-ndjson'},signal:controller.signal});
 await pending.body.getReader().read();controller.abort();await cancelled;
});
