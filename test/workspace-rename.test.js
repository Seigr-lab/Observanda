import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {startServer} from '../src/server.js';
import {readPreferences,rememberLocation} from '../src/preferences.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {initializeLocation} from '../src/locations.js';
import {createAccess} from '../src/access.js';
import {sampleNotebook} from '../src/sample.js';
import {WorkspaceRenames} from '../src/workspace-rename.js';
import {WorkspaceDirectory} from '../src/workspace-directory.js';
import {synchronizeWorkspaceName} from '../src/workspace-name-state.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {catalogueBinding} from '../src/postgres-activation.js';
async function fixture(t,{encrypted=false}={}){
 const testParent=await realpath(process.env.OBSERVANDA_RENAME_TEST_PARENT??os.tmpdir()),parent=await mkdtemp(path.join(testParent,'observanda-rename-test-'));let provider,detach,f;
 t.after(async()=>{await provider?.close();detach?.();clearVault(f?.vault);if(path.resolve(path.dirname(parent))!==path.resolve(testParent)||!path.basename(parent).startsWith('observanda-rename-test-'))throw Error('Unexpected test directory');await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 if(encrypted){provider=new WorkspaceDatabases({directory:path.join(parent,'application'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});detach=installDatabaseProvider(provider);f=await encryptedFixture(parent,sampleNotebook());}
 else f={workspace:new Workspace(await initializeLocation(path.join(parent,'old folder'),sampleNotebook(),await createAccess()))};
 return {...f,parent,renames:new WorkspaceRenames(path.join(parent,'renames')),provider};
}
test('current folder name is adopted once without changing records or prior history',async t=>{
 const f=await fixture(t),before=await f.workspace.read();await synchronizeWorkspaceName(f.workspace);const after=await f.workspace.read();
 assert.equal(after.book.title,path.basename(f.workspace.root));assert.equal(after.book.id,before.book.id);assert.deepEqual(after.book.entries,before.book.entries);assert.notEqual(after.etag,before.etag);
 assert.equal((await synchronizeWorkspaceName(f.workspace)).etag,after.etag);
});
for(const boundary of ['prepared','frozen','stopped','renamed','metadata','bindings','complete'])test('rename recovers at '+boundary+' with literal Unicode name and preserved data',async t=>{
 const f=await fixture(t),before=await f.workspace.read(),source=f.workspace.root,name='Research Workspace 1 – café',target=path.join(f.parent,name);
 await assert.rejects(f.renames.begin(f.workspace,name,{checkpoint:async stage=>{if(stage===boundary)throw Error('interrupted');}}),/interrupted/);
 const recovered=new WorkspaceRenames(path.join(f.parent,'renames')),located=await recovered.resolvedRoot(source);
 if(boundary==='complete')await recovered.clearCompleted(target);else await recovered.resume(located,null);
 const final=boundary==='prepared'?source:target,after=await new Workspace(final).read();
 assert.deepEqual(after.book.entries,before.book.entries);assert.equal(after.book.id,before.book.id);if(boundary!=='prepared')assert.equal(after.book.title,name);
 assert.equal(await recovered.pending(final),null);assert.ok((await readdir(path.join(final,'.observanda'))).every(name=>name!=='rename.observanda'));
});
test('rename refuses occupied destinations and a replaced source directory',async t=>{
 const f=await fixture(t),target=path.join(f.parent,'Occupied');await mkdir(target);await writeFile(path.join(target,'evidence'),'retained');
 await assert.rejects(f.renames.begin(f.workspace,'Occupied'),{code:'EXISTS'});assert.equal(await readFile(path.join(target,'evidence'),'utf8'),'retained');
 await assert.rejects(f.renames.begin(f.workspace,'Renamed',{checkpoint:async stage=>{if(stage==='frozen')throw Error('interrupted');}}),/interrupted/);
 await assert.rejects(f.workspace.read(),{code:'STORAGE_RENAMING'});
 const pending=await f.renames.pending(f.workspace.root);pending.identity.ino+='1';await f.renames.save(pending);
 await assert.rejects(f.renames.resume(f.workspace.root,null),{code:'STORAGE_RENAME_STATE'});
});
test('persistent directory keeps more than recent items and rejects concurrent duplicate names',async t=>{
 const f=await fixture(t),directory=new WorkspaceDirectory(path.join(f.parent,'directory.json'));
 for(let i=0;i<35;i++)await directory.using(path.join(f.parent,'Workspace '+i),{},async()=>{});
 assert.equal((await directory.list()).length,35);
 const attempts=await Promise.allSettled([directory.using(path.join(f.parent,'one','Same name'),{},async()=>{}),directory.using(path.join(f.parent,'two','Same name'),{},async()=>{})]);
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(attempts.find(r=>r.status==='rejected').reason.code,'WORKSPACE_NAME_EXISTS');
 await assert.rejects(directory.using(path.join(f.parent,'elsewhere','WORKSPACE 0'),{},async()=>{}),{code:'WORKSPACE_NAME_EXISTS'});
});
test('owned PostgreSQL stops, moves without copying, reopens and remains writable',async t=>{
 const f=await fixture(t,{encrypted:true}),before=await f.workspace.read(),binding=await catalogueBinding(f.workspace.root),source=f.workspace.root,name='Dedicated Workspace 1';
 const result=await f.renames.begin(f.workspace,name),target=new Workspace(result.destination,f.vault),after=await target.read();
 assert.deepEqual(after.book.entries,before.book.entries);assert.equal(after.book.title,name);assert.deepEqual(await catalogueBinding(target.root),binding);await assert.rejects(readdir(source),{code:'ENOENT'});
 await target.update(book=>({...book,description:'Continued after renaming'}));assert.equal((await target.read()).book.description,'Continued after renaming');
});

async function client(app){
 const response=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(response.status,200,await response.clone().text());
 const cookie=response.headers.get('set-cookie').split(';')[0];let context;
 const call=async(route,data)=>{
  const response=await fetch(app.origin+route,{method:data===undefined?'GET':'POST',headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json',...(context?{'X-Observanda-Workspace':context}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  return {status:response.status,value:await response.json()};
 };
 context=(await call('/api/storage')).value.contextId;return {call,adopt:value=>{context=value.contextId;}};
}
test('HTTP naming, folder rename, old-tab admission and restart use one canonical identity',async t=>{
 const f=await fixture(t),prefs=path.join(f.parent,'preferences.json');await rememberLocation(prefs,f.workspace.root);
 let app=await startServer({root:f.workspace.root,port:0,preferencesFile:prefs});t.after(()=>app.close());
 const a=await client(app),b=await client(app),before=(await a.call('/api/notebook')).value;
 assert.equal(before.book.title,path.basename(f.workspace.root));
 const fake=structuredClone(before);fake.book.title='Metadata-only name';assert.equal((await a.call('/api/notebook/save',fake)).status,422);
 const name='Research Workspace 1 – café',result=await a.call('/api/storage/rename',{name,etag:before.etag});assert.equal(result.status,200,JSON.stringify(result.value));a.adopt(result.value);
 const target=path.join(f.parent,name);assert.equal(result.value.root,target);assert.equal((await readPreferences(prefs)).workspace,target);
 const after=(await a.call('/api/notebook')).value;assert.equal(after.book.title,name);assert.deepEqual(after.book.entries,before.book.entries);
 assert.equal((await b.call('/api/notebook/save',before)).status,409);
 const other=path.join(f.parent,'Other parent');await mkdir(other);
 const duplicate=await a.call('/api/storage/copy',{path:path.join(other,name),confirmed:true});assert.equal(duplicate.value.code,'WORKSPACE_NAME_EXISTS');assert.deepEqual(await readdir(other),[]);
 await app.close();app=await startServer({root:target,port:0,preferencesFile:prefs});const reopened=await client(app);
 assert.equal((await reopened.call('/api/notebook')).value.book.title,name);
 assert.equal((await reopened.call('/api/storage/delete/preview',{})).value.title,name);
});
for(const boundary of ['frozen','renamed','complete'])test('application startup resumes rename after '+boundary,async t=>{
 const f=await fixture(t),prefs=path.join(f.parent,'preferences.json');await rememberLocation(prefs,f.workspace.root);
 const renames=new WorkspaceRenames(prefs+'.workspace-renames',{relocate:async(source,destination)=>rememberLocation(prefs,destination,{title:path.basename(destination),label:'Workspace'},{replacedPaths:[source]})});
 await assert.rejects(renames.begin(f.workspace,'Resumed Workspace',{checkpoint:async phase=>{if(phase===boundary)throw Error('interrupted');}}),/interrupted/);
 const app=await startServer({root:(await readPreferences(prefs)).workspace,port:0,preferencesFile:prefs});t.after(()=>app.close());const a=await client(app);
 assert.equal((await a.call('/api/storage')).value.root,path.join(f.parent,'Resumed Workspace'));assert.equal((await a.call('/api/notebook')).value.book.title,'Resumed Workspace');
});

test('force termination releases leases and resumes each durable rename boundary',async t=>{
 for(const boundary of ['frozen','renamed','metadata','bindings','complete']){
  const f=await fixture(t),source=f.workspace.root,journal=path.join(f.parent,'renames'),target=path.join(f.parent,'After process termination');
  const child=spawn(process.execPath,['test/fixtures/interrupt-workspace-rename.js',source,journal,path.basename(target),boundary],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const exited=once(child,'exit');let stderr='';child.stderr.on('data',bytes=>{stderr+=bytes;});
  try{
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Checkpoint timed out: '+stderr)),20000);child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('Exited before checkpoint: '+stderr));});child.stdout.on('data',bytes=>{if(bytes.toString().includes('checkpoint')){clearTimeout(timer);resolve();}});});
  }finally{if(child.exitCode===null)child.kill();await exited;}
  const recovered=new WorkspaceRenames(journal);if(boundary==='complete')await recovered.clearCompleted(target);else await recovered.resume(await recovered.resolvedRoot(source),null);
  const storage=new Workspace(target);assert.equal((await storage.read()).book.title,path.basename(target));await storage.update(book=>({...book,description:'Writable after restart'}));
 }
});
test('case-only rename retains literal spelling and does not create two folders',async t=>{
 const f=await fixture(t),name=path.basename(f.workspace.root).toUpperCase(),result=await f.renames.begin(f.workspace,name);
 assert.equal(await realpath(result.destination),result.destination);assert.equal((await new Workspace(result.destination).read()).book.title,name);
 assert.equal((await readdir(f.parent)).filter(n=>n.toLowerCase()===name.toLowerCase()).length,1);
});

test('existing duplicate names stay accessible for explicit resolution without changing either folder',async t=>{
 const f=await fixture(t),otherParent=path.join(f.parent,'other');await mkdir(otherParent);const other=path.join(otherParent,path.basename(f.workspace.root));
 await initializeLocation(other,sampleNotebook(),await createAccess());const prefs=path.join(f.parent,'preferences.json');await rememberLocation(prefs,other);await rememberLocation(prefs,f.workspace.root);
 const app=await startServer({root:f.workspace.root,port:0,preferencesFile:prefs});t.after(()=>app.close());const a=await client(app);
 assert.equal((await a.call('/api/storage')).value.nameConflict,true);assert.ok((await a.call('/api/workspaces')).value.workspaces.every(item=>item.conflict));
 const before=(await a.call('/api/notebook')).value,renamed=await a.call('/api/storage/rename',{name:'A distinct workspace',etag:before.etag});assert.equal(renamed.status,200);assert.equal(renamed.value.nameConflict,false);a.adopt(renamed.value);
 assert.ok((await a.call('/api/workspaces')).value.workspaces.every(item=>!item.conflict));assert.equal(await realpath(other),other);
});


test('restoring history keeps the current folder name and retains historical titles',async t=>{
 const f=await fixture(t,{encrypted:true}),before=await f.workspace.read(),result=await f.renames.begin(f.workspace,'Restored records');
 const target=new Workspace(result.destination,f.vault),current=await target.read();
 await target.update(book=>({...book,description:'Changed after rename'}));const changed=await target.read();
 const restored=await target.restore(before.etag,changed.etag);
 assert.equal(restored.book.title,'Restored records');assert.deepEqual(restored.book.entries,before.book.entries);assert.equal(restored.book.description,before.book.description);
 assert.equal((await target.readRevision(before.etag)).title,before.book.title);assert.notEqual(restored.etag,current.etag);
});


test('restart completes directory registration and retains a reused old path',async t=>{
 for(const reuse of [false,true]){
  const f=await fixture(t),prefs=path.join(f.parent,'preferences.json'),directory=new WorkspaceDirectory(prefs+'.workspace-directory.json');
  await rememberLocation(prefs,f.workspace.root);await directory.using(f.workspace.root,{},async()=>{});
  const renames=new WorkspaceRenames(prefs+'.workspace-renames',{relocate:async(source,destination)=>rememberLocation(prefs,destination,{title:path.basename(destination),label:'Workspace'},{replacedPaths:[source]})});
  const result=await renames.begin(f.workspace,'Registered after restart');
  if(reuse)await initializeLocation(f.workspace.root,sampleNotebook(),await createAccess());
  const app=await startServer({root:result.destination,port:0,preferencesFile:prefs});
  try{const a=await client(app),items=(await a.call('/api/workspaces')).value.workspaces;
   assert.equal(items.length,reuse?2:1);assert.ok(items.some(item=>item.path===result.destination));if(reuse)assert.equal(await realpath(f.workspace.root),f.workspace.root);
  }finally{await app.close();}
 }
});
