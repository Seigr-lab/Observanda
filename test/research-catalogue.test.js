import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {initializeLocation,copyPlan,copyWorkspace,encryptedCopy,workspaceManifest} from '../src/locations.js';
import {Workspace,workspaceFile} from '../src/storage.js';
import {CATALOGUE_FILE,openCatalogue} from '../src/research-catalogue.js';
import {upgradeNotebook} from '../src/model.js';
import {applyRecordPatch} from '../src/web/record-patch.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {sampleNotebook} from '../src/sample.js';
import {createRun} from '../src/web/record-workflow.js';
import {clearVault,unseal} from '../src/encryption.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {RecordHistory} from '../src/record-history.js';

async function fixture(t,{legacy=false}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-catalogue-')),source=path.join(root,'source');
 const access=await createAccess('','synthetic catalogue password'),vault=takeCreatedVault(access),book=legacy?sampleNotebook():upgradeNotebook(sampleNotebook());
 book.entries[0].title='PRIVATE CATALOGUE SENTINEL';
 book.entries[0].attachments=[];
 await initializeLocation(source,book,access,vault);
 const ws=new Workspace(source,vault);
 let saved=await ws.read();saved.book.entries[0].title='PRIVATE REVISED SENTINEL';await ws.save(saved.book,saved.etag);
 const before=await workspaceManifest(source),destination=path.join(root,'copy');
 await copyWorkspace(await copyPlan(source,destination),{vault});
 t.after(async()=>{clearVault(vault);await rm(root,{recursive:true,force:true});});
 return {root,source,ws:new Workspace(destination,vault),sourceWorkspace:ws,vault,before};
}

test('new encrypted workspaces start with transactional records and backups preserve their history',async t=>{
 const f=await fixture(t),actual=await f.ws.read(),original=await f.sourceWorkspace.read();
 assert.deepEqual(actual,original);
 assert.equal(await f.ws.storageKind(),'catalogue');
 assert.deepEqual(await workspaceManifest(f.source),f.before);
 assert.deepEqual(await f.ws.history(),await f.sourceWorkspace.history());
 for(const version of await f.sourceWorkspace.history())assert.deepEqual(await f.ws.readRevision(version.id),await f.sourceWorkspace.readRevision(version.id));
 const raw=await readFile(path.join(f.ws.root,CATALOGUE_FILE));
 assert.ok(!raw.includes(Buffer.from('PRIVATE')));
 assert.ok(!raw.includes(Buffer.from(original.book.title)));
 await assert.rejects(new Workspace(f.ws.root).read(),{code:'ACCESS_LOCKED'});
});

test('save changes only the modified encrypted record; stale writes and failed batches roll back',async t=>{
 const {ws}=await fixture(t),first=await ws.read(),id=first.book.entries[0].id,other=first.book.entries[1].id;
 const db=await ws.openCatalogue();
 const prior=Buffer.from((await db.get('SELECT payload FROM records WHERE id=$1',other)).payload);await db.close();
 first.book.entries[0].title='New interpretation';const second=await ws.save(first.book,first.etag);
 assert.equal(second.book.entries[0].title,'New interpretation');
 await assert.rejects(ws.save(first.book,first.etag),{code:'CONFLICT'});
 const reopened=await ws.openCatalogue();
 assert.deepEqual(Buffer.from((await reopened.get('SELECT payload FROM records WHERE id=$1',other)).payload),prior);
 const count=(await reopened.get('SELECT COUNT(*) AS n FROM snapshots')).n;await reopened.close();
 await assert.rejects(ws.withLock(async()=>{
   await ws.catalogue(store=>store.put({...second.book,revision:second.book.revision+1}));
   throw new Error('Synthetic interruption');
 }),/Synthetic interruption/);
 assert.equal((await ws.read()).etag,second.etag);
 const db2=await ws.openCatalogue();assert.equal((await db2.get('SELECT COUNT(*) AS n FROM snapshots')).n,count);await db2.close();
 const history=await new RecordHistory(ws,{get:()=>{throw Error('unused');}}).list({workspaceId:second.book.id,recordId:id});
 assert.ok(history.versions.some(v=>v.title==='PRIVATE CATALOGUE SENTINEL'));
});

