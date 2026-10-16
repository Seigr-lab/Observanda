import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,rename,readFile,access,cp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {initializeLocation,copyPlan,copyWorkspace} from '../src/locations.js';
import {readPreferences,rememberLocation} from '../src/preferences.js';
import {rememberWorkspaceLocation} from '../src/workspace-reconnection.js';
import {Workspace} from '../src/storage.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {contentBuffer} from '../src/file-content.js';
import {updateWorkspaceAccess,workspaceAccess} from '../src/security/workspace-access.js';
import {openCatalogue,CATALOGUE_FILE,CATALOGUE_ARCHIVE} from '../src/postgres.js';
import {startServer} from '../src/server.js';
import {TestDeviceStore} from './device-fixture.js';
import {GithubConnections} from '../src/github/connections.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-portability-')),root=path.join(directory,'workspace'),file=path.join(directory,'preferences.json'),deviceStore=new TestDeviceStore({file:path.join(directory,'device.key')});
 const access=await createWorkspaceAccess('','',deviceStore),vault=takeCreatedVault(access),book=sampleNotebook();book.title=path.basename(root);
 await initializeLocation(root,book,access,vault);await rememberLocation(file,root,{title:'',label:'Encrypted workspace'});
 const ws=new Workspace(root,vault),materials=new ResearchMaterials(ws),bytes=Buffer.from('Synthetic original disk image\0\xff'),upload=await materials.startImport({recordId:book.entries[0].id,name:'prepared.img',size:bytes.length,provenance:'Relocation fixture'});
 await materials.appendImport(upload.id,0,[bytes]);const ref=await materials.finishImport(upload.id);
 const servers=[];
 t.after(async()=>{for(const app of servers)await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 return {directory,root,file,deviceStore,ws,vault,materials,bytes,ref,async start(options={}){const app=await startServer({root,preferencesFile:file,deviceStore,port:0,headless:true,...options});servers.push(app);return app;}};
}
async function client(app){
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(session.status,200);
 const cookie=session.headers.get('set-cookie').split(';')[0];let context;
 const c={async request(route,data){const response=await fetch(app.origin+route,{method:data===undefined?'GET':'POST',headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json',...(context?{'X-Observanda-Workspace':context}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,value:await response.json()};},async call(route,data){const result=await c.request(route,data);assert.equal(result.status,200,JSON.stringify(result.value));if(route==='/api/storage'||route==='/api/storage/open')context=result.value.contextId;return result.value;}};
 return c;
}
async function recovery(f){const current=await workspaceAccess(f.root,f.vault);return (await updateWorkspaceAccess(f.root,f.vault,{action:'recovery',etag:current.etag,confirmed:true})).recovery;}

async function assertNamedWorkspace(workspace,before){
 const current=await workspace.read();assert.equal(current.book.title,path.basename(workspace.root));assert.equal(current.book.revision,before.book.revision+1);assert.notEqual(current.etag,before.etag);
 const payload=({title,revision,updatedAt,...book})=>book;
 assert.deepEqual(payload(current.book),payload(before.book));
 assert.deepEqual(await workspace.catalogue(store=>store.read(before.etag)),before,'Folder name adoption changed the retained original history');
}

test('a renamed folder reconnects encrypted research, original evidence and the existing GitHub account',async t=>{
 const f=await fixture(t),before=await f.ws.read(),token='synthetic-token-not-a-secret';
 const github=new GithubConnections({file:f.file+'.github',helper:{available:async()=>true,accounts:async()=>['alice'],credential:async()=>({login:'alice',token})},request:async()=>new Response(JSON.stringify({id:7,login:'alice'}))});
 await github.choose(f.root,'alice');const first=await f.start({githubConnections:github}),one=await client(first);await one.call('/api/storage');await first.close();
 assert.ok((await readPreferences(f.file)).recent[0].catalogueId);
 const moved=path.join(f.directory,'Flyttet – moved research');await rename(f.root,moved);
 const second=await f.start({githubConnections:github,expectedExisting:true}),two=await client(second);
 assert.equal((await two.call('/api/storage')).unavailableReason,'folder-missing');
 const opened=await two.call('/api/storage/open',{path:moved});assert.equal(opened.root,moved);assert.equal(opened.available,true);
 await assertNamedWorkspace(new Workspace(moved,f.vault),before);
 assert.deepEqual(await contentBuffer((await new ResearchMaterials(new Workspace(moved,f.vault)).artifact(f.ref)).content),f.bytes);
 const preferences=await readPreferences(f.file);assert.equal(preferences.workspace,moved);assert.deepEqual(preferences.recent.map(item=>item.path),[moved]);
 assert.equal((await github.summary(moved)).selected.login,'alice');assert.equal((await github.summary(f.root)).selected,null);assert.equal(await github.token(moved),token);
 assert.ok(!(await readFile(github.file,'utf8')).includes(token));
});

test('portable export verifies independent unlock, keeps its archive through retries and restores with no source database',async t=>{
 const f=await fixture(t),before=await f.ws.read(),key=await recovery(f),app=await f.start(),c=await client(app),storage=await c.call('/api/storage'),destination=path.join(f.directory,'portable');
 const denied=await c.request('/api/storage/portable/preview',{path:destination});assert.equal(denied.value.code,'STORAGE_PORTABLE_ACCESS');
 assert.equal((await c.request('/api/storage/portable/preview',{path:destination,password:'incorrect password'})).value.code,'ACCESS_DENIED');
 const plan=await c.call('/api/storage/portable/preview',{path:destination,recovery:key});assert.ok(!JSON.stringify(plan).includes(key));
 assert.equal((await c.request('/api/storage/copy',{id:plan.id,reviewed:true})).value.code,'STALE');
 const receipt=await c.call('/api/storage/portable',{id:plan.id,reviewed:true}),archive=await readFile(path.join(destination,CATALOGUE_ARCHIVE));
 assert.equal(receipt.portable,true);assert.deepEqual(await c.call('/api/storage/portable',{id:plan.id,reviewed:true}),receipt);
 assert.deepEqual(await readFile(path.join(destination,CATALOGUE_ARCHIVE)),archive);await assert.rejects(access(path.join(destination,CATALOGUE_FILE)),{code:'ENOENT'});
 assert.equal((await c.call('/api/storage')).contextId,storage.contextId);assert.equal((await readPreferences(f.file)).workspace,f.root);assert.deepEqual(await f.ws.read(),before);
 await app.close();
 const db=await openCatalogue(f.root);try{await db.run('DROP SCHEMA "'+db.schema+'" CASCADE');}finally{await db.close();}
 await assert.rejects(f.ws.read(),{code:'CATALOGUE_UNAVAILABLE'});
 const moved=path.join(f.directory,'Another computer – research');await rename(destination,moved);
 const deviceStore=new TestDeviceStore({file:path.join(f.directory,'another-device.key')});await deviceStore.identity();
 await assert.rejects(verifyAccess(await readAccess(moved),'','',{deviceStore}),{code:'DEVICE_UNKNOWN'});
 const receiver=await f.start({root:null,preferencesFile:path.join(f.directory,'receiver.json'),deviceStore}),other=await client(receiver);
 await other.call('/api/storage');const restored=await other.call('/api/storage/open',{path:moved,recovery:key});assert.equal(restored.available,true);
 const vault=await verifyAccess(await readAccess(moved),'','',{deviceStore,recovery:key});
 try{const ws=new Workspace(moved,vault);await assertNamedWorkspace(ws,before);const materials=new ResearchMaterials(ws);assert.deepEqual(await contentBuffer((await materials.artifact(f.ref)).content),f.bytes);await materials.verify();}
 finally{clearVault(vault);}
 assert.ok((await readFile(path.join(moved,CATALOGUE_FILE))).length);await assert.rejects(access(path.join(moved,CATALOGUE_ARCHIVE)),{code:'ENOENT'});
});

test('portable review detects subsequent research edits before making a destination',async t=>{
 const f=await fixture(t),key=await recovery(f),app=await f.start(),c=await client(app),destination=path.join(f.directory,'stale');await c.call('/api/storage');
 const plan=await c.call('/api/storage/portable/preview',{path:destination,recovery:key}),current=await f.ws.read();current.book.entries[0].title='A later observation';await f.ws.save(current.book,current.etag);
 assert.equal((await c.request('/api/storage/portable',{id:plan.id,reviewed:true})).value.code,'CONFLICT');await assert.rejects(access(destination),{code:'ENOENT'});
 assert.equal((await readPreferences(f.file)).workspace,f.root);
});

test('opening an independent portable copy does not inherit the original computer account binding',async t=>{
 const f=await fixture(t);await rememberWorkspaceLocation(f.file,f.root,{title:'',label:'Encrypted workspace'});
 const copy=await copyWorkspace(await copyPlan(f.root,path.join(f.directory,'independent')),{vault:f.vault});await new Workspace(copy,f.vault).read();
 await rename(f.root,f.root+'-moved');let transfers=0;
 await rememberWorkspaceLocation(f.file,copy,{title:'',label:'Encrypted workspace'},{github:{relocate:async()=>transfers++}});
 assert.equal(transfers,0);assert.equal((await readPreferences(f.file)).recent.length,2);
});

test('a raw duplicate folder cannot silently share one database with a separately stored set of evidence',async t=>{
 const f=await fixture(t);await rememberWorkspaceLocation(f.file,f.root,{title:'',label:'Encrypted workspace'});
 const duplicate=path.join(f.directory,'raw-copy');await cp(f.root,duplicate,{recursive:true,errorOnExist:true,force:false});
 const before=await readFile(f.file);let transfers=0;
 await assert.rejects(rememberWorkspaceLocation(f.file,duplicate,{title:'',label:'Encrypted workspace'},{github:{relocate:async()=>transfers++}}),{code:'STORAGE_LINKED_COPY'});
 assert.equal(transfers,0);assert.deepEqual(await readFile(f.file),before);assert.deepEqual(await f.materials.read(f.ref),(await new ResearchMaterials(new Workspace(duplicate,f.vault)).read(f.ref)));
});
