import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {Workspace} from '../src/storage.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {initializeLocation,copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {sampleNotebook} from '../src/sample.js';
import {MediaImports} from '../src/media-imports.js';
import {MediaStore} from '../src/media.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {contentBuffer} from '../src/file-content.js';
import {AppError} from '../src/errors.js';
import {buildPublication} from '../src/publication.js';
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><!-- private original note --><circle cx="16" cy="16" r="12" fill="teal"/></svg>');
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-media-jobs-')),root=path.join(directory,'workspace'),access=await createAccess('','media test password'),vault=takeCreatedVault(access);
 await initializeLocation(root,sampleNotebook(),access,vault);const workspace=new Workspace(root,vault),imports=new MediaImports(workspace),jobs=workspaceJobs(workspace);
 t.after(async()=>{await jobs.worker.stop();clearVault(vault);await rm(directory,{recursive:true,force:true});});
 return {directory,root,vault,workspace,imports,...jobs};
}
async function uploaded(f,bytes=svg){
 const s=await f.imports.start({name:'private-study.svg',size:bytes.length,kind:'image'});await f.imports.receive(s.id,[bytes]);
 const intent={id:s.id,type:'media.prepare',scope:s.workspaceId,input:{importId:s.id,size:s.size}};
 return {s,job:await f.queue.enqueue(intent),intent};
}
async function finished(queue,id){for(let n=0;n<400;n++){const j=await queue.read(id);if(['failed','completed','cancelled'].includes(j.state))return j;await delay(25);}assert.fail('Media job did not finish');}

test('conversion publishes a prepared copy atomically while originals and private names stay out of publication',async t=>{
 const f=await fixture(t),u=await uploaded(f);f.worker.start();const done=await finished(f.queue,u.s.id);await f.worker.stop();assert.equal(done.state,'completed');
 const original=await f.imports.original(u.s.id);assert.deepEqual(await contentBuffer(original.content),svg);
 const encrypted=await readFile(original.content.file);assert.ok(!encrypted.includes(svg));
 const media=new MediaStore(f.root,f.vault),copy=await media.get(u.s.id);assert.equal(copy.mime,'image/png');assert.notDeepEqual(copy.bytes,svg);
 const book=(await f.workspace.read()).book;book.entries[0].attachments=[{id:u.s.id,kind:'image',caption:'Public study',alt:'Teal circle',share:true,transcript:''}];
 const candidate=buildPublication(book,{mediaFiles:await media.publicFiles(book)});
 const all=Buffer.concat([...candidate.files.values()].map(v=>Buffer.from(v)));assert.ok(!all.includes('private-study.svg'));assert.ok(!all.includes('private original note'));assert.ok(!all.includes(f.root));
 assert.deepEqual((await f.queue.enqueue(u.intent)).result,done.result);assert.equal((await f.imports.list()).length,1);
});

test('failed conversion, interrupted receiving and invalid filenames retain an explicit recoverable import',async t=>{
 const f=await fixture(t),s=await f.imports.start({name:'study.svg',size:svg.length,kind:'image'});
 await assert.rejects(f.imports.receive(s.id,[svg.subarray(0,10)]),{code:'MATERIAL_INCOMPLETE'});assert.equal((await f.imports.read(s.id)).source,null);
 await f.imports.receive(s.id,[svg]);assert.deepEqual(await contentBuffer((await f.imports.original(s.id)).content),svg);
 for(const name of ['../private.svg','E:\\private.svg','bad\nname.svg'])await assert.rejects(f.imports.start({name,size:1,kind:'image'}),{code:'MEDIA_INVALID'});
 const bad=Buffer.from('<svg>malformed'),u=await uploaded(f,bad);f.worker.start();const failed=await finished(f.queue,u.s.id);await f.worker.stop();assert.equal(failed.state,'failed');
 assert.deepEqual(await contentBuffer((await f.imports.original(u.s.id)).content),bad);await assert.rejects(new MediaStore(f.root,f.vault).get(u.s.id));
});

test('cancel and retry, including after backup and rekey, reuse the retained original',async t=>{
 const f=await fixture(t),u=await uploaded(f),definition=f.queue.definitions['media.prepare'],prepare=definition.prepare;let entered;
 const ready=new Promise(resolve=>entered=resolve);definition.prepare=async(job,options)=>{entered();await delay(30000,null,{signal:options.signal});return prepare(job,options);};
 f.worker.start();await ready;await f.queue.control(u.s.id,'cancel');f.worker.cancel(u.s.id);assert.equal((await finished(f.queue,u.s.id)).state,'cancelled');await f.worker.stop();
 assert.deepEqual(await contentBuffer((await f.imports.original(u.s.id)).content),svg);
 const access=await createAccess('','new media password'),key=takeCreatedVault(access);t.after(()=>clearVault(key));
 const copy=await encryptedCopy(await copyPlan(f.root,path.join(f.directory,'restored')),access,key,f.vault),workspace=new Workspace(copy,key),other=workspaceJobs(workspace);
 await other.queue.control(u.s.id,'retry');other.worker.start();let done;try{done=await finished(other.queue,u.s.id);}finally{await other.worker.stop();}assert.equal(done.state,'completed');assert.equal(done.attempt,2);
 const backup=await copyWorkspace(await copyPlan(copy,path.join(f.directory,'backup')),{vault:key});
 assert.deepEqual(await contentBuffer((await new MediaImports(new Workspace(backup,key)).original(u.s.id)).content),svg);
 assert.deepEqual((await new MediaStore(copy,key).get(u.s.id)).bytes,(await new MediaStore(backup,key).get(u.s.id)).bytes);
});