test('verified backups and fresh-key successors preserve catalogue revisions',async t=>{
 const {ws,root,vault}=await fixture(t),original=await ws.read();
 const backup=await copyWorkspace(await copyPlan(ws.root,path.join(root,'backup')));
 const backupVault=await verifyAccess(await readAccess(backup),'','synthetic catalogue password');
 const access=await createAccess('','new synthetic catalogue password'),nextVault=takeCreatedVault(access);
 try{
  assert.deepEqual(await new Workspace(backup,backupVault).read(),original);
  const successor=await encryptedCopy(await copyPlan(ws.root,path.join(root,'successor')),access,nextVault,vault);
  const next=new Workspace(successor,nextVault);
  assert.deepEqual(await next.read(),original);
  assert.deepEqual(await next.history(),await ws.history());
  await assert.rejects(new Workspace(successor,vault).read(),{code:'ENCRYPTION_DAMAGED'});
 }finally{clearVault(backupVault);clearVault(nextVault);}
});

test('transactions isolate concurrent callers and keep record data on a failed save',async t=>{
 const {ws}=await fixture(t);
 let release,entered;
 const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const pending=ws.withLock(async()=>{entered();await gate;});
 await ready;
 const independent=new Workspace(ws.root,ws.vault);
 try{await assert.rejects(independent.withLock(async()=>{}),{code:'LOCKED'});}
 finally{release();await pending;}
 const before=await ws.read(),record={...before.book.entries[0],title:'Attempted overwrite'};
 const records=new ResearchRecords(ws,{get:async()=>{throw Error('Synthetic missing evidence');}});
 record.attachments=[{id:before.book.entries[1].id,kind:'image',caption:'',alt:'',transcript:'',share:false}];
 await assert.rejects(records.save({workspaceId:before.book.id,changes:[{id:record.id,expectedRevision:recordRevision(before.book.entries[0]),record}]}));
 assert.deepEqual(await ws.read(),before);
});

test('swapped encrypted record payload fails closed without rewriting evidence',async t=>{
 const {ws}=await fixture(t),db=await ws.openCatalogue();
 const rows=(await db.all('SELECT id,revision,payload FROM records'));
 (await db.run('UPDATE records SET payload=$1 WHERE id=$2 AND revision=$3',rows[1].payload,rows[0].id,rows[0].revision));await db.close();
 await assert.rejects(ws.catalogue(store=>store.record(rows[0].id,rows[0].revision)),{code:'ENCRYPTION_DAMAGED'});
});

test('ordinary record commands and history load only selected content; patches include concurrent edits',async t=>{
 const {ws}=await fixture(t),base=await ws.read(),a=base.book.entries[0],b=base.book.entries[1];
 const service=new ResearchRecords(ws,{get:async()=>{throw Error('Unexpected evidence');}});
 const change=record=>({id:record.id,expectedRevision:recordRevision(record.id===a.id?a:b),record});
 const originalRead=ResearchCatalogue.prototype.read;
 ResearchCatalogue.prototype.read=()=>{throw Error('Full workspace read during an incremental operation');};
 let first,second;
 try{
  first=await service.save({workspaceId:base.book.id,baseEtag:base.etag,changes:[change({...a,title:'First concurrent change'})]},{compact:true});
  second=await service.save({workspaceId:base.book.id,baseEtag:base.etag,changes:[change({...b,title:'Second concurrent change'})]},{compact:true});
  assert.equal(second.recordPatch.records.length,2);
  const history=await new RecordHistory(ws,{}).list({workspaceId:base.book.id,recordId:a.id});
  assert.equal(history.versions[0].title,'First concurrent change');
 }finally{ResearchCatalogue.prototype.read=originalRead;}
 const patched=applyRecordPatch(base.book,base.etag,Object.fromEntries(base.book.entries.map(r=>[r.id,recordRevision(r)])),second);
 assert.deepEqual(patched.book,(await ws.read()).book);
 assert.equal(patched.book.entries[0].title,'First concurrent change');
 assert.equal(first.recordPatch.records.length,1);
 await assert.rejects(service.save({workspaceId:base.book.id,baseEtag:base.etag,changes:[change({...a,title:'Stale draft'})]},{compact:true}),{code:'RECORD_CHANGED'});
});

