import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PdfExportJobs,verifyPdfExportJobs} from '../src/pdf-export-jobs.js';
import {PdfDocumentStore} from '../src/pdf-document-store.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {digest,serialize} from '../src/storage-format.js';
import {AppError} from '../src/errors.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {PDF_ARCHIVAL_VALIDATOR_SHA256} from '../src/web/pdf-archival-model.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const render=(size=180000)=>{const bytes=Buffer.alloc(size,65);bytes.write('%PDF-1.7\n');return {bytes,sha256:digest(bytes),renderer:{engine:'chromium',electron:'test',chromium:'test',recipeVersion:1},preflight:{version:1,status:'ok',findings:[],truncated:false}};};
async function fixture({archival=false}={}){
 const namespaceId=randomUUID(),workspace={projectId:randomUUID(),vault:{id:randomUUID()}},values=new Map([['owner',{version:1,projectId:workspace.projectId,namespaceId,domain:'pdf',vaultId:workspace.vault.id}]]);let now=1800000000000,tail=Promise.resolve(),writes=0;
 const documents={available:async()=>true,domains:{run:async(domains,operation,{write=[],signal,check=async()=>{}}={})=>{
  const previous=tail,next=deferred();tail=next.promise;await previous;const before=structuredClone(values);
  const store={domain:'pdf',namespaceId,workspace,writable:write.includes('pdf'),db:{get:async sql=>{assert.match(sql,/clock_timestamp/);return {now};}},object:async key=>structuredClone(values.get(key)??null),putObject:async(key,value)=>{assert.ok(write.includes('pdf'));writes++;assert.ok(Buffer.byteLength(serialize(value))<65536);values.set(key,structuredClone(value));},deleteObject:async key=>{assert.ok(write.includes('pdf'));writes++;values.delete(key);},async *objectIdEntries(prefix){yield* [...values.keys()].filter(key=>key.startsWith(prefix)).sort();}};
  try{signal?.throwIfAborted();await check();const result=await operation(()=>store);signal?.throwIfAborted();await check();return result;}catch(error){values.clear();for(const [key,value] of before)values.set(key,value);throw error;}finally{next.resolve();}
 }}};
 const id=randomUUID(),header={version:1,id,name:'Pinned report',language:'en',direction:'ltr',layout:pdfLayoutPreset(),...(archival?{outputProfile:'pdfa-2u'}:{})},section={id:randomUUID(),title:'Selected evidence',content:'Exact edition',layout:null,start:null};
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

// These receipts exercise persistence and admission only. Synthetic bytes and
// mocked counts do not claim that veraPDF validated a real archival document.
const receipt=sha256=>({version:1,profile:'pdfa-2u',sha256,validator:'veraPDF',validatorVersion:'1.30.3',validatorSha256:PDF_ARCHIVAL_VALIDATOR_SHA256,passedRules:100,passedChecks:200});
function outputTree(f,job){const prefix='pdf-export:block:'+job.id+':'+job.attempt+':';return new RecordValueTree({read:async(kind,revision)=>structuredClone(f.values.get(prefix+kind+':'+revision)),put:async(kind,value)=>{const revision=digest(serialize(value));f.values.set(prefix+kind+':'+revision,structuredClone(value));return revision;}});}

test('synthetic archival receipts remain bound to pinned profile and final bytes in completed job summaries and immutable outputs',async()=>{
 const f=await fixture({archival:true}),output=render(),validation=receipt(output.sha256),jobId=randomUUID(),jobs=new PdfExportJobs(f.documents,{prepare:async()=>({...output,validation})});await jobs.start({jobId,documentId:f.id,revision:f.revision});const completed=await jobs.work(jobId),key='pdf-export:job:'+jobId,job=f.values.get(key);assert.equal(job.version,2);assert.deepEqual(completed.validation,validation);assert.deepEqual((await jobs.list()).items[0].validation,validation);assert.deepEqual((await jobs.download(jobId)).validation,validation);assert.deepEqual((await jobs.download(jobId)).bytes,output.bytes);const immutable=await outputTree(f,job).read(job.output.root);assert.equal(immutable.version,2);assert.deepEqual(immutable.validation,validation);assert.deepEqual(await f.verify(),{jobs:1,completed:1});
 const {outputProfile,...ordinaryHeader}=f.header,changed=await f.documents.domains.run(['pdf'],get=>new PdfDocumentStore(get('pdf')).change({id:f.id,commandId:randomUUID(),expectedRevision:f.revision,operation:{type:'header',header:ordinaryHeader}}),{write:['pdf']});assert.equal((await jobs.status(jobId)).revision,f.revision);await f.documents.domains.run(['pdf'],get=>new PdfDocumentStore(get('pdf')).change({id:f.id,commandId:randomUUID(),expectedRevision:changed.revision,operation:{type:'remove'}}),{write:['pdf']});assert.deepEqual((await jobs.download(jobId)).validation,validation);
 const original=structuredClone(job);for(const changed of [{...job,output:{...job.output,validation:{...validation,passedChecks:201}}},{...job,output:{...job.output,validation:{...validation,sha256:'a'.repeat(64)}}}]){f.values.set(key,changed);await assert.rejects(jobs.status(jobId),{code:'CATALOGUE_DAMAGED'});await assert.rejects(jobs.download(jobId),{code:'CATALOGUE_DAMAGED'});await assert.rejects(f.verify(),{code:'CATALOGUE_DAMAGED'});}f.values.set(key,structuredClone(original));
 const changedRoot=await outputTree(f,original).retain({...immutable,validation:{...validation,passedRules:101}});f.values.set(key,{...original,output:{...original.output,root:changedRoot}});await assert.rejects(jobs.status(jobId),{code:'CATALOGUE_DAMAGED'});await assert.rejects(jobs.download(jobId),{code:'CATALOGUE_DAMAGED'});await assert.rejects(f.verify(),{code:'CATALOGUE_DAMAGED'});
 const {validation:unused,...legacyOutput}=immutable,{validation:unusedSummary,...legacySummary}=original.output,legacyRoot=await outputTree(f,original).retain({...legacyOutput,version:1});f.values.set(key,{...original,version:1,output:{...legacySummary,root:legacyRoot}});await assert.rejects(jobs.status(jobId),{code:'CATALOGUE_DAMAGED'});await assert.rejects(jobs.download(jobId),{code:'CATALOGUE_DAMAGED'});f.values.set(key,original);await f.verify();
});

test('synthetic archival receipt plumbing refuses missing, forged and mismatched receipts and preserves ordinary version-one exports',async()=>{
 const f=await fixture({archival:true}),output=render(),valid=receipt(output.sha256),invalid=[undefined,{...valid,sha256:'a'.repeat(64)},{...valid,validatorSha256:'b'.repeat(64)},{...valid,validatorVersion:'1.0'},{...valid,profile:'pdfa-2b'},{...valid,passedChecks:0},{...valid,extra:true}];
 for(const validation of invalid){const jobId=randomUUID(),jobs=new PdfExportJobs(f.documents,{prepare:async()=>({...output,...(validation===undefined?{}:{validation})})});await jobs.start({jobId,documentId:f.id,revision:f.revision});const result=await jobs.work(jobId);assert.equal(result.state,'failed');assert.equal(result.error.code,'PDF_OUTPUT');assert.equal(result.validation,undefined);assert.equal([...f.values.keys()].some(key=>key.startsWith('pdf-export:block:'+jobId+':')),false);await assert.rejects(jobs.download(jobId),{code:'JOB_CHANGED'});}
 await f.verify();const legacy=await fixture(),jobId=randomUUID(),jobs=new PdfExportJobs(legacy.documents,{prepare:async()=>({...output,validation:valid})});await jobs.start({jobId,documentId:legacy.id,revision:legacy.revision});assert.equal((await jobs.work(jobId)).error.code,'PDF_OUTPUT');const retry=new PdfExportJobs(legacy.documents,{prepare:async()=>output});await retry.resume(jobId);const result=await retry.work(jobId),stored=legacy.values.get('pdf-export:job:'+jobId);assert.equal(result.state,'completed');assert.equal(stored.version,1);assert.deepEqual(Object.keys(stored.output).sort(),['bytes','root','sha256']);assert.deepEqual(Object.keys(await outputTree(legacy,stored).read(stored.output.root)).sort(),['bytes','documentId','preflight','renderer','revision','root','sha256','version']);assert.equal(Object.hasOwn(result,'validation'),false);assert.equal(Object.hasOwn(await retry.download(jobId),'validation'),false);await legacy.verify();
});


// Synthetic PDF/UA receipts exercise admission/persistence only, not PDF/UA
// conformance or human accessibility review. The renderer owns real validation.
const accessibilityReceipt=sha256=>({...receipt(sha256),profile:'pdfua-1',automatedOnly:true});
async function accessibilityFixture(){
 const f=await fixture(),header={...f.header,outputProfile:'pdfua-1'},saved=await f.documents.domains.run(['pdf'],get=>new PdfDocumentStore(get('pdf')).change({id:f.id,commandId:randomUUID(),expectedRevision:f.revision,operation:{type:'header',header}}),{write:['pdf']});return {...f,header,revision:saved.revision};
}

test('synthetic PDF/UA receipts remain machine-only and bound to the exact pinned profile through every retained reader',async()=>{
 const f=await accessibilityFixture(),output=render(),validation=accessibilityReceipt(output.sha256),jobId=randomUUID(),jobs=new PdfExportJobs(f.documents,{prepare:async()=>({...output,validation})});await jobs.start({jobId,documentId:f.id,revision:f.revision});const completed=await jobs.work(jobId),key='pdf-export:job:'+jobId,original=structuredClone(f.values.get(key)),immutable=await outputTree(f,original).read(original.output.root);
 assert.equal(completed.state,'completed');assert.equal(original.version,2);assert.deepEqual(completed.validation,validation);assert.deepEqual((await jobs.status(jobId)).validation,validation);assert.deepEqual((await jobs.list()).items[0].validation,validation);assert.deepEqual((await jobs.download(jobId)).validation,validation);assert.deepEqual((await jobs.download(jobId)).bytes,output.bytes);assert.deepEqual(immutable.validation,validation);await f.verify();
 // A later archival choice cannot reinterpret the earlier accessible edition.
 await f.documents.domains.run(['pdf'],get=>new PdfDocumentStore(get('pdf')).change({id:f.id,commandId:randomUUID(),expectedRevision:f.revision,operation:{type:'header',header:{...f.header,outputProfile:'pdfa-2u'}}}),{write:['pdf']});assert.deepEqual((await jobs.download(jobId)).validation,validation);await f.verify();
 // Even mutually matching, individually valid receipt copies are invalid when
 // their profile differs from the immutable document revision they claim.
 const archival=receipt(output.sha256),root=await outputTree(f,original).retain({...immutable,validation:archival});f.values.set(key,{...original,output:{...original.output,root,validation:archival}});
 for(const read of [()=>jobs.status(jobId),()=>jobs.list(),()=>jobs.download(jobId),()=>f.verify()])await assert.rejects(read(),{code:'CATALOGUE_DAMAGED'});f.values.set(key,original);await f.verify();
});

test('synthetic PDF/UA and archival receipts cannot substitute profiles or omit the machine-only acknowledgement',async()=>{
 const ua=await accessibilityFixture(),archival=await fixture({archival:true}),ordinary=await fixture(),output=render(),validation=accessibilityReceipt(output.sha256),{automatedOnly,...missing}=validation;
 const attempts=[[ua,undefined],[ua,receipt(output.sha256)],[archival,validation],[ordinary,validation],[ua,missing],[ua,{...validation,automatedOnly:false}],[ua,{...validation,compliant:true}]];
 for(const [f,resultValidation] of attempts){const jobId=randomUUID(),jobs=new PdfExportJobs(f.documents,{prepare:async()=>({...output,...(resultValidation?{validation:resultValidation}:{})})});await jobs.start({jobId,documentId:f.id,revision:f.revision});const failed=await jobs.work(jobId);assert.equal(failed.state,'failed');assert.equal(failed.error.code,'PDF_OUTPUT');assert.equal(failed.validation,undefined);assert.equal([...f.values.keys()].some(key=>key.startsWith('pdf-export:block:'+jobId+':')),false);await f.verify();}
});
