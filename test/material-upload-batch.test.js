import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace,digest} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {appendMaterialUploadBatch} from '../src/material-upload-batch.js';
import {materialRequest,executeMaterialRequest} from '../src/material-requests.js';
import {evidenceUploadBody,uploadEvidenceChunks} from '../src/web/evidence-upload-batch.js';
import {fileFingerprint} from '../src/web/evidence-fingerprint.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {contentBuffer} from '../src/file-content.js';
import {databaseCapacity} from '../src/postgres.js';
import {requestWriterWait} from '../src/writer-wait.js';
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-upload-batch-')),f=await encryptedFixture(directory,sampleNotebook()),materials=new ResearchMaterials(f.workspace),recordId=(await f.workspace.read()).book.entries[0].id;
 t.after(async()=>{clearVault(f.vault);assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-upload-batch-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 return {...f,materials,recordId};
}
const frame=(id,index,bytes)=>({id,index,blob:new Blob([bytes])});
const source=frames=>evidenceUploadBody(frames).stream();
function connections(t,workspace){const result={opens:0,closes:0},open=workspace.openCatalogue;t.mock.method(workspace,'openCatalogue',async function(...args){const db=await open.apply(this,args),close=db.close;result.opens++;db.close=async function(){try{return await close.call(this);}finally{result.closes++;}};return db;});return result;}
function request(operation,check=async()=>{}){const req={waitForWriter:true,checkWriter:check,socket:{timeout:60000,destroyed:false,setTimeout(){}}},res=new EventEmitter();res.setTimeout=()=>{};res.writableEnded=false;return requestWriterWait(req,res,operation);}

test('bounded multi-file upload reuses one connection while retaining exact per-chunk commits and lost-response resume',async t=>{
 const f=await fixture(t),baseline=databaseCapacity().active,bytes=[...Array.from({length:7},(_,i)=>Buffer.from('original '+i)),Buffer.alloc(2*EVIDENCE_CHUNK+19,0x71)],items=[];
 for(let i=0;i<bytes.length;i++){const chunks=[];for(let at=0;at<bytes[i].length;at+=EVIDENCE_CHUNK){const part=bytes[i].subarray(at,at+EVIDENCE_CHUNK);chunks.push({size:part.length,sha256:digest(part)});}items.push({name:'capture-'+i+'.raw',size:bytes[i].length,fingerprint:await fileFingerprint(bytes[i].length,chunks,digest)});}
 const batch=await f.materials.intakes.start({recordId:f.recordId,title:'Batched originals',count:items.length,bytes:bytes.reduce((sum,value)=>sum+value.length,0)});await f.materials.intakes.append({id:batch.id,offset:0,items});
 const files=(await f.materials.intakes.page({id:batch.id})).items,frames=files.flatMap((file,i)=>Array.from({length:Math.ceil(file.size/EVIDENCE_CHUNK)},(_,index)=>frame(file.id,index,bytes[i].subarray(index*EVIDENCE_CHUNK,(index+1)*EVIDENCE_CHUNK))));
 const measured=connections(t,f.workspace),selected=materialRequest('/api/research/materials/chunks');assert.equal(selected.input,'stream');assert.equal(materialRequest('/api/research/materials/chunk/'+files[0].id+'/0').material,'chunk');
 const first=await request(()=>executeMaterialRequest(f.workspace,selected,{}, {stream:source(frames.slice(0,8))}));
 assert.equal(first.sessions.length,8);assert.equal(measured.opens,1);assert.equal(measured.closes,1);assert.equal(databaseCapacity().active,baseline);
 // Discard the response and recover from persisted sessions, as after a lost HTTP reply.
 const resumed=new ResearchMaterials(new Workspace(f.workspace.root,f.vault)),remaining=[];
 for(let i=0;i<files.length;i++){const saved=await resumed.importState(files[i].id);for(let index=resumed.uploads.count(saved);index<Math.ceil(files[i].size/EVIDENCE_CHUNK);index++)remaining.push(frame(files[i].id,index,bytes[i].subarray(index*EVIDENCE_CHUNK,(index+1)*EVIDENCE_CHUNK)));}
 assert.equal(remaining.length,2);const current=await executeMaterialRequest(f.workspace,materialRequest('/api/research/materials/upload-session'),{id:files.at(-1).id});assert.equal(current.receivedChunks,1);await request(()=>appendMaterialUploadBatch(f.workspace,source(remaining)));
 const replay=await f.materials.importState(files[0].id);await assert.rejects(request(()=>appendMaterialUploadBatch(f.workspace,source([frames[0]]))),{code:'MATERIAL_CHANGED'});assert.equal(f.materials.uploads.count(await f.materials.importState(files[0].id)),f.materials.uploads.count(replay));
 const jobs=workspaceJobs(f.workspace);try{
  await f.materials.intakes.enqueue(batch.id,jobs.queue);jobs.worker.start();const until=Date.now()+30000;let job;
  while(Date.now()<until){job=await jobs.queue.read(batch.id);if(['completed','failed'].includes(job.state))break;await delay(50);}
  assert.equal(job.state,'completed');const references=(await f.materials.referencePage(job.result)).items;assert.equal(references.length,files.length);assert.equal(new Set(references.map(ref=>ref.id)).size,files.length);
  for(let i=0;i<references.length;i++){const {doc,content}=await f.materials.artifact(references[i]);assert.equal(doc.content.name,items[i].name);assert.equal(doc.content.sha256,digest(bytes[i]));assert.deepEqual(await contentBuffer(content),bytes[i]);}
 }finally{await jobs.worker.stop();}
 assert.equal(measured.opens,measured.closes);assert.equal(databaseCapacity().active,baseline);
});

test('framing refuses short, malformed, excess and aborted bodies without accepting a partial chunk',async t=>{
 const f=await fixture(t),session=await f.materials.startImport({recordId:f.recordId,name:'capture.raw',size:12}),id=session.id,baseline=databaseCapacity().active,measured=connections(t,f.workspace);
 const header=value=>Buffer.from(JSON.stringify(value)+'\n'),valid=header({id,index:0,size:12});
 const invalid=[Buffer.alloc(0),Buffer.from('x'.repeat(193)),Buffer.from('{bad}\n'),header({id,index:0,size:EVIDENCE_CHUNK+1}),header({id,index:-1,size:12}),header({id,index:0,size:12,extra:true}),Buffer.concat([valid,Buffer.alloc(11)])];
 for(const body of invalid){await assert.rejects(appendMaterialUploadBatch(f.workspace,[body]),{code:'INVALID'});assert.equal(f.materials.uploads.count(await f.materials.importState(id)),0);}
 const controller=new AbortController();async function* aborted(){yield valid;yield Buffer.alloc(5);controller.abort();yield Buffer.alloc(7);}
 await assert.rejects(appendMaterialUploadBatch(f.workspace,aborted(),{signal:controller.signal}),{name:'AbortError'});assert.equal(f.materials.uploads.count(await f.materials.importState(id)),0);
 async function* failed(){yield valid;yield Buffer.alloc(5);throw Error('Interrupted body');}
 await assert.rejects(appendMaterialUploadBatch(f.workspace,failed()),/Interrupted body/);assert.equal(f.materials.uploads.count(await f.materials.importState(id)),0);
 const tiny=[];for(let i=0;i<9;i++)tiny.push(await f.materials.startImport({recordId:f.recordId,name:'tiny-'+i+'.raw',size:1}));
 const over=Buffer.concat(tiny.flatMap(item=>[header({id:item.id,index:0,size:1}),Buffer.from([1])]));
 await assert.rejects(request(()=>appendMaterialUploadBatch(f.workspace,[over])),{code:'INVALID'});
 for(let i=0;i<tiny.length;i++)assert.equal(f.materials.uploads.count(await f.materials.importState(tiny[i].id)),i<8?1:0);
 // A complete frame before malformed trailing data stays durable; retry starts afterward.
 await assert.rejects(appendMaterialUploadBatch(f.workspace,[Buffer.concat([valid,Buffer.alloc(12),Buffer.from('extra')])]),{code:'INVALID'});assert.equal(f.materials.uploads.count(await f.materials.importState(id)),1);
 assert.equal(measured.opens,measured.closes);assert.equal(databaseCapacity().active,baseline);
});

test('grant refusal and cancellation between upload frames preserve the committed prefix and close reused connections',async t=>{
 const f=await fixture(t),baseline=databaseCapacity().active,measured=connections(t,f.workspace);
 for(const reason of ['grant','abort']){
  const one=await f.materials.startImport({recordId:f.recordId,name:reason+'-one.raw',size:1}),two=await f.materials.startImport({recordId:f.recordId,name:reason+'-two.raw',size:1}),controller=new AbortController();let allowed=true,checks=0;
  async function* interrupted(){yield Buffer.from(await evidenceUploadBody([frame(one.id,0,Buffer.from([1]))]).arrayBuffer());allowed=false;if(reason==='abort')controller.abort();yield Buffer.from(await evidenceUploadBody([frame(two.id,0,Buffer.from([2]))]).arrayBuffer());}
  await assert.rejects(request(()=>appendMaterialUploadBatch(f.workspace,interrupted(),{signal:controller.signal}),async()=>{checks++;if(!allowed)throw Object.assign(Error('Grant revoked'),{code:'ACCESS_DENIED'});}),reason==='grant'?{code:'ACCESS_DENIED'}:{name:'AbortError'});
  assert.ok(checks>0);assert.equal(f.materials.uploads.count(await f.materials.importState(one.id)),1);assert.equal(f.materials.uploads.count(await f.materials.importState(two.id)),0);
  await request(()=>appendMaterialUploadBatch(f.workspace,source([frame(two.id,0,Buffer.from([2]))])));
 }
 assert.equal(measured.opens,measured.closes);assert.equal(databaseCapacity().active,baseline);
});

test('browser upload batching spans files and large-file chunks with bounded authenticated receipts',async()=>{
 const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',frames=[...Array.from({length:7},(_,i)=>frame(id,i,Buffer.alloc(EVIDENCE_CHUNK,i))),...Array.from({length:3},(_,i)=>frame(other,i,Buffer.alloc(7,i)))],requests=[],accepted=[];
 await uploadEvidenceChunks(frames,{context:'selected-workspace',fetcher:async(url,request)=>{requests.push(request);assert.equal(url,'/api/research/materials/chunks');assert.equal(request.headers['X-Observanda-Wait'],'1');assert.equal(request.headers['X-Observanda-Workspace'],'selected-workspace');assert.ok(request.body.size<=8*(EVIDENCE_CHUNK+192));const selected=frames.slice((requests.length-1)*8,requests.length*8);return {ok:true,json:async()=>({sessions:selected.map(frame=>({id:frame.id,receivedChunks:frame.index+1}))})};},uploaded:(frame,session)=>accepted.push([frame.id,session.receivedChunks])});
 assert.equal(requests.length,2);assert.equal(accepted.length,frames.length);
 await assert.rejects(uploadEvidenceChunks([frames[0]],{fetcher:async()=>({ok:true,json:async()=>({sessions:[{id:other,receivedChunks:1}]})})}),/Invalid upload receipt/);
 const controller=new AbortController();controller.abort();let fetched=false;await assert.rejects(uploadEvidenceChunks([frames[0]],{signal:controller.signal,fetcher:async()=>{fetched=true;}}),{name:'AbortError'});assert.equal(fetched,false);
});