test('incremental validation preserves global IDs and run relationships across untouched records',async t=>{
 const {ws}=await fixture(t),base=await ws.read(),a=base.book.entries[0],b=base.book.entries[1];
 const service=new ResearchRecords(ws,{get:async()=>{}});
 const record={...a,title:'Invalid duplicate section',sections:[{id:b.id,title:'Collision',body:''}]};
 await assert.rejects(service.save({workspaceId:base.book.id,baseEtag:base.etag,changes:[{id:a.id,expectedRevision:recordRevision(a),record}]},{compact:true}),{code:'INVALID'});
 assert.equal((await ws.read()).etag,base.etag);
 const {randomUUID}=await import('node:crypto');
 base.book.entries.push(createRun(base.book,a,{uuid:randomUUID}));
 const withRun=await ws.save(base.book,base.etag),parent=withRun.book.entries.find(r=>r.id===a.id);
 // The unchanged child still references this investigation. Its parent cannot
 // become another run through a command that loads only the parent body.
 await assert.rejects(service.save({workspaceId:base.book.id,baseEtag:withRun.etag,changes:[{id:parent.id,expectedRevision:recordRevision(parent),record:{...parent,type:'run'}}]},{compact:true}),{code:'INVALID'});
 assert.equal((await ws.read()).etag,withRun.etag);
});

test('missing catalogue is a damaged workspace, never an empty workspace',async t=>{
 const {ws}=await fixture(t);await ws.read();
 await rm(path.join(ws.root,CATALOGUE_FILE));
 await assert.rejects(ws.read(),{code:'CATALOGUE_DAMAGED'});
});

test('process termination during an uncommitted write recovers the last durable snapshot',async t=>{
 const {spawn}=await import('node:child_process');
 const {ws}=await fixture(t),before=await ws.read();
 const script=[
  "import {Workspace} from './src/storage.js';",
  "const ws=new Workspace("+JSON.stringify(ws.root)+",{id:"+JSON.stringify(ws.vault.id)+",key:Buffer.from("+JSON.stringify(ws.vault.key.toString('base64'))+",'base64')});",
  "await ws.withLock(async()=>{await ws.catalogue(async store=>{const next=(await store.read()).book; next.revision++; next.entries[0].title='Uncommitted child content';await store.put(next);});process.stdout.write('ready');await new Promise(()=>{});});"
 ].join('\n');
 const child=spawn(process.execPath,['--input-type=module','-'],{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});
 let errors='';child.stderr.on('data',chunk=>errors+=chunk);
 const exited=new Promise(resolve=>child.once('exit',resolve));
 try{
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Child did not reach transaction: '+errors)),10000);
   child.once('error',reject);
   child.once('exit',()=>{clearTimeout(timer);reject(Error('Child exited before interruption: '+errors));});
   child.stdout.once('data',()=>{clearTimeout(timer);resolve();});
   child.stdin.end(script);
  });
  child.kill('SIGKILL');await exited;
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
 assert.deepEqual(await ws.read(),before);
 const next=structuredClone(before.book);next.entries[0].title='Saved after restart';
 assert.equal((await ws.save(next,before.etag)).book.entries[0].title,'Saved after restart');
});

test('lab books have independent record encryption keys; workspace wrapping keys are never interchangeable',async t=>{
 const {ws}=await fixture(t),current=await ws.read();
 const {randomUUID}=await import('node:crypto');
 const first=current.book.entries[0],second=current.book.entries[1],labId=randomUUID();
 current.book.notebooks.push({id:labId,projectId:current.book.projects[0].id,title:'Independent creative sessions'});
 second.notebookId=labId;
 await ws.save(current.book,current.etag);
 await ws.catalogue(async store=>{
  const a=await store.scopeKey(first.notebookId),b=await store.scopeKey(second.notebookId);
  try{
   assert.ok(!a.equals(b));assert.ok(!a.equals(ws.vault.key));assert.ok(!b.equals(ws.vault.key));
   const row=(await store.db.get('SELECT * FROM records WHERE id=$1 AND scope_id=$2',second.id,second.notebookId));
   const aad=store.recordAAD(row.id,row.revision,row.scope_id,row.generation);
   assert.throws(()=>unseal(Buffer.from(row.payload),a,aad),{code:'ENCRYPTION_DAMAGED'});
   assert.throws(()=>unseal(Buffer.from(row.payload),ws.vault.key,aad),{code:'ENCRYPTION_DAMAGED'});
   assert.equal(JSON.parse(unseal(Buffer.from(row.payload),b,aad)).id,second.id);
  }finally{a.fill(0);b.fill(0);}
 });
});

