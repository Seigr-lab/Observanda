import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,unlink,link,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {LocalExport} from '../src/local-export.js';
import {outputName,temporary} from '../src/local-export-files.js';
import {clearVault} from '../src/encryption.js';
import {contentBuffer} from '../src/file-content.js';
import {digest,serialize} from '../src/storage-format.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {WebsiteSites} from '../src/website-sites.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {verifyPublicationStorage} from '../src/publication-storage-verification.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-local-export-')),book=sampleNotebook();book.projects.forEach(p=>p.share=true);book.entries[2].share=true;book.entries[1].share=false;book.entries[1].title='PRIVATE_UNRELEASED_COMPONENT';
 const f=await encryptedFixture(directory,book),destination=path.join(directory,'website'),releases=new PublicationJobs(f.workspace),jobs=workspaceJobs(f.workspace);
 await mkdir(destination);await mkdir(path.join(destination,'.git'));await writeFile(path.join(destination,'.git','HEAD'),'Unrelated repository history');await writeFile(path.join(destination,'manual.html'),'An unrelated page');
 const prepare=async()=>{
  const {etag,metadata}=await f.workspace.outline(),job=await releases.start({etag,workspaceId:metadata.id},jobs.queue),claimed=await jobs.queue.claim();
  assert.equal(claimed.id,job.id);const candidate=await releases.prepare(claimed,{signal:new AbortController().signal,progress:async()=>{}});
  await jobs.queue.complete(job.id,claimed.lease.token,candidate);return releases.read(candidate.reviewId);
 };
 const first=await prepare();t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,directory,destination,prepare,first,service:new LocalExport(f.workspace)};
}
async function verifyOutput(candidate,directory){for(const [name,content] of candidate.files)assert.deepEqual(await readFile(path.join(directory,name)),await contentBuffer(content),name);}
const planFor=(f,c=f.first,directory=f.destination)=>f.service.plan({reviewId:c.reviewId,directory});
const apply=(service,id)=>service.apply({id,reviewed:true});
async function revised(f){const current=await f.workspace.read();current.book.entries[0].title='Revised oscillator trial';current.book.entries[2].share=false;await f.workspace.save(current.book,current.etag);return f.prepare();}

test('legacy export plans and ownership receipts recover and continue into indexed editions',async t=>{
 const f=await fixture(t),review=await planFor(f),saved=await f.service.get(review.id),changes=await Array.fromAsync(f.service.changes(saved));
 const {counts,...legacy}=saved;void counts;legacy.version=1;legacy.changes=changes;
 const owner='.observanda/local-exports/owners/'+digest(process.platform==='win32'?f.destination.toLowerCase():f.destination)+'.json';
 await f.workspace.withLock(async()=>{await f.workspace.writeMetadata('.observanda/local-exports/'+review.id+'.json',serialize(legacy));await f.workspace.writeMetadata(owner,serialize({version:1,directory:f.destination,files:[],pending:review.id}));});
 const interrupted=new LocalExport(f.workspace,{checkpoint:async phase=>{if(phase==='installed')throw Error('Interrupted legacy export');}});
 await assert.rejects(apply(interrupted,review.id),/Interrupted legacy export/);await apply(new LocalExport(f.workspace),review.id);await verifyOutput(f.first,f.destination);
 const receipt=JSON.parse(await f.workspace.readMetadata(owner,16384));assert.equal(receipt.version,2);assert.equal(receipt.files.root.count,f.first.files.size);assert.equal(receipt.pending,null);
 const next=await planFor(f);assert.equal((await f.service.get(next.id)).version,2);assert.equal(next.counts.unchanged,f.first.files.size);
});

