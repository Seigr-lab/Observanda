import {publicationText} from './publication-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {Workspace} from '../src/storage.js';
import {recordRevision} from '../src/research.js';
import {defaultEditionRecord} from '../src/web/publication-selection.js';
import {MediaStore} from '../src/media.js';
import {contentBuffer,FileContent} from '../src/file-content.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {AppError} from '../src/errors.js';
async function fixture(t){const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-release-jobs-')),f=await encryptedFixture(directory,sampleNotebook()),jobs=workspaceJobs(f.workspace);t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});return {...f,...jobs,directory,releases:new PublicationJobs(f.workspace)};}
const options=()=>({signal:new AbortController().signal,progress:async()=>{}});
async function terminal(queue,id){for(let i=0;i<400;i++){const job=await queue.read(id);if(['completed','failed','cancelled'].includes(job.state))return job;await delay(25);}assert.fail('Publication did not finish');}

test('retained publication pins drafts and media, excludes private sources, and restores under a new encryption key',async t=>{
 const f=await fixture(t),media=new MediaStore(f.workspace.root,f.vault),original=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><!-- private source details --><rect width="20" height="20" fill="red"/></svg>');
 const asset=await media.import(original,'image'),current=await f.workspace.read(),draft=structuredClone(current.book);draft.entries[0].share=true;draft.entries[0].title='Pinned musical take';draft.entries[0].attachments=[{...asset,caption:'Selected image',alt:'Red square',transcript:'',share:true}];draft.entries[1].share=false;draft.entries[1].title='PRIVATE_SENTINEL';
 const job=await f.releases.start({etag:current.etag,book:draft,blockedValues:[f.workspace.root]},f.queue);
 current.book.entries[0].title='Later changed record';await f.workspace.save(current.book,current.etag);
 f.worker.start();const done=await terminal(f.queue,job.id);await f.worker.stop();assert.equal(done.state,'completed');
 const candidate=await f.releases.read(done.result.id);assert.equal(candidate.sourceRevisions[draft.entries[0].id],recordRevision(draft.entries[0]));
 const text=await publicationText(candidate);assert.match(text,/Pinned musical take/);for(const secret of ['Later changed record','PRIVATE_SENTINEL','private source details',f.workspace.root])assert.ok(!text.includes(secret));
 const output=[...candidate.files.values()].find(v=>v instanceof FileContent);assert.ok(output);assert.ok(!(await readFile(output.file)).includes(await contentBuffer(output)));
 const access=await createAccess('','another installation password'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const restored=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'restored')),access,vault,f.vault),again=await new PublicationJobs(new Workspace(restored,vault)).read(done.result.id);
 assert.equal(again.id,candidate.id);for(const [name,content] of candidate.files)assert.deepEqual(await contentBuffer(again.files.get(name)),await contentBuffer(content));
 assert.equal((await workspaceJobs(new Workspace(restored,vault)).queue.read(job.id)).state,'completed');
});

test('cancelled preparation survives restart and retry without silently using a newer draft',async t=>{
 const f=await fixture(t),current=await f.workspace.read(),choice=defaultEditionRecord(current.book.entries[0],recordRevision(current.book.entries[0]));choice.body=false;choice.figures[0].data=true;
 const edition={version:1,records:[choice]},job=await f.releases.start({...current,edition},f.queue);let entered;const ready=new Promise(r=>entered=r),definition=f.queue.definitions['publication.prepare'],prepare=definition.prepare;
 definition.prepare=async(...args)=>{entered();await delay(30000,null,{signal:args[1].signal});return prepare(...args);};f.worker.start();await ready;await f.queue.control(job.id,'cancel');f.worker.cancel(job.id);assert.equal((await terminal(f.queue,job.id)).state,'cancelled');await f.worker.stop();
 const later=await f.workspace.read();later.book.entries[0].title='Changed after cancellation';await f.workspace.save(later.book,later.etag);
 const restarted=workspaceJobs(new Workspace(f.workspace.root,f.vault));await restarted.queue.control(job.id,'retry');restarted.worker.start();let done;try{done=await terminal(restarted.queue,job.id);}finally{await restarted.worker.stop();}
 assert.equal(done.state,'completed');assert.equal(done.attempt,2);const output=await f.releases.read(done.result.id);assert.equal(output.etag,current.etag);assert.ok(!(await publicationText(output)).includes('Changed after cancellation'));
 assert.ok(!(await publicationText(output)).includes('how does a seedling change'));assert.ok([...output.files.keys()].some(name=>name.endsWith('.csv')));assert.deepEqual((await f.releases.source(job.id)).records[0].selection,choice);
});

test('expired workers, rolled-back completion and corrupted retained output cannot deliver a release',async t=>{
 const f=await fixture(t),job=await f.releases.start(await f.workspace.read(),f.queue),first=await f.queue.claim(),stale=await f.queue.definition(first).prepare(first,options());
 await f.queue.transaction(async()=>{const j=await f.queue.read(job.id);j.lease.until=0;await f.queue.write(j);});const next=await f.queue.claim();await assert.rejects(f.queue.complete(job.id,first.lease.token,stale),{code:'JOB_LEASE'});
 const prepared=await f.queue.definition(next).prepare(next,options()),commit=f.queue.definitions['publication.prepare'].commit;
 f.queue.definitions['publication.prepare'].commit=async(...args)=>{await commit(...args);throw new AppError('STORAGE_FULL');};await assert.rejects(f.queue.complete(job.id,next.lease.token,prepared),{code:'STORAGE_FULL'});assert.equal(await f.releases.read(prepared.reviewId),null);
 f.queue.definitions['publication.prepare'].commit=commit;await f.queue.complete(job.id,next.lease.token,prepared);await f.queue.definition(first).discard(first);await f.queue.definition(next).discard(next);assert.ok(await f.releases.read(prepared.reviewId));
 const output=path.join(f.workspace.root,'.observanda/releases',job.id,next.lease.token,'0.blob'),bytes=await readFile(output);bytes[bytes.length-1]^=1;await writeFile(output,bytes);await assert.rejects(f.releases.read(prepared.reviewId));
});

test('private prose fails preparation before a public candidate can be served',async t=>{
 const f=await fixture(t),current=await f.workspace.read();current.book.entries[0].share=true;current.book.entries[0].title='Private path C:/Users/secret/private-file';const job=await f.releases.start(current,f.queue);f.worker.start();const done=await terminal(f.queue,job.id);await f.worker.stop();assert.equal(done.state,'failed');assert.equal(done.error,'PRIVACY');assert.equal(await f.releases.read((await f.releases.source(job.id)).reviewId),null);assert.equal(done.result,null);
});
