import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {initializeLocation} from '../src/locations.js';
import {createNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {startServer} from '../src/server.js';
import {LabBookReparents} from '../src/lab-book-reparent.js';
import {TestDeviceStore} from './device-fixture.js';
async function result(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}

for(const crossFilesystem of [false,true])test('book placement API authenticates both parents and the book and resumes after server restart'+(crossFilesystem?' across filesystems':''),{timeout:180000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-placement-api-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider);let app,vault;
 const original=LabBookReparents.prototype.run,rename=fs.rename;
 t.after(async()=>{fs.rename=rename;syncBuiltinESMExports();LabBookReparents.prototype.run=original;await app?.close();await provider.close();detach();clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-book-placement-api-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',device);vault=takeCreatedVault(access);const root=path.join(directory,'Research Workspace 1');await initializeLocation(root,createNotebook('Research Workspace 1'),access,vault);
 async function start(){app=await startServer({root,port:0,headless:true,deviceStore:device});const response=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0],context=(await result(await fetch(app.origin+'/api/storage',{headers:{Cookie:cookie}}))).contextId;return (route,data={})=>fetch(app.origin+route,{signal:AbortSignal.timeout(45000),method:'POST',headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json','X-Observanda-Workspace':context,'X-Observanda-Wait':'1'},body:JSON.stringify(data)});}
 let call=await start();
 async function createProject(title,password=''){return (await result(await call('/api/projects/create',{id:randomUUID(),username:'',password,project:{id:randomUUID(),title,description:'',share:false,logoId:null}}))).project;}
 const source=await createProject('Source Project'),target=await createProject('Target Project','Target project password'),prefix='/api/projects/'+source.projectId;
 const book=(await result(await call(prefix+'/lab-books/create',{id:randomUUID(),username:'',password:'Book password',book:{id:randomUUID(),projectId:source.projectId,title:'Observations 1'}}))).book,own=prefix+'/lab-books/'+book.labBookId,there='/api/projects/'+target.projectId+'/lab-books/'+book.labBookId,id=randomUUID();
 if(crossFilesystem){fs.rename=async(from,to)=>{if(from===book.root&&to===path.join(target.root,book.directory))throw Object.assign(Error('Another filesystem'),{code:'EXDEV'});return rename(from,to);};syncBuiltinESMExports();}
 const targetDenied=await result(await call(own+'/storage/move',{id,projectId:target.projectId}),422);assert.equal(targetDenied.projectId,target.projectId);
 await result(await call('/api/projects/'+target.projectId+'/access/unlock',{password:'Target project password'}));
 const bookDenied=await result(await call(own+'/storage/move',{id,projectId:target.projectId}),422);assert.equal(bookDenied.projectId,source.projectId);assert.equal(bookDenied.labBookId,book.labBookId);
 await result(await call(own+'/access/unlock',{password:'Book password'}));
 const record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:book.labBookId};await result(await call(own+'/research/records/save',{workspaceId:book.namespaceId,changes:[{id:record.id,expectedRevision:null,record}]}));
 const choices=await result(await call('/api/projects/choices',{kind:'book-parents',exclude:source.projectId,query:'Target',offset:0,limit:25,revision:null}));assert.deepEqual(choices.projects.map(item=>item.projectId),[target.projectId]);
 let once=true;LabBookReparents.prototype.run=function(...args){const options=args[3];return original.call(this,...args.slice(0,3),{...options,checkpoint:stage=>{if(stage==='renamed'&&once){once=false;throw Error('Interrupted disposable folder move');}}});};
 await result(await call(own+'/storage/move',{id,projectId:target.projectId}),500);assert.equal((await result(await call(own+'/storage/details'))).move.canResume,true);
 const pending=await result(await call(prefix+'/lab-books/move/pending'));assert.equal(pending.items[0].labBookId,book.labBookId);assert.equal((await result(await call('/api/projects/'+target.projectId+'/lab-books/move/pending'))).items[0].id,id);
 await result(await call(prefix+'/workspace/read/start'));await app.close();app=null;await provider.closeLabBook(path.join(target.root,book.directory));call=await start();
 await result(await call('/api/projects/'+target.projectId+'/access/unlock',{password:'Target project password'}));await result(await call(own+'/access/unlock',{password:'Book password'}));
 const moved=await result(await call(there+'/storage/move/resume',{id}));assert.equal(moved.book.root,path.join(target.root,book.directory));await assert.rejects(stat(book.root),{code:'ENOENT'});
 const address={workspaceId:book.namespaceId,recordId:record.id,sectionId:null},read=await result(await call(there+'/research/records/writing/read',address));assert.equal(read.value.body,record.body);
 assert.equal((await result(await call(own+'/research/records/writing/read',address),422)).code,'LAB_BOOK_MOVED');
 const resolved=await result(await call('/api/projects/reference-location',{workspaceId:book.namespaceId,kind:'record',id:record.id}));assert.equal(resolved.projectId,target.projectId);assert.equal(resolved.labBookId,book.labBookId);
 await result(await call(there+'/research/records/writing/save',{...address,expectedRevision:read.revision,value:{body:'Written in the new parent'}}));
 assert.equal((await result(await call(own+'/storage/move',{id,projectId:target.projectId}))).complete,true);
 assert.equal((await result(await call(there+'/research/records/writing/read',address))).value.body,'Written in the new parent');
 assert.deepEqual((await result(await call(prefix+'/lab-books/move/pending'))).items,[]);assert.deepEqual((await result(await call('/api/projects/'+target.projectId+'/lab-books/move/pending'))).items,[]);
});
