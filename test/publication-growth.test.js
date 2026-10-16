import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {retainPublicationInput} from '../src/publication-input.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {FileContent,contentBuffer,contentSize} from '../src/file-content.js';
import {digest,serialize} from '../src/storage-format.js';
import {verifyPublication,writePublication} from '../src/publication.js';

// Qualifies the edition owner beyond the current authoring compatibility cap.
// It does not remove that separate cap or claim a full-workspace growth pass.
for(const count of [65,650])test('page-at-a-time retained edition handles '+count+' substantive originals',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-edition-growth-')),book=sampleNotebook(),seed=book.entries[0];book.entries=[];
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const outline=await f.workspace.outline(),id=randomUUID(),ids=Array.from({length:count},()=>randomUUID());let inputBytes=0,peak=0;
 const monitor=setInterval(()=>peak=Math.max(peak,process.memoryUsage().heapUsed),10);t.after(()=>clearInterval(monitor));
 async function* originals(){for(let i=0;i<count;i++){
  const record={...seed,id:ids[i],notebookId:outline.metadata.notebooks[0].id,title:'Field observation '+i,body:('Retained observations from a controlled synthetic trial. ').repeat(1000),share:true,sections:[],figures:[],relations:[],attachments:[]};
  inputBytes+=Buffer.byteLength(serialize(record));yield record;
 }}
 const begun=performance.now();
 const input=await f.workspace.withLock(()=>retainPublicationInput(f.workspace,id,outline.metadata,originals()));
 const source={version:2,id,reviewId:digest(id),workspaceId:book.id,createdAt:new Date().toISOString(),etag:outline.etag,...input,blockedValues:[],configEtag:'0'.repeat(64),destination:null};
 await f.workspace.withLock(()=>f.workspace.writeMetadata('.observanda/release-inputs/'+id+'.json',serialize(source)));
 assert.ok(Buffer.byteLength(serialize(source))<count*1500);assert.equal(source.metadata.entries,undefined);
 const releases=new PublicationJobs(f.workspace),job={id,scope:book.id,input:{revision:digest(serialize(source))},lease:{token:randomUUID()}},preparedAt=performance.now();
 const prepared=await releases.prepare(job,{signal:new AbortController().signal,progress:async()=>{}}),preparedMs=performance.now()-preparedAt;
 await f.workspace.withLock(()=>releases.commit(job,prepared));
 const openedAt=performance.now(),candidate=await releases.read(source.reviewId),openedMs=performance.now()-openedAt;
 assert.equal(candidate.entries.length,count);assert.equal(candidate.pages.length,count+4);
 assert.equal(candidate.pages.filter(p=>p.path==='browse.html').length,1);
 assert.equal(candidate.pages.filter(p=>p.path.startsWith('entries/')).length,count);
 assert.equal([...candidate.files].filter(([name,content])=>name!=='publication.json'&&!(content instanceof FileContent)).length,0);
 assert.ok((await contentBuffer(candidate.files.get('entries/'+ids.at(-1)+'.html'))).toString().includes('Field observation '+(count-1)));verifyPublication(candidate);
 const bytes=[...candidate.files.values()].reduce((n,c)=>n+contentSize(c),0);assert.ok(bytes>inputBytes);
 assert.ok(preparedMs<120000,'Preparation time budget');assert.ok(openedMs<60000,'Open review budget');assert.ok(peak<256*1024*1024,'Heap budget: '+peak);
 if(count===650){assert.ok(inputBytes>32*1024*1024);await writePublication(candidate,path.join(directory,'export'));}
 t.diagnostic(JSON.stringify({records:count,inputBytes,outputBytes:bytes,preparedMs:Math.round(preparedMs),openedMs:Math.round(openedMs),heapMiB:Math.ceil(peak/1048576),elapsedMs:Math.round(performance.now()-begun),platform:process.platform,node:process.version,cpu:os.cpus()[0].model}));
});
