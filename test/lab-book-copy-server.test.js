import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,stat} from 'node:fs/promises';
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

import {LabBookCopies} from '../src/lab-book-copy.js';
import {sampleNotebook} from '../src/sample.js';

test('book transfer API preserves authorization, owner boundaries and independent writers',{timeout:180000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-copy-api-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider);let app,vault,release,pending;
 const original=LabBookCopies.prototype.run;
 t.after(async()=>{release?.();await pending?.catch(()=>{});LabBookCopies.prototype.run=original;await app?.close();await provider.close();detach();clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-book-copy-api-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',device);vault=takeCreatedVault(access);const root=path.join(directory,'Research Workspace 1');await initializeLocation(root,createNotebook('Research Workspace 1'),access,vault);app=await startServer({root,port:0,headless:true,deviceStore:device});
 async function session(){const response=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0],context=(await result(await fetch(app.origin+'/api/storage',{headers:{Cookie:cookie}}))).contextId;return (route,data={})=>fetch(app.origin+route,{signal:AbortSignal.timeout(45000),method:'POST',headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json','X-Observanda-Workspace':context,'X-Observanda-Wait':'1'},body:JSON.stringify(data)});}
 const first=await session(),second=await session(),projectId=randomUUID(),base='/api/projects/'+projectId;
 await result(await first('/api/projects/create',{id:randomUUID(),username:'',password:'',project:{id:projectId,title:'Field Project 1',description:'',share:false,logoId:null}}));
 async function create(title){return (await result(await first(base+'/lab-books/create',{id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId,title}}))).book;}
 const book=await create('Observations 1'),sibling=await create('Sibling Book'),own=base+'/lab-books/'+book.labBookId,other=base+'/lab-books/'+sibling.labBookId;
 const saved=await result(await first(own+'/access/details'));await result(await first(own+'/access/password',{etag:saved.etag,username:'',password:'Independent transfer password'}));
 const copies=path.join(directory,'Copies'),exports=path.join(directory,'Backups');await mkdir(copies);await mkdir(exports);
 const rejected=await result(await second(own+'/storage/copy',{id:randomUUID(),parent:copies}),422);assert.equal(rejected.labBookId,book.labBookId);await assert.rejects(stat(path.join(copies,book.directory)),{code:'ENOENT'});
 const notPortable=await result(await first(other+'/storage/export',{id:randomUUID(),parent:exports}),422);assert.equal(notPortable.code,'STORAGE_PORTABLE_BOOK_ACCESS');await assert.rejects(stat(path.join(exports,sibling.directory)),{code:'ENOENT'});
 const invalid=await result(await first(own+'/storage/copy',{id:randomUUID(),parent:root}),422);assert.equal(invalid.code,'STORAGE_PATH');
 await result(await first(own+'/storage/copy',{id:randomUUID(),parent:copies,unexpected:true}),422);
 let entered;const ready=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);
 LabBookCopies.prototype.run=function(storage,options){return original.call(this,storage,{...options,checkpoint:async stage=>{if(stage==='files'){entered();await held;}}});};
 const id=randomUUID();pending=first(own+'/storage/copy',{id,parent:copies});await ready;
 assert.equal((await result(await first(own+'/storage/details'))).copy.running,true);
 const outline=await result(await first(other+'/workspace/read/start')),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:sibling.labBookId};
 await result(await first(other+'/research/records/save',{workspaceId:outline.metadata.id,changes:[{id:record.id,expectedRevision:null,record}]}));
 await result(await first(base+'/workspace/read/start'));release();assert.equal((await result(await pending)).phase,'complete');pending=null;
 const final=await result(await first(own+'/storage/details'));assert.equal(final.copy.running,false);assert.equal(final.copy.destination,path.join(copies,book.directory));assert.equal((await result(await first(own+'/storage/copy/resume',{id}))).phase,'complete');
});
