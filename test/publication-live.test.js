import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyLiveFiles} from '../src/publication-live.js';

const hash=b=>createHash('sha256').update(b).digest('hex');
function site(files){const body=JSON.stringify({releaseId:'synthetic-release',files:[...files].map(([path,data])=>({path,bytes:data.length,sha256:hash(data)}))});return {body,receipt:{releaseId:'synthetic-release',manifestHash:hash(body)},request:async url=>{const name=new URL(url).pathname.slice(1);return name==='publication.json'?new Response(body):files.has(name)?new Response(files.get(name)):new Response(null,{status:404});}};}

test('live verification rejects cached removed pages, redirects, missing and modified content, and a rollout mid-check',async()=>{
 const s=site(new Map([['index.html','current page'],['styles.css','styles']]));
 assert.equal((await verifyLiveFiles(s.request,'https://example.test/',s.receipt,{removed:['old.html']})).removed,1);
 for(const status of [200,301,403,500])await assert.rejects(verifyLiveFiles(url=>new URL(url).pathname==='/old.html'?new Response('old',{status}):s.request(url),'https://example.test/',s.receipt,{removed:['old.html']}),e=>e.issue?.path==='old.html'&&e.issue.reason==='removed');
 for(const response of [()=>new Response(null,{status:404}),()=>new Response('wrong!')])await assert.rejects(verifyLiveFiles(url=>new URL(url).pathname==='/styles.css'?response():s.request(url),'https://example.test/',s.receipt),e=>e.issue?.path==='styles.css');
 let reads=0;await assert.rejects(verifyLiveFiles(url=>new URL(url).pathname==='/publication.json'&&++reads===2?new Response('{}'):s.request(url),'https://example.test/',s.receipt),e=>e.issue?.path==='publication.json');
});

test('large sites are verified in bounded concurrency and large assets are streamed',async()=>{
 const files=new Map(Array.from({length:12000},(_,i)=>['pages/'+i+'.html','small page '+i])),s=site(files),chunk=Buffer.alloc(1024*1024,7),h=createHash('sha256');
 for(let i=0;i<96;i++)h.update(chunk);
 const manifest=JSON.parse(s.body);manifest.files.push({path:'capture.bin',bytes:96*chunk.length,sha256:h.digest('hex')});const body=JSON.stringify(manifest);assert.ok(body.length>1024*1024);
 let active=0,maximum=0,largeChunks=0;
 const request=async url=>{
  if(new URL(url).pathname==='/publication.json')return new Response(body);
  active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setImmediate(resolve));active--;
  if(new URL(url).pathname==='/capture.bin')return new Response(new ReadableStream({pull(controller){if(largeChunks++<96)controller.enqueue(chunk);else controller.close();}}));
  return s.request(url);
 };
 const result=await verifyLiveFiles(request,'https://example.test/',{...s.receipt,manifestHash:hash(body)});
 assert.equal(result.files,12002);assert.ok(result.bytes>96*1024*1024);assert.ok(maximum>1&&maximum<=4);assert.equal(largeChunks,97);
});

test('a stalled body times out and cancels its reader; external cancellation also stops verification',async()=>{
 const s=site(new Map([['index.html','hello']]));let cancelled=false;
 const request=url=>new URL(url).pathname==='/index.html'?new Response(new ReadableStream({cancel(){cancelled=true;}})):s.request(url);
 await assert.rejects(verifyLiveFiles(request,'https://example.test/',s.receipt,{timeoutMs:30}),e=>e.issue?.path==='index.html'&&e.issue.reason==='unavailable');assert.equal(cancelled,true);
 const controller=new AbortController();controller.abort(new Error('stop'));
 await assert.rejects(verifyLiveFiles(s.request,'https://example.test/',s.receipt,{signal:controller.signal}),/stop/);
});

test('an active slow transfer can exceed the idle deadline without being rejected',async()=>{
 const s=site(new Map([['index.html','abcdefgh']]));let offset=0;
 const request=url=>new URL(url).pathname==='/index.html'?new Response(new ReadableStream({async pull(controller){
  await new Promise(resolve=>setTimeout(resolve,40));
  if(offset<8)controller.enqueue(Buffer.from('abcdefgh'[offset++]));else controller.close();
 }})):s.request(url);
 assert.equal((await verifyLiveFiles(request,'https://example.test/',s.receipt,{timeoutMs:200})).files,2);
});