test('authenticated history index rejects removal instead of hiding saved revisions',async t=>{
 const {ws}=await fixture(t),current=await ws.read(),id=current.book.entries[0].id;
 const db=await ws.openCatalogue();
 (await db.run('DELETE FROM state WHERE slot=$1','history:'+id));await db.close();
 await assert.rejects(new RecordHistory(ws,{}).list({workspaceId:current.book.id,recordId:id}),{code:'CATALOGUE_DAMAGED'});
 current.book.entries[0].title='Must not repair missing history by forgetting it';
 await assert.rejects(ws.save(current.book,current.etag),{code:'CATALOGUE_DAMAGED'});
 assert.equal((await ws.read()).etag,current.etag);
});

test('catalogue backups and fresh-key copies retain a 64 MiB streamed original byte for byte',async t=>{
 const {Readable}=await import('node:stream');
 const {writeContent,describeContent}=await import('../src/file-content.js');
 const {createHash}=await import('node:crypto');
 const {ws,root,vault}=await fixture(t),file=path.join(ws.root,'.observanda','synthetic-original.bin');
 const chunk=Buffer.alloc(1024*1024,197),hash=createHash('sha256');
 async function* input(){for(let i=0;i<64;i++){hash.update(chunk);yield chunk;}}
 const original=await writeContent(ws,file,Readable.from(input()));
 assert.equal(original.size,64*1024*1024);
 assert.equal(original.sha256,hash.digest('hex'));
 const backup=await copyWorkspace(await copyPlan(ws.root,path.join(root,'large-backup')));
 const copied=await describeContent(new Workspace(backup,vault),path.join(backup,'.observanda','synthetic-original.bin'));
 assert.equal(copied.sha256,original.sha256);assert.equal(copied.size,original.size);
 const access=await createAccess('','large successor password'),newVault=takeCreatedVault(access);
 try{
  const successor=await encryptedCopy(await copyPlan(ws.root,path.join(root,'large-successor')),access,newVault,vault);
  const restored=await describeContent(new Workspace(successor,newVault),path.join(successor,'.observanda','synthetic-original.bin'));
  assert.equal(restored.sha256,original.sha256);assert.equal(restored.size,original.size);
 }finally{clearVault(newVault);}
});

test('legacy record shapes retain their exact bytes and upgrade consistently in record history',async t=>{
 const {ws,sourceWorkspace}=await fixture(t,{legacy:true}),original=await sourceWorkspace.read(),before=await ws.read();
 assert.deepEqual(before,original);
 const command={workspaceId:original.book.id,recordId:original.book.entries[0].id};
 const a=await new RecordHistory(ws,{}).list(command),b=await new RecordHistory(sourceWorkspace,{}).list(command);
 const {cursor:cursorA,...pageA}=a,{cursor:cursorB,...pageB}=b;
 assert.deepEqual(pageA,pageB);assert.notEqual(cursorA,cursorB); // Encrypted cursors have fresh nonces.
 assert.deepEqual((await new RecordHistory(sourceWorkspace,{}).list({...command,cursor:cursorA})).versions,a.versions);
 const selected=a.versions.at(-1);
 assert.deepEqual(await new RecordHistory(ws,{}).read({...command,...selected}),await new RecordHistory(sourceWorkspace,{}).read({...command,...selected}));
});