test('indexed export journals resume a long edition while foreground research remains writable',async t=>{
 const f=await fixture(t),files=new Map(Array.from({length:1003},(_,i)=>['assets/'+String(i).padStart(5,'0')+'.txt','Retained file '+i]));files.set('index.html','<!doctype html><title>Synthetic retained edition</title>');
 const candidate={reviewId:digest('large-local-review'),id:digest('large-local-edition'),defaultPage:'index.html',files};
 const configure=service=>{service.candidate=async id=>{assert.equal(id,candidate.reviewId);return candidate;};return service;};
 let stopped=false,foregroundMs=0;const service=configure(new LocalExport(f.workspace,{checkpoint:async(phase,name)=>{
  if(phase==='installed'&&name==='assets/00500.txt'&&!stopped){stopped=true;const began=Date.now(),current=await f.workspace.read();current.book.entries[0].title='Research saved during export';await f.workspace.save(current.book,current.etag);foregroundMs=Date.now()-began;throw Error('Interrupted long export');}
 }}));
 const began=Date.now(),plan=await service.plan({reviewId:candidate.reviewId,directory:f.destination});assert.equal(plan.total,1004);
 await assert.rejects(apply(service,plan.id),/Interrupted long export/);assert.ok(stopped);
 const fresh=configure(new LocalExport(f.workspace)),raw=await f.workspace.readMetadata('.observanda/local-exports/'+plan.id+'.json',16384);assert.ok(Buffer.byteLength(raw)<4096);assert.equal(JSON.parse(raw).version,2);
 const page=await fresh.page({id:plan.id,offset:1000});assert.equal(page.files.length,4);assert.equal(page.next,null);assert.equal(page.files.at(-1).path,'index.html');
 const complete=await apply(fresh,plan.id);assert.equal(complete.applied,1004);assert.equal(complete.cleaned,true);await verifyOutput(candidate,f.destination);
 assert.equal((await f.workspace.read()).book.entries[0].title,'Research saved during export');assert.equal(await readFile(path.join(f.destination,'manual.html'),'utf8'),'An unrelated page');
 t.diagnostic(JSON.stringify({files:1004,interruptedAfter:501,prepareRecoverVerifyMs:Date.now()-began,foregroundMs,journalBytes:Buffer.byteLength(raw)}));
 candidate.id=digest('amended-long-edition');candidate.reviewId=digest('amended-long-review');files.set('assets/00500.txt','Changed evidence caption');files.delete('assets/00950.txt');files.set('assets/01004.txt','An added file');
 const updated=Date.now(),amended=await fresh.plan({reviewId:candidate.reviewId,directory:f.destination});assert.deepEqual(amended.counts,{added:1,replaced:1,removed:1,unchanged:1002,conflict:0});
 await apply(fresh,amended.id);await verifyOutput(candidate,f.destination);await assert.rejects(readFile(path.join(f.destination,'assets/00950.txt')),{code:'ENOENT'});
 assert.equal((await fresh.get(plan.id)).releaseId,digest('large-local-edition'));t.diagnostic(JSON.stringify({amendedFiles:1004,reviewApplyVerifyMs:Date.now()-updated}));
});

test('indexed export ownership and an interrupted journal survive fresh-key workspace restoration',async t=>{
 const f=await fixture(t);await apply(f.service,(await planFor(f)).id);const candidate=await revised(f),plan=await planFor(f,candidate);let stopped=false;
 const interrupted=new LocalExport(f.workspace,{checkpoint:async phase=>{if(phase==='moved'&&!stopped){stopped=true;throw Error('Interrupted before restored recovery');}}});
 await assert.rejects(apply(interrupted,plan.id),/Interrupted before restored recovery/);assert.ok(stopped);
 const access=await createAccess('','Export journal recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const journal=await f.service.get(plan.id),node='.observanda/materials/sequences/local-export-nodes/'+journal.changes.root.hash+'.json',original=await f.workspace.readMetadata(node,262144);
 await f.workspace.withLock(()=>f.workspace.writeMetadata(node,'{}'));
 try{await assert.rejects(encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'damaged-restore')),access,vault,f.vault),{code:'LOCAL_EXPORT_DAMAGED'});}
 finally{await f.workspace.withLock(()=>f.workspace.writeMetadata(node,original));}
 // Historical destination paths remain readable in a portable backup even
 // when that external directory belongs to another platform and is absent.
 for(const directory of ['C:\\External archive\\Website','/Volumes/External archive/Website'])await f.workspace.withLock(()=>f.workspace.writeMetadata('.observanda/local-exports/owners/'+digest(directory)+'.json',serialize({version:2,directory,files:{version:1,type:'files',root:null},pending:null})));
 const root=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'restored')),access,vault,f.vault),restored=new LocalExport(new Workspace(root,vault));
 assert.equal((await restored.current({reviewId:candidate.reviewId})).plan.id,plan.id);assert.equal((await apply(restored,plan.id)).cleaned,true);await verifyOutput(candidate,f.destination);
 const next=await restored.plan({reviewId:candidate.reviewId,directory:f.destination});assert.equal(next.counts.unchanged,candidate.files.size);assert.equal(next.counts.conflict,0);
});

