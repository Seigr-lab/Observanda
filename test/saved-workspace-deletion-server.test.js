import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectCreation} from '../src/project-creation.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {startServer} from '../src/server.js';
import {Workspace,serialize} from '../src/storage.js';
import {createWorkspaceAccess,createAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {initializeLocation} from '../src/locations.js';
import {clearVault} from '../src/encryption.js';
import {TestDeviceStore} from './device-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {rememberLocation,readPreferences} from '../src/preferences.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {WorkspaceDeletions} from '../src/workspace-deletion.js';
import {workspaceDatabaseLease} from '../src/workspace-database-lease.js';
import {workspaceDeletion} from '../src/workspace-delete-state.js';

async function fixture(t,{owned=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-saved-delete-')),prefs=path.join(directory,'settings.json'),deviceStore=new TestDeviceStore({file:path.join(directory,'device.key')}),vaults=[];
 let owner,detach,app;
 if(owned){owner=new WorkspaceDatabases({directory:path.join(directory,'application'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});detach=installDatabaseProvider(owner);}
 t.after(async()=>{await app?.close();await owner?.close();detach?.();vaults.forEach(clearVault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const create=async(name,{password='',plain=false}={})=>{
  const book={...sampleNotebook(),id:randomUUID(),title:name},root=path.join(directory,name),access=plain?await createAccess():await createWorkspaceAccess('',password,deviceStore),vault=takeCreatedVault(access);vaults.push(vault);
  await initializeLocation(root,book,access,vault);await rememberLocation(prefs,root,{title:name,label:'Workspace'});return new Workspace(root,vault);
 };
 const active=await create('Keep open');
 const start=async()=>{
  await rememberLocation(prefs,active.root,{title:'Keep open',label:'Workspace'});
  app=await startServer({root:active.root,port:0,headless:true,preferencesFile:prefs,deviceStore});
  const client=async()=>{
   const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});
   assert.equal(session.status,200);const cookie=session.headers.get('set-cookie').split(';')[0];let context;
   const call=async(route,data)=>{
    const r=await fetch(app.origin+route,{signal:AbortSignal.timeout(60000),...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)}),headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json',...(context?{'X-Observanda-Workspace':context}:{})}});
    return {status:r.status,value:await r.json()};
   };
   context=(await call('/api/storage')).value.contextId;return {call,context};
  };
  return {...await client(),client,app};
 };
 return {directory,prefs,active,create,start,owner,deviceStore};
}
const command=plan=>({id:plan.id,path:plan.source,title:plan.title,confirmed:true});

for(const owned of [false,true])test('closed '+(owned?'dedicated':'shared-catalogue')+' workspace is deleted while the active writer is held',async t=>{
 const f=await fixture(t,{owned}),target=await f.create('Remove closed'),sibling=await f.create('Keep closed'),session=await f.start(),before=await f.active.read(),siblingBefore=await sibling.read();
 await writeFile(path.join(target.root,'.observanda','original-evidence.bin'),Buffer.alloc(5000,42));
 const local=await readFile(f.prefs),device=await readFile(path.join(f.directory,'device.key'));
 let release,entered;const held=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
 const writing=f.active.withLock(async()=>{entered();await hold;});await held;
 try{
  const review=await session.call('/api/workspaces/delete/preview',{path:target.root});assert.equal(review.status,200,JSON.stringify(review.value));assert.equal(review.value.database,owned?'workspace':'catalogue');
  if(owned)assert.equal(f.owner.instances.instances.has(target.root),false);
  const deleting=await session.call('/api/workspaces/delete/confirm',command(review.value));assert.equal(deleting.status,200,JSON.stringify(deleting.value));assert.equal(deleting.value.result.complete,true);
 }finally{release();await writing;}
 await assert.rejects(access(target.root),{code:'ENOENT'});assert.deepEqual(await f.active.read(),before);assert.deepEqual(await sibling.read(),siblingBefore);
 const now=(await session.call('/api/storage')).value;assert.equal(now.root,f.active.root);assert.equal(now.contextId,session.context);
 const saved=await readPreferences(f.prefs);assert.equal(saved.workspace,f.active.root);assert.deepEqual(saved.recent.map(r=>r.path),[f.active.root,sibling.root]);assert.notDeepEqual(await readFile(f.prefs),local);assert.deepEqual(await readFile(path.join(f.directory,'device.key')),device);
 assert.equal((await session.call('/api/workspaces')).value.workspaces.length,2);
});

test('selected owner requires its own credentials and a session-bound, current confirmation',async t=>{
 const f=await fixture(t),target=await f.create('Password protected',{password:'a-long-test-password'}),session=await f.start(),second=await session.client();
 assert.equal((await session.call('/api/workspaces/delete/preview',{path:target.root})).value.code,'DEVICE_UNKNOWN');
 assert.equal((await session.call('/api/workspaces/delete/preview',{path:target.root,password:'incorrect-password'})).value.code,'ACCESS_DENIED');
 assert.equal((await session.call('/api/workspaces/delete/preview',{path:f.active.root})).value.code,'STORAGE_DELETE_BUSY');
 assert.equal((await session.call('/api/workspaces/delete/preview',{path:path.join(f.directory,'unknown')})).value.code,'NOT_FOUND');
 const review=await session.call('/api/workspaces/delete/preview',{path:target.root,password:'a-long-test-password'});assert.equal(review.status,200,JSON.stringify(review.value));
 assert.equal((await second.call('/api/workspaces/delete/confirm',command(review.value))).value.code,'STALE');
 for(const change of [{confirmed:false},{path:f.active.root},{title:'Other'}])assert.equal((await session.call('/api/workspaces/delete/confirm',{...command(review.value),...change})).value.code,'STORAGE_DELETE_CONFIRM');
 await target.update(book=>({...book,title:'Renamed'}));
 assert.equal((await session.call('/api/workspaces/delete/confirm',command(review.value))).value.code,'CONFLICT');assert.equal(await workspaceDeletion(target.root),null);
 const next=await session.call('/api/workspaces/delete/preview',{path:target.root,password:'a-long-test-password'});
 assert.equal((await session.call('/api/workspaces/delete/confirm',command(next.value))).value.result.complete,true);
 assert.equal((await session.call('/api/storage')).value.contextId,session.context);
});

test('offline selections and target writers leave all owners intact; file-only legacy owners are removable',async t=>{
 const f=await fixture(t),target=await f.create('Legacy files',{plain:true}),session=await f.start(),offline=path.join(f.directory,'Disconnected');
 await rememberLocation(f.prefs,offline,{title:'Offline',label:'Workspace'});
 assert.equal((await session.call('/api/workspaces/delete/preview',{path:offline})).value.code,'MISSING');
 const plan=(await session.call('/api/workspaces/delete/preview',{path:target.root})).value;
 const lease=await workspaceDatabaseLease(null,{file:path.join(target.root,'.observanda','write.lock'),busyCode:'LOCKED'});
 try{assert.equal((await session.call('/api/workspaces/delete/confirm',command(plan))).value.code,'LOCKED');await access(target.root);}finally{await lease.close();}
 const next=(await session.call('/api/workspaces/delete/preview',{path:target.root})).value;
 assert.equal((await session.call('/api/workspaces/delete/confirm',command(next))).value.result.complete,true);await access(f.active.root);
});

for(const phase of ['prepared','frozen','retired'])test('closed-owner deletion resumes after '+phase+' without switching or deleting a reused path',async t=>{
 const f=await fixture(t,{owned:phase==='frozen'}),target=await f.create('Interrupted'),deletions=new WorkspaceDeletions(f.prefs+'.workspace-deletions');
 await assert.rejects(deletions.begin(target,await deletions.review(target),{checkpoint:stage=>{if(stage===phase)throw Error('interrupt');}}),/interrupt/);
 const [receipt]=await deletions.list();if(phase==='retired'){await mkdir(target.root);await writeFile(path.join(target.root,'keep.txt'),'new unrelated data');}
 const session=await f.start(),result=await session.call('/api/workspaces/delete/finish',{id:receipt.id,confirmed:true});assert.equal(result.status,200,JSON.stringify(result.value));
 assert.equal((await session.call('/api/storage')).value.contextId,session.context);assert.deepEqual(await deletions.list(),[]);
 if(phase==='prepared'){assert.equal(result.value.result.cancelled,true);assert.equal((await target.read()).book.title,'Interrupted');}
 else if(phase==='retired')assert.equal(await readFile(path.join(target.root,'keep.txt'),'utf8'),'new unrelated data');
 else await assert.rejects(access(target.root),{code:'ENOENT'});
});


test('deleting a closed owner does not stop active HTTP reads or setting writes',async t=>{
 const f=await fixture(t),target=await f.create('Delete in background'),session=await f.start();
 const plan=(await session.call('/api/workspaces/delete/preview',{path:target.root})).value;
 let release,entered;const reached=new Promise(r=>entered=r),hold=new Promise(r=>release=r),original=WorkspaceDeletions.prototype.stopDatabase;
 t.mock.method(WorkspaceDeletions.prototype,'stopDatabase',async function(root,...args){if(root===target.root){entered();await hold;}return original.call(this,root,...args);});
 const deleting=session.call('/api/workspaces/delete/confirm',command(plan));
 try{
  await Promise.race([reached,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Deletion did not reach database cleanup')),20000);timer.unref();})]);
  const notebook=await session.call('/api/notebook');assert.equal(notebook.status,200);assert.equal(notebook.value.book.title,'Keep open');
  const dashboard=(await session.call('/api/dashboard')).value;
  const saved=await session.call('/api/dashboard',{settings:dashboard.settings,etag:dashboard.etag});assert.equal(saved.status,200,JSON.stringify(saved.value));
  const info=(await session.call('/api/storage')).value;assert.equal(info.root,f.active.root);assert.equal(info.contextId,session.context);
 }finally{release();await deleting;}
 await assert.rejects(access(target.root),{code:'ENOENT'});assert.equal((await f.active.read()).book.title,'Keep open');
});


test('saved workspace deletion authenticates nested owners in its own client-bound context',{timeout:180000},async t=>{
 const f=await fixture(t,{owned:true}),target=await f.create('Nested saved workspace'),registry=new ProjectRegistry(target,(await target.outline()).metadata.id),projectId=randomUUID(),bookId=randomUUID();
 const created=await new ProjectCreation(registry,f.deviceStore).create({id:randomUUID(),username:'',password:'Independent project password',project:{id:projectId,title:'Private project',description:'',parentId:null,share:false,logoId:null}}),vault=await verifyAccess(await readAccess(created.project.root),'','Independent project password',{deviceStore:f.deviceStore});t.after(()=>clearVault(vault));
 await new LabBookCreation(new ProjectStorage(created.project.root,projectId,vault),f.deviceStore).create({id:randomUUID(),username:'',password:'Independent book password',book:{id:bookId,projectId,title:'Protected observations'}});
 const session=await f.start(),other=await session.client(),before=await f.active.read(),review=(await session.call('/api/workspaces/delete/preview',{path:target.root})).value;
 const start=await session.call('/api/workspaces/delete/confirm',command(review));assert.equal(start.value.projectId,projectId);assert.equal(start.value.code,'DEVICE_UNKNOWN');assert.equal(await workspaceDeletion(target.root),null);
 const unlock={id:review.id,projectId,username:'',password:'Independent project password',recovery:''};
 assert.equal((await other.call('/api/workspaces/delete/unlock',unlock)).value.code,'STALE');assert.equal((await session.call('/api/workspaces/delete/unlock',unlock)).status,200);
 const bookChallenge=await session.call('/api/workspaces/delete/confirm',command(review));assert.equal(bookChallenge.value.labBookId,bookId);assert.equal(bookChallenge.value.labBookName,'Protected observations');
 assert.equal((await session.call('/api/workspaces/delete/unlock',{...unlock,labBookId:bookId,password:'Independent book password'})).status,200);
 assert.equal((await session.call('/api/workspaces/delete/cancel',{id:review.id})).value.cancelled,true);assert.equal((await session.call('/api/workspaces/delete/unlock',unlock)).value.code,'STALE');await access(target.root);
 const next=(await session.call('/api/workspaces/delete/preview',{path:target.root})).value;
 assert.equal((await session.call('/api/workspaces/delete/confirm',command(next))).value.code,'DEVICE_UNKNOWN');
 assert.equal((await session.call('/api/workspaces/delete/unlock',{...unlock,id:next.id})).status,200);
 assert.equal((await session.call('/api/workspaces/delete/confirm',command(next))).value.labBookId,bookId);
 assert.equal((await session.call('/api/workspaces/delete/unlock',{...unlock,id:next.id,labBookId:bookId,password:'Independent book password'})).status,200);
 let entered,release;const ready=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve),writing=f.active.withLock(async()=>{entered();await held;});await ready;
 try{const removed=await session.call('/api/workspaces/delete/confirm',command(next));assert.equal(removed.status,200,JSON.stringify(removed.value));assert.equal(removed.value.result.complete,true);}finally{release();await writing;}
 await assert.rejects(access(target.root),{code:'ENOENT'});assert.deepEqual(await f.active.read(),before);assert.equal((await session.call('/api/storage')).value.contextId,session.context);
});
