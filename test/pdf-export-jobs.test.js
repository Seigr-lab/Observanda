import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PdfExportJobs,verifyPdfExportJobs} from '../src/pdf-export-jobs.js';
import {PdfDocumentStore} from '../src/pdf-document-store.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {digest,serialize} from '../src/storage-format.js';
import {AppError} from '../src/errors.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const render=(size=180000)=>{const bytes=Buffer.alloc(size,65);bytes.write('%PDF-1.7\n');return {bytes,sha256:digest(bytes),renderer:{engine:'chromium',electron:'test',chromium:'test',recipeVersion:1},preflight:{version:1,status:'ok',findings:[],truncated:false}};};
async function fixture(){
 const values=new Map();let now=1800000000000,tail=Promise.resolve(),writes=0;
 const documents={available:async()=>true,domains:{run:async(domains,operation,{write=[],signal,check=async()=>{}}={})=>{
  const previous=tail,next=deferred();tail=next.promise;await previous;const before=structuredClone(values);
  const store={domain:'pdf',db:{get:async sql=>{assert.match(sql,/clock_timestamp/);return {now};}},object:async key=>structuredClone(values.get(key)??null),putObject:async(key,value)=>{assert.ok(write.includes('pdf'));writes++;assert.ok(Buffer.byteLength(serialize(value))<65536);values.set(key,structuredClone(value));},deleteObject:async key=>{assert.ok(write.includes('pdf'));writes++;values.delete(key);},async *objectIdEntries(prefix){yield* [...values.keys()].filter(key=>key.startsWith(prefix)).sort();}};
  try{signal?.throwIfAborted();await check();const result=await operation(()=>store);signal?.throwIfAborted();await check();return result;}catch(error){values.clear();for(const [key,value] of before)values.set(key,value);throw error;}finally{next.resolve();}
 }}};
 const id=randomUUID(),header={version:1,id,name:'Pinned report',language:'en',direction:'ltr',layout:pdfLayoutPreset()},section={id:randomUUID(),title:'Selected evidence',content:'Exact edition',layout:null,start:null};
 const saved=await documents.domains.run(['pdf'],get=>new PdfDocumentStore(get('pdf')).change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header,section}}),{write:['pdf']});
 return {documents,values,id,header,section,revision:saved.revision,tick:ms=>now+=ms,writes:()=>writes,verify:()=>documents.domains.run(['pdf'],get=>verifyPdfExportJobs(get('pdf')))};
}

test('PDF export jobs pin editions, retain bounded output and verify downloads independently of current headers',async()=>{
 const f=await fixture(),output=render(1100000),seen=[],jobs=new PdfExportJobs(f.documents,{prepare:async(pin,{progress})=>{seen.push(pin);await progress('compiling');await progress({stage:'rendering',done:0,total:1});return output;}}),jobId=randomUUID(),input={jobId,documentId:f.id,revision:f.revision};
 assert.equal((await jobs.start(input)).state,'queued');assert.equal((await jobs.status(jobId)).documentName,'Pinned report');assert.equal((await jobs.start(input)).attempt,0);await assert.rejects(jobs.start({...input,revision:'f'.repeat(64)}),{code:'MODULE_REPLAY'});
 assert.equal((await jobs.work(jobId)).state,'completed');assert.deepEqual(seen,[{documentId:f.id,revision:f.revision}]);
 const snapshot=new PdfExportJobs(f.documents);assert.deepEqual((await snapshot.download(jobId)).bytes,output.bytes);assert.deepEqual(await f.verify(),{jobs:1,completed:1});
 const changed=await f.documents.domains.run(['pdf'],get=>new PdfDocumentStore(get('pdf')).change({id:f.id,commandId:randomUUID(),expectedRevision:f.revision,operation:{type:'header',header:{...f.header,name:'Different current name'}}}),{write:['pdf']});assert.equal((await snapshot.list()).items[0].documentName,'Pinned report');
 await f.documents.domains.run(['pdf'],get=>new PdfDocumentStore(get('pdf')).change({id:f.id,commandId:randomUUID(),expectedRevision:changed.revision,operation:{type:'remove'}}),{write:['pdf']});
 assert.deepEqual((await snapshot.download(jobId)).bytes,output.bytes);assert.equal((await snapshot.list()).items[0].revision,f.revision);await f.verify();
 const block=[...f.values].find(([key,value])=>key.startsWith('pdf-export:block:'+jobId+':')&&value.type==='bytes'),original=block[1];f.values.set(block[0],{...original,value:'AAAA'});await assert.rejects(snapshot.download(jobId),{code:'CATALOGUE_DAMAGED'});await assert.rejects(f.verify(),{code:'CATALOGUE_DAMAGED'});f.values.set(block[0],original);
 let calls=0;await assert.rejects(snapshot.download(jobId,{check:async()=>{if(++calls===2)throw new AppError('ACCESS_LOCKED');}}),{code:'ACCESS_LOCKED'});
 assert.equal([...f.values].filter(([key])=>key.startsWith('pdf-export:block:'+jobId+':')).every(([,value])=>Buffer.byteLength(serialize(value))<=65536),true);
});