test('expired workers and rolled-back commits cannot replace media; a new lease completes exactly once',async t=>{
 const f=await fixture(t),u=await uploaded(f),first=await f.queue.claim(),stale=await f.queue.definition(first).prepare(first,{});
 await f.workspace.withLock(async()=>{const j=await f.queue.read(first.id);j.lease.until=0;await f.queue.write(j);});
 const other=workspaceJobs(new Workspace(f.root,f.vault)),next=await other.queue.claim();await assert.rejects(f.queue.complete(first.id,first.lease.token,stale),{code:'JOB_LEASE'});
 const prepared=await other.queue.definition(next).prepare(next,{}),commit=other.queue.definitions['media.prepare'].commit;
 other.queue.definitions['media.prepare'].commit=async(...args)=>{await commit(...args);throw new AppError('STORAGE_FULL');};
 await assert.rejects(other.queue.complete(next.id,next.lease.token,prepared),{code:'STORAGE_FULL'});
 assert.equal(await f.workspace.readMetadata('.observanda/media-assets/'+next.id+'.json',4096),null);assert.equal((await other.queue.read(next.id)).state,'running');
 other.queue.definitions['media.prepare'].commit=commit;await other.queue.complete(next.id,next.lease.token,prepared);
 await f.queue.definition(first).discard(first);await other.queue.definition(next).discard(next);
 assert.equal((await new MediaStore(f.root,f.vault).get(next.id)).kind,'image');
 assert.deepEqual(await contentBuffer((await f.imports.original(next.id)).content),svg);
 const files=await readdir(path.join(f.root,'.observanda/media',next.id));assert.equal(files.filter(n=>n.includes('.public.')).length,1);assert.equal(files.filter(n=>n.endsWith('.original')).length,1);
});

test('received bytes survive a failed receipt commit and a killed upload can be restarted without staging debris',async t=>{
 const f=await fixture(t),s=await f.imports.start({name:'recovered.svg',size:svg.length,kind:'image'}),write=f.workspace.writeMetadata.bind(f.workspace);
 f.workspace.writeMetadata=async(...args)=>{if(args[0]===f.imports.file(s.id))throw new AppError('STORAGE_FULL');return write(...args);};
 await assert.rejects(f.imports.receive(s.id,[svg]),{code:'STORAGE_FULL'});f.workspace.writeMetadata=write;
 assert.equal((await f.imports.read(s.id)).source,null);assert.equal((await f.imports.list())[0].source.size,svg.length);
 assert.deepEqual(await contentBuffer((await f.imports.original(s.id)).content),svg);
 const interrupted=await f.imports.start({name:'restart.svg',size:svg.length,kind:'image'});
 const {spawn}=await import('node:child_process'),{once}=await import('node:events');
 const code=`import {Workspace} from './src/storage.js';import {MediaImports} from './src/media-imports.js';let raw='';for await(const c of process.stdin)raw+=c;const d=JSON.parse(raw),w=new Workspace(d.root,{id:d.vaultId,key:Buffer.from(d.key,'base64')});await new MediaImports(w).receive(d.id,(async function*(){yield Buffer.from('<svg');process.stdout.write('checkpoint');await new Promise(()=>{});})());`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:process.cwd(),stdio:['pipe','pipe','pipe'],windowsHide:true});t.after(()=>{if(child.exitCode===null)child.kill();});
 let errors='';child.stderr.on('data',c=>errors+=c);const exit=once(child,'exit'),ready=new Promise((resolve,reject)=>{child.stdout.on('data',()=>resolve());child.on('error',reject);child.on('exit',()=>reject(Error(errors)));});
 child.stdin.end(JSON.stringify({root:f.root,vaultId:f.vault.id,key:f.vault.key.toString('base64'),id:interrupted.id}));await ready;
 await assert.rejects(f.imports.receive(interrupted.id,[svg]),{code:'LOCKED'});child.kill();await exit;
 const directory=await f.imports.directory(interrupted.id);assert.ok((await readdir(directory)).some(n=>n.startsWith('.stream-')));
 for(let i=0;;i++)try{await f.imports.receive(interrupted.id,[svg]);break;}catch(error){if(error.code!=='LOCKED'||i>=40)throw error;await delay(50);}
 assert.deepEqual(await contentBuffer((await f.imports.original(interrupted.id)).content),svg);assert.ok(!(await readdir(directory)).some(n=>n.startsWith('.stream-')));
 const restored=await copyWorkspace(await copyPlan(f.root,path.join(f.directory,'after-interruption')),{vault:f.vault});
 assert.deepEqual(await contentBuffer((await new MediaImports(new Workspace(restored,f.vault)).original(interrupted.id)).content),svg);
});

test('browsing empty upload intents neither creates media directories nor acquires receive locks',async t=>{
 const f=await fixture(t),sessions=[];for(let i=0;i<23;i++)sessions.push(await f.imports.start({name:'study-'+i+'.svg',size:svg.length,kind:'image'}));
 f.imports.receiving=()=>{throw Error('No transfer to recover');};
 f.imports.workspace.listMetadata=()=>{throw Error('The index already exists');};
 const first=await f.imports.page();assert.equal(first.items.length,20);assert.equal(first.items[0].id,sessions.at(-1).id);assert.ok(first.next);
 const last=await f.imports.page({cursor:first.next});assert.equal(last.items.length,3);assert.equal(last.items.at(-1).id,sessions[0].id);assert.equal(last.next,null);
 const {stat}=await import('node:fs/promises');await assert.rejects(stat(path.join(f.workspace.root,'.observanda','media')),{code:'ENOENT'});
});