test('live verification streams a manifest beyond 16 MiB and 50,000 files before checking every URL',async t=>{
 const count=50017,prefix='pages/'+('a'.repeat(240))+'/',payload='Exact public content',sha=hash(payload);
 const manifest=Buffer.from(JSON.stringify({releaseId:'large-live-edition',files:Array.from({length:count},(_,i)=>({path:prefix+i+'.html',bytes:payload.length,sha256:sha}))}));
 assert.ok(manifest.length>16*1024*1024);const received=new Uint8Array(count);let manifestReads=0,finished=0,active=0,maximum=0,checked=0,last;
 const request=async url=>{
  const name=new URL(url).pathname.slice(1);
  if(name==='publication.json'){
   manifestReads++;let offset=0;return new Response(new ReadableStream({pull(controller){if(offset===manifest.length){finished++;controller.close();return;}const end=Math.min(offset+32768,manifest.length);controller.enqueue(manifest.subarray(offset,end));offset=end;}}));
  }
  assert.ok(finished>=1,'manifest must be complete before checking its URLs');
  if(name==='removed.html')return new Response(null,{status:410});
  assert.ok(name.startsWith(prefix));const id=Number(name.slice(prefix.length,-5));assert.ok(Number.isSafeInteger(id)&&id>=0&&id<count);assert.equal(received[id],0);received[id]=1;checked++;
  active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setImmediate(resolve));active--;return new Response(payload);
 };
 const started=Date.now(),result=await verifyLiveFiles(request,'https://example.test/',{releaseId:'large-live-edition',manifestHash:hash(manifest)},{removed:(async function*(){yield 'removed.html';})(),progress:value=>{last=value;}});
 assert.equal(result.files,count+1);assert.equal(result.removed,1);assert.equal(checked,count);assert.equal(received.reduce((a,b)=>a+b,0),count);
 assert.equal(result.bytes,manifest.length+count*payload.length);assert.equal(manifestReads,2);assert.deepEqual(last,{done:count+1,total:count+1});assert.ok(maximum>1&&maximum<=4);
 t.diagnostic(JSON.stringify({files:count,manifestBytes:manifest.length,elapsedMs:Date.now()-started,maximumRequests:maximum}));
});

test('untrusted, duplicate or malformed manifests make no content requests',async()=>{
 const row={path:'index.html',bytes:0,sha256:hash('')},valid=JSON.stringify({releaseId:'edition',files:[row]});
 const cases=[
  [valid,hash(valid+'changed')],
  [JSON.stringify({releaseId:'wrong',files:[row]})],
  [JSON.stringify({releaseId:'edition',files:[...Array.from({length:64},(_,i)=>({...row,path:i+'.html'})),{...row,path:'0.html'}]})],
  ['{"releaseId":"edition","files":[{"path":"index.html","path":"second.html","bytes":0,"sha256":"'+row.sha256+'"}]}'],
  [JSON.stringify({releaseId:'edition',files:[{...row,path:'../private'}]})],
  [JSON.stringify({releaseId:'edition',files:[{...row,bytes:'0'}]})],
  [JSON.stringify({releaseId:'edition',files:[{...row,path:'publication.json'}]})],
  [JSON.stringify({releaseId:'edition',files:{}})],
  ['{"releaseId":"edition","files":[]} trailing']
 ];
 for(const [body,expected=hash(body)] of cases){
  let requests=0;await assert.rejects(verifyLiveFiles(async url=>{assert.equal(new URL(url).pathname,'/publication.json');requests++;return new Response(body);},'https://example.test/',{releaseId:'edition',manifestHash:expected}),error=>error.issue?.path==='publication.json');assert.equal(requests,1);
 }
});

test('a stalled manifest reports the transfer failure and closes the response',async()=>{
 let cancelled=false;await assert.rejects(verifyLiveFiles(()=>new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.from('{"releaseId":"edition","files":['));},cancel(){cancelled=true;}})),'https://example.test/',{releaseId:'edition',manifestHash:hash('unused')},{timeoutMs:30}),error=>error.issue?.path==='publication.json'&&error.issue.reason==='unavailable');assert.equal(cancelled,true);
});
