import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {FileContent,writeContent,serveContent} from '../src/file-content.js';
import {withOperationProgress,operationStage} from '../src/operation-progress.js';
import {clearVault} from '../src/encryption.js';
import {httpDrain} from '../src/http-drain.js';
import {requestWriterWait} from '../src/writer-wait.js';
for(const encrypted of [false,true])test('HTTP originals authenticate before responding and avoid a duplicate verification pass: '+encrypted,async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-file-http-')),vault=encrypted?{id:randomUUID(),key:randomBytes(32)}:null,workspace=new Workspace(root,vault),file=path.join(root,'original'),bytes=randomBytes(2*1024*1024+17),stored=await writeContent(workspace,file,[bytes]),content=new FileContent(workspace,file,stored.size,stored.sha256);let processed=0,completed;
 const server=createServer((req,res)=>{completed=withOperationProgress(value=>{processed=value.activity.bytes;},()=>operationStage('download',{},()=>serveContent(req,res,content,'application/octet-stream'))).catch(error=>{if(!res.headersSent){res.writeHead(500);res.end(error.code);}else res.destroy();});});
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));clearVault(vault);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-file-http-'));await rm(root,{recursive:true,force:true});});
 server.listen(0,'127.0.0.1');await once(server,'listening');const url='http://127.0.0.1:'+server.address().port;
 const full=await fetch(url);assert.equal(full.status,200);assert.deepEqual(Buffer.from(await full.arrayBuffer()),bytes);await completed;assert.equal(processed,bytes.length*2);
 const range=await fetch(url,{headers:{Range:'bytes=17-31'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(17,32));
 const damaged=await readFile(file);damaged[damaged.length-1]^=1;await writeFile(file,damaged);
 const refused=await fetch(url);assert.equal(refused.status,500);assert.match(await refused.text(),/MEDIA_INVALID|ENCRYPTION_DAMAGED/);
});


test('HTTP original download observes an owner-supplied cancellation before releasing bytes',async t=>{
 const controller=new AbortController();let closed=false,headersSent=false;
 class RetainedContent extends FileContent{
  async *read(start,end,{signal}){
   assert.equal(signal,controller.signal);
   try{controller.abort();signal.throwIfAborted();yield Buffer.from('secret');}finally{closed=true;}
  }
 }
 const content=new RetainedContent(null,'unused',6,'unused');
 const server=createServer((req,res)=>{void serveContent(req,res,content,'application/octet-stream',{signal:controller.signal}).catch(error=>{headersSent=res.headersSent;assert.equal(error.name,'AbortError');res.writeHead(499);res.end();});});
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const response=await fetch('http://127.0.0.1:'+server.address().port);assert.equal(response.status,499);assert.equal(await response.text(),'');assert.equal(headersSent,false);assert.equal(closed,true);
});


for(const disconnected of [false,true])test('HTTP content shares its owner cancellation and releases the response lifecycle: '+(disconnected?'disconnect':'complete'),async t=>{
 const bytes=Buffer.alloc(256*1024,0x53);let peak=0,completed,closed=false,ownerSignal,readSignal,aborts=0,response,ownerAbort;
 class RetainedContent extends FileContent{
  async *read(start,end,{signal}){
   readSignal=signal;
   try{
    yield bytes.subarray(0,32768);
    if(disconnected)await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});
    signal.throwIfAborted();yield bytes.subarray(32768);
   }finally{closed=true;}
  }
 }
 const content=new RetainedContent(null,'unused',bytes.length,'unused');
 const server=createServer((req,res)=>{
  response=res;const on=res.on;res.on=function(name,listener){const result=on.call(this,name,listener);peak=Math.max(peak,this.listenerCount('close'));return result;};
  completed=requestWriterWait(req,res,async()=>{
   const controller=new AbortController();ownerSignal=controller.signal;ownerAbort=()=>{if(!res.writableEnded){aborts++;controller.abort();}};res.once('close',ownerAbort);
   try{await serveContent(req,res,content,'application/octet-stream',{signal:controller.signal});}
   finally{res.off('close',ownerAbort);}
  }).then(()=>null,error=>error);
 }),drain=httpDrain(server);
 t.after(async()=>{server.closeAllConnections();await completed;await drain.close();});server.listen(0,'127.0.0.1');await once(server,'listening');
 const stop=new AbortController(),received=await fetch('http://127.0.0.1:'+server.address().port,{signal:stop.signal});
 if(disconnected){const reader=received.body.getReader();assert.ok((await reader.read()).value.length);stop.abort();assert.ok(await completed);}
 else{assert.deepEqual(Buffer.from(await received.arrayBuffer()),bytes);assert.equal(await completed,null);}
 assert.equal(readSignal,ownerSignal);assert.equal(closed,true);assert.equal(ownerSignal.aborted,disconnected);assert.equal(aborts,disconnected?1:0);
 assert.ok(peak<=10,'Response accumulated '+peak+' close listeners');assert.ok(!response.listeners('close').includes(ownerAbort));
});
