import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,rename,open} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID,randomBytes} from 'node:crypto';
import {Workspace,digest} from '../src/storage.js';
import {FileContent,serveContent} from '../src/file-content.js';
import {OwnedFileContent} from '../src/owned-file-content.js';
import {clearVault} from '../src/encryption.js';
import {createSegmentedHeader,readSegmentedHeader,sealSegment,SEGMENTED_BLOCK_BYTES as BLOCK,SEGMENTED_HEADER_BYTES as HEADER,SEGMENTED_CHUNK_OVERHEAD as EXTRA} from '../src/segmented-file-format.js';
import {readSegmentedRange} from '../src/segmented-file-io.js';
import {withOperationProgress,operationStage} from '../src/operation-progress.js';

async function fixture(t,size=3*BLOCK+17){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-range-')),vault={id:randomUUID(),key:randomBytes(32)},workspace=new Workspace(root,vault),file=path.join(root,'original'),bytes=randomBytes(size),hash=digest(bytes);
 const rawHeader=createSegmentedHeader(size,hash,vault.key,workspace.fileAAD(file)),header=readSegmentedHeader(rawHeader,vault.key,workspace.fileAAD(file)),parts=[rawHeader];
 for(let index=0;index<header.count;index++)parts.push(sealSegment(bytes.subarray(index*BLOCK,(index+1)*BLOCK),index,header,vault.key,workspace.fileAAD(file)));
 const stored=Buffer.concat(parts);await writeFile(file,stored);t.after(async()=>{clearVault(vault);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-range-'));await rm(root,{recursive:true,force:true});});
 return {root,vault,workspace,file,bytes,stored,content:new FileContent(workspace,file,size,hash),hash};
}
async function collect(iterator){const parts=[];for await(const bytes of iterator)parts.push(bytes);return Buffer.concat(parts);}

test('beginning middle end and repeated random seeks read only authenticated requested chunks',async t=>{
 const f=await fixture(t,16*BLOCK),metrics=[];
 for(const start of [0,8*BLOCK,16*BLOCK-65536,...Array.from({length:24},(_,i)=>(i*15485863)%(f.bytes.length-65536))]){
  const handle=await open(f.file,'r');let actualBytes=0;const read=handle.read.bind(handle);handle.read=async(...args)=>{const result=await read(...args);actualBytes+=result.bytesRead;return result;};
  try{const began=performance.now(),range=await collect(readSegmentedRange(handle,f.vault.key,f.workspace.fileAAD(f.file),start,start+65535,{size:f.bytes.length,sha256:f.hash}));assert.deepEqual(range,f.bytes.subarray(start,start+65536));assert.ok(actualBytes<=HEADER+2*(BLOCK+EXTRA));metrics.push({start,returned:range.length,read:actualBytes,ms:Math.round(performance.now()-began)});}finally{await handle.close();}
 }
 assert.equal(metrics[2].read,HEADER+BLOCK+EXTRA);t.diagnostic(JSON.stringify({size:f.bytes.length,seeks:metrics.length,samples:metrics.slice(0,3),maximumRead:Math.max(...metrics.map(row=>row.read))}));
});

test('requested corruption reorder substitution truncation and mismatched ownership release no unauthenticated chunk',async t=>{
 const f=await fixture(t),position=HEADER+BLOCK+EXTRA,length=BLOCK+EXTRA;
 const corrupt=Buffer.from(f.stored);corrupt[position+100]^=1;
 const reordered=Buffer.from(f.stored);f.stored.copy(reordered,position,HEADER,HEADER+length);
 const otherHeader=createSegmentedHeader(f.bytes.length,f.hash,f.vault.key,f.workspace.fileAAD(f.file)),other=readSegmentedHeader(otherHeader,f.vault.key,f.workspace.fileAAD(f.file)),substituted=Buffer.from(f.stored);sealSegment(f.bytes.subarray(BLOCK,2*BLOCK),1,other,f.vault.key,f.workspace.fileAAD(f.file)).copy(substituted,position);
 for(const stored of [corrupt,reordered,substituted,f.stored.subarray(0,-1)]){await writeFile(f.file,stored);let released=0;await assert.rejects(async()=>{for await(const bytes of f.content.read(BLOCK+3,BLOCK+99))released+=bytes.length;},{code:'ENCRYPTION_DAMAGED'});assert.equal(released,0);}
 await writeFile(f.file,f.stored);
 for(const workspace of [new Workspace(f.root,{id:f.vault.id,key:randomBytes(32)}),new Workspace(f.root,{id:randomUUID(),key:f.vault.key})])await assert.rejects(collect(new FileContent(workspace,f.file,f.bytes.length,f.hash).read(2,8)),{code:'ENCRYPTION_DAMAGED'});
 const moved=path.join(f.root,'other');await writeFile(moved,f.stored);await assert.rejects(collect(new FileContent(f.workspace,moved,f.bytes.length,f.hash).read(2,8)),{code:'ENCRYPTION_DAMAGED'});
 await assert.rejects(collect(new FileContent(f.workspace,f.file,f.bytes.length,'0'.repeat(64)).read(2,8)),{code:'MEDIA_INVALID'});
 await assert.rejects(collect(new FileContent(f.workspace,f.file,f.bytes.length-1,f.hash).read(2,8)),{code:'MEDIA_INVALID'});
 const badHeader=Buffer.from(f.stored);badHeader[50]^=1;await writeFile(f.file,badHeader);await assert.rejects(f.content.verifyMetadata(),{code:'ENCRYPTION_DAMAGED'});
});

test('partial access does not claim integrity of unrequested chunks and full verification still refuses them',async t=>{
 const f=await fixture(t),corrupt=Buffer.from(f.stored);corrupt[corrupt.length-1]^=1;await writeFile(f.file,corrupt);
 assert.deepEqual(await collect(f.content.read(7,40)),f.bytes.subarray(7,41));await f.content.verifyMetadata();await assert.rejects(f.content.verify(),{code:'ENCRYPTION_DAMAGED'});
});

test('segmented seeks stop on cancellation key retirement and concurrent pathname replacement',async t=>{
 const f=await fixture(t),controller=new AbortController(),cancelled=f.content.read(0,BLOCK+7,{signal:controller.signal});assert.equal((await cancelled.next()).value.length,BLOCK);controller.abort();await assert.rejects(cancelled.next(),{name:'AbortError'});
 const replaced=f.content.read(0,BLOCK+7);assert.equal((await replaced.next()).value.length,BLOCK);await rename(f.file,path.join(f.root,'prior'));await writeFile(f.file,f.stored);await assert.rejects(replaced.next(),{code:'MEDIA_INVALID'});
 const retired=f.content.read(0,BLOCK+7);assert.equal((await retired.next()).value.length,BLOCK);clearVault(f.vault);await assert.rejects(retired.next(),{code:'ACCESS_LOCKED'});
});

test('HTTP HEAD authenticates segmented metadata only and owned range responses retain their authority',async t=>{
 const f=await fixture(t),measurements=[];let active=0,completed;
 const owned=new OwnedFileContent(null,'deferred',f.bytes.length,f.hash,async consume=>{active++;try{return await consume(f.content);}finally{active--;}});
 const server=createServer((req,res)=>{let measured=0;completed=withOperationProgress(progress=>measured=progress.activity.bytes,()=>operationStage('download',{},()=>serveContent(req,res,owned,'application/octet-stream'))).then(()=>measurements.push(measured)).catch(error=>{if(res.headersSent)res.destroy();else{res.writeHead(500);res.end(error.code);}});});
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});server.listen(0,'127.0.0.1');await once(server,'listening');const url='http://127.0.0.1:'+server.address().port;
 const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),f.bytes.length);assert.equal((await head.arrayBuffer()).byteLength,0);await completed;assert.equal(measurements.at(-1),8+HEADER);assert.equal(active,0);
 const response=await fetch(url,{headers:{Range:'bytes=-17'}});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.bytes.subarray(-17));await completed;assert.equal(active,0);assert.equal(measurements.at(-1),8+HEADER+17+EXTRA);
});
