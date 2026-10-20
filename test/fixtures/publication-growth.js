import assert from 'node:assert/strict';
import {mkdir,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {getHeapStatistics} from 'node:v8';
import {encryptedFixture} from '../browser/encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {retainPublicationInput} from '../../src/publication-input.js';
import {PublicationJobs} from '../../src/publication-jobs.js';
import {FileContent,contentBuffer,contentSize,writePublicFile} from '../../src/file-content.js';
import {digest,serialize} from '../../src/storage-format.js';
import {verifyPublicationCandidate} from '../../src/retained-publication-files.js';
import {withPublicationCapture} from '../../src/publication-capture.js';
import {SOURCE_PUBLICATION_VERSION} from '../../src/web/source-publication-permissions.js';

// One scenario, executed by the test wrapper in a bounded child process.
async function measure(count,directory){
 const signal=new AbortController().signal,heapLimit=getHeapStatistics().heap_size_limit;
 assert.ok(heapLimit<256*1024*1024,'The scenario requires an enforced heap limit below 256 MiB');
 const book=sampleNotebook(),seed=book.entries[0];book.entries=[];
 const f=await encryptedFixture(directory,book);let monitor;
 try{
 const releases=new PublicationJobs(f.workspace),outline=await releases.workspace.outline(),ids=Array.from({length:count},()=>randomUUID());let inputBytes=0,peak=0,activePhase='setup',peakPhase='setup';const phasePeaks={};
 const sample=()=>{const memory=process.memoryUsage();phasePeaks[activePhase]=Math.max(phasePeaks[activePhase]??0,memory.heapUsed);if(memory.heapUsed>peak){peak=memory.heapUsed;peakPhase=activePhase;}return memory;};
 monitor=setInterval(sample,10);
 async function* originals(){for(let i=0;i<count;i++){
  const record={...seed,id:ids[i],notebookId:outline.metadata.notebooks[0].id,title:'Field observation '+i,body:('Retained observations from a controlled synthetic trial. ').repeat(1000),share:true,sections:[],figures:[],relations:[],attachments:[]};
  inputBytes+=Buffer.byteLength(serialize(record));yield record;
 }}
 return await f.workspace.withCatalogueConnections(async()=>{
 const begun=performance.now(),phase=(name,next)=>{const memory=sample();console.log(JSON.stringify({records:count,stage:name,phase:activePhase,elapsedMs:Math.round(performance.now()-begun),heapBytes:memory.heapUsed,heapTotal:memory.heapTotal,externalBytes:memory.external,peakHeapBytes:peak,peakPhase,phasePeaks,heapLimit}));if(next)activePhase=next;};phase('retaining input','capture');
 // Synthetic originals still use the production capture's staged reads,
 // bounded metadata commits, format admission and failure-cleanup owner.
 const source=await withPublicationCapture(releases.workspace,async(workspace,id,finish)=>{
  let retained=0;
  const input=await retainPublicationInput(workspace,id,outline.metadata,originals(),{signal,onRecord:()=>{if(++retained%100===0||retained===count)phase('retained originals '+retained);}});
  const value={sourcePermissionVersion:SOURCE_PUBLICATION_VERSION,version:6,id,reviewId:digest(id),workspaceId:book.id,websiteId:null,websitePin:outline.websitePin,createdAt:new Date().toISOString(),etag:outline.etag,...input,blockedValues:[],configEtag:'0'.repeat(64),destination:null};
  await workspace.writeMetadata('.observanda/release-inputs/'+id+'.json',serialize(value));
  return finish(()=>value);
 },{signal});
 const {id}=source;phase('input retained','prepare');
 assert.ok(Buffer.byteLength(serialize(source))<count*1500);assert.equal(source.metadata.entries,undefined);
 const job={id,scope:book.id,input:{revision:digest(serialize(source))},lease:{token:randomUUID()}},preparedAt=performance.now();
 phase('preparing');
 const prepared=await releases.prepare(job,{signal,progress:async()=>{}}),preparedMs=performance.now()-preparedAt;
 phase('prepared','commit');assert.ok(preparedMs<120000,'Preparation time budget');
 await f.workspace.withLock(()=>releases.commit(job,prepared));phase('committed','reopen');
 const openedAt=performance.now(),candidate=await releases.read(source.reviewId),openedMs=performance.now()-openedAt;phase('reopened','inventory');assert.ok(openedMs<60000,'Open review budget');
 assert.equal(candidate.files.output.count('entries'),count);assert.equal(candidate.files.output.count('pages'),count+4);
 assert.equal((await releases.pageChoices(candidate,{path:'browse.html',limit:1})).items[0].path,'browse.html');
 let recordPages=0;for await(const {value} of candidate.files.output.items('pages'))if(value.path.startsWith('entries/'))recordPages++;assert.equal(recordPages,count);
 phase('verifying candidate','verification');await verifyPublicationCandidate(candidate);phase('candidate verified','export');
 let bytes=0,lastPageSeen=false;const destination=path.join(directory,'export');
 // Full integrity/privacy admission above already checks every retained file.
 // Inspect descriptors and compare exported bytes in one further inventory pass.
 for await(const {file,content} of candidate.files.contents()){
  if(file.name!=='publication.json')assert.ok(content instanceof FileContent,file.name);bytes+=contentSize(content);
  if(file.name==='entries/'+ids.at(-1)+'.html'){assert.equal(lastPageSeen,false);lastPageSeen=true;assert.ok((await contentBuffer(content)).toString().includes('Field observation '+(count-1)));}
  if(count===650){const target=path.join(destination,file.name);await mkdir(path.dirname(target),{recursive:true});await writePublicFile(target,content);assert.deepEqual(await readFile(target),await contentBuffer(content));}
 }
 assert.equal(lastPageSeen,true,'The last selected record page was not exported');assert.ok(bytes>inputBytes);
 phase('output compared','complete');assert.ok(peak<256*1024*1024,'Heap budget: '+peak+' during '+peakPhase);
 // Synthetic originals bypass authoring membership; this verifies retained
 // output, while LocalExport admission/recovery has separate native coverage.
 if(count===650)assert.ok(inputBytes>32*1024*1024);
 return {records:count,inputBytes,outputBytes:bytes,preparedMs:Math.round(preparedMs),openedMs:Math.round(openedMs),heapMiB:Math.ceil(peak/1048576),peakPhase,phasePeaks,heapLimit,elapsedMs:Math.round(performance.now()-begun),platform:process.platform,node:process.version,cpu:os.cpus()[0].model};
 });
 }finally{clearInterval(monitor);clearVault(f.vault);}
}

const count=Number(process.argv[2]),directory=path.resolve(process.argv[3]??''),temporary=await realpath(os.tmpdir());
assert.ok([65,650].includes(count));assert.equal(path.dirname(directory),temporary);assert.ok(path.basename(directory).startsWith('observanda-edition-growth-'));
assert.ok(process.env.OBSERVANDA_DATABASE_URL,'The existing isolated PostgreSQL test runner is required');
console.log(JSON.stringify(await measure(count,directory)));
