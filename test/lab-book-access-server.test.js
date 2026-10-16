import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {initializeLocation} from '../src/locations.js';
import {createNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {startServer} from '../src/server.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {TestDeviceStore} from './device-fixture.js';
async function result(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}

test('independent book credentials survive rename and isolate session locks and password revocation',{timeout:180000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-access-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider);let app,vault;
 const originalOutline=LabBookStorage.prototype.outline;let release;
 t.after(async()=>{release?.();LabBookStorage.prototype.outline=originalOutline;await app?.close();await provider.close();detach();clearVault(vault);assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-book-access-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',device);vault=takeCreatedVault(access);const root=path.join(directory,'Research Workspace 1');await initializeLocation(root,createNotebook('Research Workspace 1'),access,vault);
 app=await startServer({root,port:0,headless:true,deviceStore:device});
 async function session(){const response=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0],context=(await result(await fetch(app.origin+'/api/storage',{headers:{Cookie:cookie}}))).contextId;const call=(route,data={})=>fetch(app.origin+route,{signal:AbortSignal.timeout(45000),method:'POST',headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json','X-Observanda-Workspace':context,'X-Observanda-Wait':'1'},body:JSON.stringify(data)});call.activity=async()=>result(await fetch(app.origin+'/api/activity',{headers:{Cookie:cookie}}));return call;}
 const first=await session(),second=await session(),projectId=randomUUID(),base='/api/projects/'+projectId;
 await result(await first('/api/projects/create',{id:randomUUID(),username:'',password:'',project:{id:projectId,title:'Field Project 1',description:'',share:false,logoId:null}}));
 async function create(title){return (await result(await first(base+'/lab-books/create',{id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId,title}}))).book;}
 const a=await create('Protected Book'),b=await create('Sibling Book'),own=base+'/lab-books/'+a.labBookId,sibling=base+'/lab-books/'+b.labBookId;
 const original=await result(await first(own+'/access/details'));assert.equal(original.passwordAvailable,false);
 const password='Disposable passphrase 739!',nextPassword='Replacement passphrase 924!';
 const saved=await result(await first(own+'/access/password',{etag:original.etag,username:'Researcher',password}));assert.equal(saved.passwordAvailable,true);
 assert.equal((await result(await first(own+'/access/details'))).etag,saved.etag);
 const denied=await result(await second(own+'/access/details'),422);assert.equal(denied.projectId,projectId);assert.equal(denied.labBookId,a.labBookId);
 await result(await second(own+'/access/unlock',{username:'Researcher',password}));
 const before=await result(await first(own+'/workspace/read/start',{}));
 await result(await first(own+'/storage/rename',{id:randomUUID(),expectedName:'Protected Book',name:'Protected observations 1'}));
 const renamed=await result(await first(own+'/workspace/read/start',{}));assert.equal(renamed.metadata.id,before.metadata.id);assert.equal(renamed.metadata.notebooks[0].title,'Protected observations 1');
 // Locking this book does not wait for a read in its sibling.
 let entered;const ready=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);let blocked=false;
 LabBookStorage.prototype.outline=async function(...args){if(this.labBookId===b.labBookId&&!blocked){blocked=true;entered();await held;}return originalOutline.apply(this,args);};
 const reading=first(sibling+'/workspace/read/start',{});await ready;
 await result(await first(own+'/access/lock'));release();await result(await reading);release=null;LabBookStorage.prototype.outline=originalOutline;
 assert.equal((await result(await first(own+'/access/details'),401)).labBookId,a.labBookId);
 await result(await first(base+'/workspace/read/start',{}));await result(await first(sibling+'/access/details',{}));await result(await second(own+'/access/details',{}));
 await result(await first(own+'/access/unlock',{username:'Researcher',password:'Incorrect passphrase'}),401);
 await result(await first(own+'/access/unlock',{username:'Researcher',password}));
 const updated=await result(await second(own+'/access/password',{etag:saved.etag,username:'Researcher',password:nextPassword}));assert.notEqual(updated.etag,saved.etag);
 assert.equal((await result(await first(own+'/access/details'),401)).labBookId,a.labBookId);await result(await first(own+'/access/unlock',{username:'Researcher',password:nextPassword}));
 await result(await second(base+'/access/lock'));const parentDenied=await result(await second(own+'/access/details'),401);assert.equal(parentDenied.projectId,projectId);assert.equal(parentDenied.labBookId,undefined);
 await result(await second(base+'/access/unlock'));await result(await second(own+'/access/unlock',{username:'Researcher',password:nextPassword}));await result(await second(own+'/access/details'));
 const observed=await first.activity();assert.equal(observed.operations.some(entry=>/\/access\/(?:lock|unlock)$/.test(entry.kind)),false);
});
