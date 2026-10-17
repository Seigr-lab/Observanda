import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {retainPublicationInput} from '../src/publication-input.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {FileContent,contentBuffer,contentSize,writePublicFile} from '../src/file-content.js';
import {digest,serialize} from '../src/storage-format.js';
import {verifyPublicationCandidate} from '../src/retained-publication-files.js';
import {assertPublicationDocumentStorage} from '../src/publication-document-storage.js';

// Qualifies the edition owner beyond the current authoring compatibility cap.
// It does not remove that separate cap or claim a full-workspace growth pass.
for(const count of [65,650])test('page-at-a-time retained edition handles '+count+' substantive originals',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-edition-growth-')),book=sampleNotebook(),seed=book.entries[0];book.entries=[];
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const releases=new PublicationJobs(f.workspace),outline=await releases.workspace.outline(),id=randomUUID(),ids=Array.from({length:count},()=>randomUUID());let inputBytes=0,peak=0;
 const monitor=setInterval(()=>peak=Math.max(peak,process.memoryUsage().heapUsed),10);t.after(()=>clearInterval(monitor));
 async function* originals(){for(let i=0;i<count;i++){
  const record={...seed,id:ids[i],notebookId:outline.metadata.notebooks[0].id,title:'Field observation '+i,body:('Retained observations from a controlled synthetic trial. ').repeat(1000),share:true,sections:[],figures:[],relations:[],attachments:[]};
  inputBytes+=Buffer.byteLength(serialize(record));yield record;
 }}
 const begun=performance.now();
 const input=await releases.workspace.withLock(async()=>{await assertPublicationDocumentStorage(releases.workspace);return retainPublicationInput(releases.workspace,id,outline.metadata,originals());});
 const source={version:6,id,reviewId:digest(id),workspaceId:book.id,websiteId:null,websitePin:outline.websitePin,createdAt:new Date().toISOString(),etag:outline.etag,...input,blockedValues:[],configEtag:'0'.repeat(64),destination:null};
 await f.workspace.withLock(()=>f.workspace.writeMetadata('.observanda/release-inputs/'+id+'.json',serialize(source)));
 assert.ok(Buffer.byteLength(serialize(source))<count*1500);assert.equal(source.metadata.entries,undefined);
 const job={id,scope:book.id,input:{revision:digest(serialize(source))},lease:{token:randomUUID()}},preparedAt=performance.now();
 const prepared=await releases.prepare(job,{signal:new AbortController().signal,progress:async()=>{}}),preparedMs=performance.now()-preparedAt;
 await f.workspace.withLock(()=>releases.commit(job,prepared));
 const openedAt=performance.now(),candidate=await releases.read(source.reviewId),openedMs=performance.now()-openedAt;
 assert.equal(candidate.files.output.count('entries'),count);assert.equal(candidate.files.output.count('pages'),count+4);
 assert.equal((await releases.pageChoices(candidate,{path:'browse.html',limit:1})).items[0].path,'browse.html');
 let recordPages=0;for await(const {value} of candidate.files.output.items('pages'))if(value.path.startsWith('entries/'))recordPages++;assert.equal(recordPages,count);
 for await(const [name,content] of candidate.files)if(name!=='publication.json')assert.ok(content instanceof FileContent,name);
 assert.ok((await contentBuffer(await candidate.files.get('entries/'+ids.at(-1)+'.html'))).toString().includes('Field observation '+(count-1)));await verifyPublicationCandidate(candidate);
 let bytes=0;for await(const content of candidate.files.values())bytes+=contentSize(content);assert.ok(bytes>inputBytes);
 assert.ok(preparedMs<120000,'Preparation time budget');assert.ok(openedMs<60000,'Open review budget');assert.ok(peak<256*1024*1024,'Heap budget: '+peak);
 if(count===650){
  assert.ok(inputBytes>32*1024*1024);const destination=path.join(directory,'export');
  // These synthetic originals deliberately bypass authoring membership. Export
  // the verified retained files directly; fresh LocalExport admission is covered
  // by its own saved-workspace recovery cases.
  for await(const [name,content] of candidate.files){const file=path.join(destination,name);await mkdir(path.dirname(file),{recursive:true});await writePublicFile(file,content);assert.deepEqual(await readFile(file),await contentBuffer(content));}
 }
 t.diagnostic(JSON.stringify({records:count,inputBytes,outputBytes:bytes,preparedMs:Math.round(preparedMs),openedMs:Math.round(openedMs),heapMiB:Math.ceil(peak/1048576),elapsedMs:Math.round(performance.now()-begun),platform:process.platform,node:process.version,cpu:os.cpus()[0].model}));
});