test('independent websites retain isolated export reviews and cannot adopt each other\'s output files',async t=>{
 const f=await fixture(t),sites=new WebsiteSites(f.workspace),initial=await f.workspace.read(),record=initial.book.entries[0],projectId=initial.book.notebooks.find(n=>n.id===record.notebookId).projectId,ids=[];
 for(const name of ['Project journal','Project guide']){
  const created=await sites.change({workspaceId:initial.book.id,etag:(await f.workspace.outline()).etag,operation:'create',name,projectId}),current=await sites.read(created.id);ids.push(created.id);
  await sites.save(created.id,{workspaceId:initial.book.id,baseEtag:current.etag,metadata:{},projects:[],changes:[],removed:[],selection:{defaultShare:false,includeProjects:[],records:[{id:record.id,share:true,attachments:[]}]}});
 }
 const [a,b]=ids.map(id=>websiteWorkspace(f.workspace,id)),etag=(await f.workspace.outline()).etag,first=await new PublicationJobs(a).inline({etag}),second=await new PublicationJobs(b).inline({etag}),sa=new LocalExport(a),sb=new LocalExport(b);
 const plan=await sa.plan({reviewId:first.reviewId,directory:f.destination});await assert.rejects(sb.get(plan.id),{code:'NOT_FOUND'});await apply(sa,plan.id);
 const collision=await sb.plan({reviewId:second.reviewId,directory:f.destination});assert.ok(collision.counts.conflict>0);await assert.rejects(apply(sb,collision.id),{code:'LOCAL_EXPORT_CHANGED'});
 const other=path.join(f.directory,'second-website');await mkdir(other);await apply(sb,(await sb.plan({reviewId:second.reviewId,directory:other})).id);
 await verifyOutput(first,f.destination);await verifyOutput(second,other);assert.equal((await f.service.current({reviewId:first.reviewId})).plan,null);await verifyPublicationStorage(f.workspace);
});

test('reviewed root and nested exports preserve unrelated bytes, sync only owned files and carry no private paths',async t=>{
 const f=await fixture(t),plan=await planFor(f);assert.equal(plan.counts.conflict,0);assert.equal(plan.counts.added,f.first.files.size);
 await assert.rejects(f.service.apply({id:plan.id}),{code:'LOCAL_EXPORT_REVIEW'});
 f.workspace.read=()=>{throw Error('Local export loaded the whole workspace');};
 assert.equal((await apply(f.service,plan.id)).state,'completed');await verifyOutput(f.first,f.destination);
 assert.equal((await apply(new LocalExport(f.workspace),plan.id)).id,plan.id,'lost reply is idempotent');
 delete f.workspace.read;const next=await revised(f),update=await planFor(f,next);assert.ok(update.counts.replaced>0);assert.ok(update.counts.removed>0);
 const changes=(await f.service.page({id:update.id})).files;assert.ok(changes.every(c=>!c.path.startsWith('.git')&&!c.path.includes('manual.html')));
 await apply(f.service,update.id);await verifyOutput(next,f.destination);
 for(const name of f.first.files.keys())if(!next.files.has(name))await assert.rejects(readFile(path.join(f.destination,name)),{code:'ENOENT'});
 assert.equal(await readFile(path.join(f.destination,'manual.html'),'utf8'),'An unrelated page');assert.equal(await readFile(path.join(f.destination,'.git','HEAD'),'utf8'),'Unrelated repository history');
 const nested=path.join(f.destination,'lab');await mkdir(nested);await apply(f.service,(await planFor(f,next,nested)).id);await verifyOutput(next,nested);
 const names=await readdir(f.destination,{recursive:true});assert.ok(!names.some(n=>n.startsWith('.observanda-')));
 for(const content of next.files.values()){const bytes=await contentBuffer(content);for(const value of ['PRIVATE_UNRELEASED_COMPONENT',f.workspace.root,f.destination])assert.equal(bytes.includes(Buffer.from(value)),false);}
});