test('failed verification leaves the destination incomplete and source available',async t=>{
 const {root,sourceWorkspace,vault,source}=await fixture(t),before=await workspaceManifest(source),original=ResearchCatalogue.prototype.verify;
 const access=await createAccess('','synthetic failed fresh-key copy'),freshVault=takeCreatedVault(access);t.after(()=>clearVault(freshVault));
 ResearchCatalogue.prototype.verify=()=>{throw Error('Synthetic verification failure');};
 try{for(const fresh of [false,true]){
  const destination=path.join(root,fresh?'failed-fresh-key':'failed-backup'),plan=await copyPlan(source,destination);
  await assert.rejects(fresh?encryptedCopy(plan,access,freshVault,vault):copyWorkspace(plan,{vault}),/Synthetic verification failure/);
  await assert.rejects(new Workspace(destination,fresh?freshVault:vault).read(),{code:'STORAGE_INCOMPLETE'});
 }}
 finally{ResearchCatalogue.prototype.verify=original;}
 assert.deepEqual(await workspaceManifest(source),before);
 assert.equal((await sourceWorkspace.read()).book.entries[0].title,'PRIVATE REVISED SENTINEL');
});

test('fresh-key copying verifies the copied descriptor before activating its destination',async t=>{
 const {root,sourceWorkspace,vault,source}=await fixture(t),file=await workspaceFile(source),original=await sourceWorkspace.readFile(file,'utf8');
 const descriptor=JSON.parse(original);descriptor.workspaceId='00000000-0000-4000-8000-000000000001';
 await sourceWorkspace.writeFile(file,JSON.stringify(descriptor));
 const before=await workspaceManifest(source),destination=path.join(root,'wrong-descriptor');
 const access=await createAccess('','synthetic descriptor recovery'),freshVault=takeCreatedVault(access);t.after(()=>clearVault(freshVault));
 await assert.rejects(encryptedCopy(await copyPlan(source,destination),access,freshVault,vault),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(new Workspace(destination,freshVault).read(),{code:'STORAGE_INCOMPLETE'});
 assert.deepEqual(await workspaceManifest(source),before);
 await sourceWorkspace.writeFile(file,original);
 assert.equal((await sourceWorkspace.read()).book.entries[0].title,'PRIVATE REVISED SENTINEL');
});

test('initializing transactional storage cannot overwrite an existing workspace',async t=>{
 const {sourceWorkspace,source,before}=await fixture(t);
 await assert.rejects(sourceWorkspace.initializeResearch(upgradeNotebook(sampleNotebook())),{code:'EXISTS'});
 assert.deepEqual(await workspaceManifest(source),before);
 assert.equal(await sourceWorkspace.storageKind(),'catalogue');
});

test('failed creation is never exposed as a usable workspace',async t=>{
 const {root,vault}=await fixture(t),destination=path.join(root,'failed-creation');
 const access=await readAccess(path.join(root,'source')),original=ResearchCatalogue.prototype.verify;
 ResearchCatalogue.prototype.verify=()=>{throw Error('Synthetic initialization failure');};
 try{await assert.rejects(initializeLocation(destination,upgradeNotebook(sampleNotebook()),access.value,vault),/Synthetic initialization failure/);}
 finally{ResearchCatalogue.prototype.verify=original;}
 await assert.rejects(new Workspace(destination,vault).read(),{code:'STORAGE_INCOMPLETE'});
 const {inspectLocation}=await import('../src/locations.js');
 await assert.rejects(inspectLocation(destination),{code:'STORAGE_INCOMPLETE'});
});

test('storage detection rejects oversized or malformed workspace documents before command processing',async t=>{
 const {writeFile}=await import('node:fs/promises');
 const {MAX_BYTES}=await import('../src/model.js');
 const {root}=await fixture(t),plain=path.join(root,'invalid');
 const {mkdir}=await import('node:fs/promises');
 await mkdir(plain);
 const file=path.join(plain,'observanda.json'),workspace=new Workspace(plain);
 await writeFile(file,Buffer.alloc(MAX_BYTES+100,32));
 await assert.rejects(workspace.storageKind(),{code:'LIMIT'});
 await writeFile(file,'broken json');
 await assert.rejects(workspace.storageKind(),{code:'FORMAT'});
});
