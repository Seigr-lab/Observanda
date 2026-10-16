import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collaborationFixture} from './fixtures/collaboration.js';
import {startLiveHost} from '../src/collaboration/live-host.js';
import {LiveClient} from '../src/collaboration/live-client.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {digest} from '../src/storage-format.js';
import {fileFingerprint} from '../src/web/evidence-fingerprint.js';
import {contentBuffer} from '../src/file-content.js';

async function setup(t){
 const f=await collaborationFixture(t);let host,client;
 const start=async()=>{host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',port:0,advertise:'https://127.0.0.1'});client=new LiveClient(f.member.deviceStore,await host.card(f.grant.id));};
 await start();t.after(async()=>{client.close();await host.close();});
 return {...f,m:new ResearchMaterials(f.author.workspace),jobs:workspaceJobs(f.author.workspace),recordId:f.book.entries[0].id,
  call:(op,data)=>client.call(op,data),file:data=>client.call('file',data,{stream:true}),restart:async()=>{client.close();await host.close();await start();}};
}
async function command(recordId,bytes,sourcePath='run/current-return/returned.img'){
 const chunks=[];for(let i=0;i<bytes.length;i+=EVIDENCE_CHUNK){const value=bytes.subarray(i,i+EVIDENCE_CHUNK);chunks.push({size:value.length,sha256:digest(value)});}
 return {recordId,id:randomUUID(),file:{name:sourcePath.split('/').at(-1),size:bytes.length,sourcePath,fingerprint:await fileFingerprint(bytes.length,chunks,digest)},purpose:'current-return',provenance:'Acquired from the instrument, unchanged.'};
}

test('shared originals resume across restart, retry acknowledgements and retain exact bytes, paths and acquisition',async t=>{
 const f=await setup(t);assert.deepEqual(await f.call('evidence',{recordId:f.recordId}),{items:[],next:null});
 const bytes=Buffer.alloc(EVIDENCE_CHUNK+37,59),intent=await command(f.recordId,bytes),session=await f.call('evidence-start',intent),key={recordId:f.recordId,id:session.id};
 assert.equal((await f.call('evidence-start',intent)).id,session.id);
 await assert.rejects(f.call('evidence-start',{...intent,provenance:'different'}),{code:'CONFLICT'});
 const first={...key,index:0,bytes:bytes.subarray(0,EVIDENCE_CHUNK).toString('base64')};await f.call('evidence-chunk',first);await f.restart();
 const pending=await f.call('evidence-uploads',{recordId:f.recordId});assert.equal(pending.items.length,1);assert.equal(pending.items[0].receivedBytes,EVIDENCE_CHUNK);
 assert.equal((await f.call('evidence-chunk',first)).receivedChunks,1);
 await assert.rejects(f.call('evidence-chunk',{...first,bytes:Buffer.alloc(EVIDENCE_CHUNK,60).toString('base64')}),{code:'MATERIAL_SOURCE_CHANGED'});
 await assert.rejects(f.call('evidence-finish',key),{code:'MATERIAL_INCOMPLETE'});
 const last={...key,index:1,bytes:bytes.subarray(EVIDENCE_CHUNK).toString('base64')};await f.call('evidence-chunk',last);
 assert.equal((await f.call('evidence-finish',key)).job.state,'queued');await f.call('evidence-finish',key);
 const job=await f.jobs.queue.claim(),prepared=await f.jobs.queue.definition(job).prepare(job,{});await f.jobs.queue.complete(job.id,job.lease.token,prepared);
 const result=await f.call('evidence-upload',key);assert.equal(result.job.state,'completed');assert.equal(result.completed.id,session.id);
 assert.deepEqual((await f.call('evidence-start',intent)).completed,result.completed);assert.equal((await f.call('evidence-chunk',last)).receivedChunks,2);
 assert.equal((await f.call('evidence-uploads',{recordId:f.recordId})).items.length,0);
 const original=await f.m.artifact(result.completed);assert.deepEqual(await contentBuffer(original.content),bytes);assert.equal(original.doc.content.sourcePath,intent.file.sourcePath);assert.equal(original.doc.content.sourcePurpose,'current-return');assert.equal(original.doc.content.sha256,digest(bytes));assert.equal(original.doc.content.acquisition.id,f.recordId);
 assert.equal((await f.call('activity',{recordId:f.recordId})).items.filter(i=>i.operation==='evidence').length,1);
 const listed=(await f.call('evidence',{recordId:f.recordId})).items;assert.equal(listed.length,1);assert.equal(listed[0].sha256,digest(bytes));await f.m.index.verify();
 await f.author.workspace.withLock(()=>f.m.commit({kind:'artifact',id:session.id,recordId:f.recordId,title:'Renamed evidence',expectedRevision:result.completed.revision,content:{...original.doc.content,name:'renamed.img'}}));
 const download=await f.file({recordId:f.recordId,kind:'artifact',id:session.id,artifactRevision:result.completed.revision});assert.match(download.headers['content-disposition'],/returned\.img/);const received=[];for await(const chunk of download)received.push(chunk);assert.deepEqual(Buffer.concat(received),bytes);
});

test('original intake checks current grants, record ownership and changed sources before committing',async t=>{
 const f=await setup(t),bytes=Buffer.from('original evidence'),intent=await command(f.recordId,bytes),session=await f.call('evidence-start',intent),key={recordId:f.recordId,id:session.id};
 await assert.rejects(f.call('evidence-upload',{...key,recordId:f.book.entries[1].id}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(f.call('evidence-start',{...intent,id:randomUUID(),recordId:f.book.entries[2].id}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(f.call('evidence-start',{...intent,id:randomUUID(),file:{...intent.file,sourcePath:'../returned.img'}}),{code:'COLLABORATION_INVALID'});
 await assert.rejects(f.call('evidence-chunk',{...key,index:0,bytes:Buffer.alloc(bytes.length,1).toString('base64')}),{code:'MATERIAL_SOURCE_CHANGED'});
 assert.equal((await f.call('evidence-upload',key)).receivedBytes,0);await f.call('evidence-chunk',{...key,index:0,bytes:bytes.toString('base64')});await f.call('evidence-finish',key);
 const job=await f.jobs.queue.claim(),prepared=await f.jobs.queue.definition(job).prepare(job,{}),{generation,...grant}=f.grant;void generation;
 await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:f.book.id,expectedRevision:1,role:'reader'});
 await assert.rejects(f.jobs.queue.complete(job.id,job.lease.token,prepared),{code:'COLLABORATION_DENIED'});assert.equal(await f.m.current(session.id),null);
 await f.jobs.queue.release(job.id,job.lease.token,{error:Object.assign(Error(),{code:'COLLABORATION_DENIED'})});await f.jobs.queue.definition(job).discard(job);
 for(const op of ['evidence-start','evidence-chunk','evidence-finish'])await assert.rejects(f.call(op,key),{code:'COLLABORATION_DENIED'});
 await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:f.book.id,expectedRevision:2});
 assert.equal((await f.call('evidence-finish',key)).job.state,'queued');const retry=await f.jobs.queue.claim();await f.jobs.queue.complete(retry.id,retry.lease.token,await f.jobs.queue.definition(retry).prepare(retry,{}));
 assert.ok((await f.call('evidence-upload',key)).completed);
});

test('empty originals and independent acquisitions retain separate native identities',async t=>{
 const f=await setup(t),bytes=Buffer.alloc(0),first=await command(f.recordId,bytes,'preparation/empty.bin'),second=await command(f.recordId,bytes,'historical/empty.bin');
 for(const intent of [first,second]){const session=await f.call('evidence-start',intent);await f.call('evidence-finish',{recordId:f.recordId,id:session.id});const job=await f.jobs.queue.claim();await f.jobs.queue.complete(job.id,job.lease.token,await f.jobs.queue.definition(job).prepare(job,{}));}
 const items=(await f.call('evidence',{recordId:f.recordId})).items;assert.equal(items.length,2);assert.notEqual(items[0].id,items[1].id);assert.ok(items.every(i=>i.sha256===digest(bytes)));
});

test('upload discovery is paged and scoped, and moving an owner prevents queued attachment',async t=>{
 const f=await setup(t),bytes=Buffer.alloc(0),sessions=[];
 for(let i=0;i<21;i++)sessions.push(await f.call('evidence-start',await command(f.recordId,bytes,'set/file-'+i+'.bin')));
 const first=await f.call('evidence-uploads',{recordId:f.recordId}),last=await f.call('evidence-uploads',{recordId:f.recordId,cursor:first.next});
 assert.equal(first.items.length,20);assert.equal(last.items.length,1);assert.equal(new Set([...first.items,...last.items].map(s=>s.id)).size,21);
 await assert.rejects(f.call('evidence-uploads',{recordId:f.book.entries[1].id,cursor:first.next}),{code:'INVALID'});
 const selected=sessions[0];await f.call('evidence-finish',{recordId:f.recordId,id:selected.id});
 await f.author.workspace.update(book=>{book.entries.find(r=>r.id===f.recordId).notebookId=book.entries[2].notebookId;return book;});
 assert.equal(await f.jobs.queue.claim(),null);assert.equal((await f.jobs.queue.read(selected.id)).error,'COLLABORATION_DENIED');assert.equal(await f.m.current(selected.id),null);
 await assert.rejects(f.call('evidence-upload',{recordId:f.recordId,id:selected.id}),{code:'COLLABORATION_DENIED'});
});