test('unowned collisions, manual edits, deletions and stale source block writes without adopting outside files',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.destination,'index.html'),'Existing homepage');
 let plan=await planFor(f);assert.ok(plan.counts.conflict);await assert.rejects(apply(f.service,plan.id),{code:'LOCAL_EXPORT_CHANGED'});assert.equal(await readFile(path.join(f.destination,'index.html'),'utf8'),'Existing homepage');
 await unlink(path.join(f.destination,'index.html'));plan=await planFor(f);await apply(f.service,plan.id);
 const next=await revised(f);plan=await planFor(f,next);const stylesheet=path.join(f.destination,'styles.css');await writeFile(stylesheet,'Manual edit after review');
 await assert.rejects(apply(f.service,plan.id),{code:'LOCAL_EXPORT_CHANGED'});assert.equal(await readFile(stylesheet,'utf8'),'Manual edit after review');
 await writeFile(stylesheet,await contentBuffer(f.first.files.get('styles.css')));await unlink(path.join(f.destination,'index.html'));assert.ok((await planFor(f,next)).counts.conflict);
 await writeFile(path.join(f.destination,'index.html'),await contentBuffer(f.first.files.get('index.html')));plan=await planFor(f,next);await revised(f);await assert.rejects(apply(f.service,plan.id),{code:'PUBLISH_STALE'});
});

for(const phase of ['staged','ready','moved','installed','verified','committed'])test('interrupted '+phase+' resumes the pinned edition with durable receipts',async t=>{
 const f=await fixture(t);await apply(f.service,(await planFor(f)).id);const next=await revised(f),plan=await planFor(f,next);let stopped=false;
 const interrupted=new LocalExport(f.workspace,{checkpoint:async stage=>{if(stage===phase&&!stopped){stopped=true;throw Object.assign(Error('Interrupted'),{code:'INTERRUPTED'});}}});
 await assert.rejects(apply(interrupted,plan.id),{code:'INTERRUPTED'});assert.ok(stopped);
 const restarted=new LocalExport(f.workspace),pending=(await restarted.current({reviewId:next.reviewId})).plan;assert.equal(pending.id,plan.id);
 // Changes made after admission do not silently change a resumed edition.
 const newer=await revised(f);const resumedPlan=await restarted.plan({reviewId:newer.reviewId,directory:f.destination});assert.equal(resumedPlan.id,plan.id);
 assert.equal((await apply(restarted,plan.id)).cleaned,true);await verifyOutput(next,f.destination);
 assert.equal((await apply(restarted,plan.id)).completedAt,(await restarted.current({reviewId:next.reviewId})).plan.completedAt);
 assert.ok(!(await readdir(f.destination,{recursive:true})).some(n=>path.basename(n).startsWith('.observanda-')));
});

