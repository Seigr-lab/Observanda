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