test('PDF jobs cancel late render completion, recover expired attempts and keep unrelated domain objects',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred(),jobs=new PdfExportJobs(f.documents,{prepare:async()=>{entered.resolve();await release.promise;return render();}}),jobId=randomUUID(),input={jobId,documentId:f.id,revision:f.revision};
 f.values.set('unrelated:layout',{name:'keep'});await jobs.start(input);const working=jobs.work(jobId);await entered.promise;await assert.rejects(new PdfExportJobs(f.documents).resume(jobId),{code:'PDF_BUSY'});assert.equal((await jobs.cancel(jobId)).state,'cancelled');release.resolve();assert.equal((await working).state,'cancelled');assert.equal([...f.values.keys()].some(key=>key.startsWith('pdf-export:block:'+jobId+':')),false);
 const restarted=new PdfExportJobs(f.documents,{prepare:async()=>render()});await restarted.resume(jobId);assert.equal((await restarted.work(jobId)).state,'completed');assert.deepEqual(f.values.get('unrelated:layout'),{name:'keep'});
 const interrupted=randomUUID();await restarted.start({jobId:interrupted,documentId:f.id,revision:f.revision});const key='pdf-export:job:'+interrupted,job=f.values.get(key);job.state='rendering';job.attempt=1;job.progress.stage='retaining';job.lease={token:randomUUID(),until:1800000000100};
 const partial={type:'inline',value:'interrupted output'},partialKey='pdf-export:block:'+interrupted+':1:value:'+digest(serialize(partial));f.values.set(partialKey,partial);f.tick(200);await f.verify();assert.equal((await restarted.status(interrupted)).recoverable,true);await restarted.resume(interrupted);assert.equal(f.values.has(partialKey),false);assert.equal((await restarted.work(interrupted)).attempt,2);await f.verify();
 const listed=await restarted.list({limit:1});assert.equal(listed.items.length,1);assert.ok(listed.next);assert.equal((await restarted.list({after:listed.next,limit:1})).items.length,1);await assert.rejects(restarted.list({limit:21}),{code:'INVALID'});
});

test('PDF jobs retain fatal findings, reject unauthorized work and retry renderer failure without persisting credentials',async()=>{
 const f=await fixture(),jobId=randomUUID(),fatal={version:1,status:'fatal',truncated:false,findings:[{code:'PDF_IMAGE_MISSING',severity:'fatal',sectionId:f.section.id,blockId:null,blockIndex:0,details:{}}]},jobs=new PdfExportJobs(f.documents,{prepare:async()=>({bytes:null,preflight:fatal})}),input={jobId,documentId:f.id,revision:f.revision};
 const denied=async()=>{throw new AppError('ACCESS_LOCKED');};await assert.rejects(jobs.start(input,{check:denied}),{code:'ACCESS_LOCKED'});await jobs.start(input);await assert.rejects(jobs.work(jobId,{check:denied}),{code:'ACCESS_LOCKED'});assert.equal((await jobs.status(jobId)).state,'queued');
 const failed=await jobs.work(jobId);assert.equal(failed.state,'failed');assert.equal(failed.error.code,'PDF_PREFLIGHT');assert.deepEqual(failed.error.preflight,fatal);assert.equal([...f.values.keys()].some(key=>key.startsWith('pdf-export:block:'+jobId+':')),false);await f.verify();
 const restarted=new PdfExportJobs(f.documents,{prepare:async()=>render()});await restarted.resume(jobId);assert.equal((await restarted.work(jobId)).state,'completed');await assert.rejects(restarted.download(jobId,{check:denied}),{code:'ACCESS_LOCKED'});assert.equal(JSON.stringify([...f.values]).includes('ACCESS_LOCKED'),false);await f.verify();
});
