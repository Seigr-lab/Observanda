import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {MediaPolicy,defaultMediaPolicy} from '../src/media-policy.js';
import {MediaStore,mediaCapabilities} from '../src/media.js';
import {startServer} from '../src/server.js';
import {enforcePublishingLimits} from '../src/publishing.js';
function wavHeader(size){const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(size+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(48000,24);h.writeUInt32LE(96000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(size,40);return h;}
test('policy defaults impose no app ceilings, persist privately and reject stale updates',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'observanda-policy-'));await new Workspace(root).create(sampleNotebook());const store=new MediaPolicy(root);assert.ok(Object.values((await store.read()).policy).every(v=>v===0));const saved=await store.save({...defaultMediaPolicy(),maxUploadBytes:12},'new');await assert.rejects(store.save(defaultMediaPolicy(),'new'),e=>e.code==='CONFLICT');assert.equal((await new MediaPolicy(root).read()).policy.maxUploadBytes,12);await assert.rejects(store.save({...saved.policy,maxUploadBytes:-1},saved.etag),e=>e.code==='INVALID');await assert.rejects(new MediaStore(root).import(Buffer.alloc(20),'audio'),e=>e.code==='MEDIA_LIMIT');assert.deepEqual(await readdir(path.join(root,'.observanda/media')),[]);});
test('hosting limits are per destination and independent of local media size',()=>{const files=new Map([['a',Buffer.alloc(40)],['b',Buffer.alloc(20)]]),limits={ssh:{maxFileBytes:50,maxTotalBytes:100},github:{maxFileBytes:10,maxTotalBytes:100}};enforcePublishingLimits({files},{kind:'ssh',limits});assert.throws(()=>enforcePublishingLimits({files},{kind:'github',limits}),e=>e.code==='PUBLISH_POLICY');limits.ssh.maxTotalBytes=59;assert.throws(()=>enforcePublishingLimits({files},{kind:'ssh',limits}),e=>e.code==='PUBLISH_POLICY');});
test('20-minute recording above 100 MiB uploads, seeks, previews and downloads through the service', {timeout:180000}, async t=>{
 if(!(await mediaCapabilities()).available)return t.skip('FFmpeg required');
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-long-media-')),book=sampleNotebook();await new Workspace(root).create(book);const app=await startServer({root,port:0});t.after(app.close);
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})}),cookie=session.headers.get('set-cookie').split(';')[0];
 const api=async(route,data)=>{const res=await fetch(app.origin+route,{method:data?'POST':'GET',headers:{Cookie:cookie,Origin:app.origin,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});assert.equal(res.status,200);return res.json();};
 const dataSize=1200*96000,hash=createHash('sha256');async function* source(){const header=wavHeader(dataSize);hash.update(header);yield header;for(let remaining=dataSize;remaining>0;){const b=Buffer.alloc(Math.min(1024*1024,remaining));hash.update(b);yield b;remaining-=b.length;}}
 const uploaded=await fetch(app.origin+'/api/media/audio',{method:'POST',headers:{Cookie:cookie,Origin:app.origin,'Content-Type':'application/octet-stream','Content-Length':String(dataSize+44)},body:Readable.from(source()),duplex:'half'});assert.equal(uploaded.status,201);const asset=await uploaded.json();
 const metadata=JSON.parse(await readFile(path.join(root,'.observanda/media',asset.id,'asset.json'),'utf8'));assert.equal(metadata.originalBytes,dataSize+44);assert.equal(metadata.originalSha256,hash.digest('hex'));assert.ok(metadata.bytes>100*1024*1024);
 const ranged=await fetch(app.origin+'/api/media/'+asset.id,{headers:{Cookie:cookie,Range:'bytes=104857601-104857620'}});assert.equal(ranged.status,206);assert.equal((await ranged.arrayBuffer()).byteLength,20);
 const current=await api('/api/notebook');current.book.entries[0].attachments.push({...asset,caption:'Long performance',alt:'',transcript:'',share:true});const saved=await api('/api/notebook/save',current),preview=await api('/api/preview',{etag:saved.etag});
 const download=await fetch(app.origin+'/api/export/'+preview.id,{headers:{Cookie:cookie}});assert.equal(download.status,200);let bytes=0;for await(const chunk of download.body)bytes+=chunk.length;assert.ok(bytes>metadata.bytes);
 const policy=await api('/api/media-policy');await api('/api/media-policy',{policy:{...policy.policy,maxUploadBytes:10},etag:policy.etag});const rejected=await fetch(app.origin+'/api/media/audio',{method:'POST',headers:{Cookie:cookie,Origin:app.origin,'Content-Type':'application/octet-stream'},body:Buffer.alloc(11)});assert.equal((await rejected.json()).code,'MEDIA_LIMIT');
});