test('partly staged writes can be discarded; switched output requires recovery and concurrent writers are excluded',async t=>{
 const f=await fixture(t),plan=await planFor(f);let release,entered;const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const service=new LocalExport(f.workspace,{checkpoint:async stage=>{if(stage==='staged'){entered();await gate;throw Object.assign(Error('Disk full'),{code:'ENOSPC'});}}});
 const running=assert.rejects(apply(service,plan.id),{code:'STORAGE_FULL'});await waiting;
 await assert.rejects(apply(f.service,plan.id),{code:'LOCKED'});release();await running;
 assert.equal((await f.service.discard({id:plan.id})).state,'discarded');await assert.rejects(readFile(path.join(f.destination,'index.html')),{code:'ENOENT'});
 assert.ok(!(await readdir(f.destination,{recursive:true})).some(n=>path.basename(n).startsWith('.observanda-')));
 const nextPlan=await planFor(f),switcher=new LocalExport(f.workspace,{checkpoint:async stage=>{if(stage==='installed')throw Error('Stop after installation');}});
 await assert.rejects(apply(switcher,nextPlan.id));await assert.rejects(f.service.discard({id:nextPlan.id}),{code:'LOCAL_EXPORT_RECOVER'});await apply(f.service,nextPlan.id);await verifyOutput(f.first,f.destination);
});

test('recovery rejects edits to installed files and preserves both the manual edit and retained originals',async t=>{
 const f=await fixture(t);await apply(f.service,(await planFor(f)).id);const next=await revised(f),plan=await planFor(f,next);
 const interrupted=new LocalExport(f.workspace,{checkpoint:async(stage,name)=>{if(stage==='installed'&&name==='index.html')throw Error('Stop');}});
 await assert.rejects(apply(interrupted,plan.id));const homepage=path.join(f.destination,'index.html');await writeFile(homepage,'Manual change during interruption');
 await assert.rejects(apply(f.service,plan.id),{code:'LOCAL_EXPORT_CHANGED'});assert.equal(await readFile(homepage,'utf8'),'Manual change during interruption');
 assert.deepEqual(await readFile(temporary(homepage,plan.id,'old')),await contentBuffer(f.first.files.get('index.html')));
});

test('paths, links and non-regular destinations cannot redirect an export',async t=>{
 const f=await fixture(t);for(const name of ['../secret','/index.html','assets/../../x','C:/x','.git/HEAD','a\\b','a:stream','a/CON.txt','a./b'])assert.throws(()=>outputName(name),{code:'UNSAFE'});
 await assert.rejects(planFor(f,f.first,f.workspace.root),{code:'UNSAFE'});await assert.rejects(planFor(f,f.first,f.directory),{code:'UNSAFE'});
 const external=path.join(f.directory,'outside');await mkdir(external);await writeFile(path.join(external,'private.txt'),'Original');
 const junction=path.join(f.destination,'projects');await symlink(external,junction,process.platform==='win32'?'junction':'dir');await assert.rejects(planFor(f),{code:'UNSAFE'});await unlink(junction);
 await link(path.join(external,'private.txt'),path.join(f.destination,'index.html'));await assert.rejects(planFor(f),{code:'UNSAFE'});assert.equal(await readFile(path.join(external,'private.txt'),'utf8'),'Original');
});

test('a concurrent identical file is still unowned; a moved concurrent edit is returned without overwriting it',async t=>{
 const f=await fixture(t),plan=await planFor(f),homepage=path.join(f.destination,'index.html');
 const collision=new LocalExport(f.workspace,{checkpoint:async stage=>{if(stage==='ready')await writeFile(homepage,await contentBuffer(f.first.files.get('index.html')));}});
 await assert.rejects(apply(collision,plan.id),{code:'LOCAL_EXPORT_CHANGED'});await assert.rejects(apply(f.service,plan.id),{code:'LOCAL_EXPORT_CHANGED'});
 await unlink(homepage);await apply(f.service,plan.id);const next=await revised(f),update=await planFor(f,next);
 const racing=new LocalExport(f.workspace,{checkpoint:async(stage,name)=>{if(stage==='moved'&&name==='index.html')await writeFile(temporary(homepage,update.id,'old'),'Concurrent manual original');}});
 await assert.rejects(apply(racing,update.id),{code:'LOCAL_EXPORT_CHANGED'});assert.equal(await readFile(homepage,'utf8'),'Concurrent manual original');
});
