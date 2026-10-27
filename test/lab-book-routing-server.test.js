import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {ResearchMaterials} from '../src/research-materials.js';
import {MediaImports} from '../src/media-imports.js';
import {randomUUID} from 'node:crypto';
import {createNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace} from '../src/storage.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {initializeLocation} from '../src/locations.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {clearVault} from '../src/encryption.js';
import {catalogueBinding} from '../src/postgres-activation.js';
import {startServer} from '../src/server.js';
import {labBookRequest} from '../src/lab-book-application.js';
import {LabBookRouter} from '../src/lab-book-router.js';

async function result(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}

test('HTTP creation and authoring select dedicated nested book databases during other writes',{timeout:200000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-http-')),vaults=[],provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider);let app;
 t.after(async()=>{await app?.close();await provider.close();detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-book-http-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);vaults.push(vault);
 const root=path.join(directory,'Research Workspace 1');await initializeLocation(root,createNotebook('Research Workspace 1'),access,vault);const workspace=new Workspace(root,vault);
 app=await startServer({root,port:0,headless:true,deviceStore:device});
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(session.status,200);const cookie=session.headers.get('set-cookie').split(';')[0];
 const context=(await result(await fetch(app.origin+'/api/storage',{headers:{Cookie:cookie}}))).contextId;
 const call=(route,data={})=>fetch(app.origin+route,{signal:AbortSignal.timeout(45000),method:'POST',headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json','X-Observanda-Workspace':context,'X-Observanda-Wait':'1'},body:JSON.stringify(data)});
 const projectId=randomUUID(),project=(await result(await call('/api/projects/create',{id:randomUUID(),path:path.join(root,'Field Project 1'),username:'',password:'',project:{id:projectId,title:'Field Project 1',description:'',share:false,logoId:null}}))).project;
 const base='/api/projects/'+projectId+'/lab-books',make=title=>call(base+'/create',{id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId,title}}).then(result);
 const a=(await make('Field Book 1')).book,b=(await make('Field Book 2')).book;
 assert.equal(a.root,path.join(project.root,'Field Book 1'));assert.equal(b.root,path.join(project.root,'Field Book 2'));assert.equal((await catalogueBinding(a.root)).placement,'lab-book');assert.equal((await catalogueBinding(b.root)).placement,'lab-book');
 const openBookCatalogue=LabBookStorage.prototype.openCatalogue;
 LabBookStorage.prototype.openCatalogue=function(){throw Error('Directory listing must not open a child book database');};
 try{assert.equal((await result(await call(base+'/list',{}))).total,2);}finally{LabBookStorage.prototype.openCatalogue=openBookCatalogue;}
 async function owned(entry,Class,id){const key=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:device});vaults.push(key);return new Class(entry.root,id,key);}
 const selected=await owned(a,LabBookStorage,a.labBookId),parent=await owned(project,ProjectStorage,projectId);
 const record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:b.labBookId,title:'Saved in the second book'};
 let enter,release;const entered=new Promise(resolve=>enter=resolve),hold=new Promise(resolve=>release=resolve);
 const busy=parent.withLock(()=>selected.withLock(async()=>{enter();await hold;}));await entered;
 try{
  await result(await call(base+'/'+b.labBookId+'/research/records/save',{workspaceId:b.namespaceId,changes:[{id:record.id,expectedRevision:null,record}]}));
  const read=await result(await call(base+'/'+b.labBookId+'/research/records/writing/read',{workspaceId:b.namespaceId,recordId:record.id,sectionId:null}));assert.equal(read.value.body,record.body);
  const listing=await result(await call(base+'/list',{}));assert.equal(listing.total,2);
 }finally{release();await busy;}
 const target={workspaceId:b.namespaceId,recordId:record.id,sectionId:null},before=await result(await call(base+'/'+b.labBookId+'/research/records/writing/read',target));
 await result(await call(base+'/'+b.labBookId+'/research/records/writing/save',{...target,expectedRevision:before.revision,value:{body:'Updated through the selected book route'}}));
 const after=await result(await call(base+'/'+b.labBookId+'/research/records/writing/read',target));assert.equal(after.value.body,'Updated through the selected book route');
 await result(await call(base+'/'+b.labBookId+'/research/records/history/list',{workspaceId:b.namespaceId,recordId:record.id}));
 assert.notEqual((await call(base+'/'+a.labBookId+'/research/records/writing/read',target)).status,200);
 assert.equal((await selected.read()).book.entries.length,0);assert.equal((await parent.read()).book.entries.length,0);assert.equal((await workspace.read()).book.entries.length,0);

 const prefix=base+'/'+b.labBookId,other=base+'/'+a.labBookId,bytes=Buffer.from('Observation readings\n1,2,3\n');
 const rawCall=(route,{method='GET',body,headers={}}={})=>fetch(app.origin+route,{signal:AbortSignal.timeout(45000),method,body,headers:{Origin:app.origin,Cookie:cookie,'X-Observanda-Workspace':context,...headers}});
 const originalPrepare=ResearchMaterials.prototype.prepareImport;let allow=false,started;const ready=new Promise(resolve=>started=resolve);
 ResearchMaterials.prototype.prepareImport=async function(id,options){if(this.workspace.labBookId===b.labBookId&&!allow){started();await delay(60000,null,{signal:options.signal});}return originalPrepare.call(this,id,options);};
 t.after(()=>{ResearchMaterials.prototype.prepareImport=originalPrepare;});
 const upload=await result(await call(prefix+'/research/materials/start',{recordId:record.id,name:'measurements.csv',size:bytes.length}));
 await result(await rawCall(prefix+'/research/materials/chunk/'+upload.id+'/0',{method:'POST',body:bytes,headers:{'Content-Type':'application/octet-stream'}}));
 await result(await call(prefix+'/research/materials/finish',{id:upload.id}),202);await ready;
 assert.equal((await result(await call(prefix+'/research/materials/job',{id:upload.id}))).job.state,'running');
 // A second book starts and completes a separate worker while the first waits.
 const media=await result(await call(other+'/media-imports/start',{name:'observations.txt',kind:'file',size:bytes.length}));
 await result(await rawCall(other+'/media-imports/receive/'+media.id,{method:'POST',body:bytes,headers:{'Content-Type':'application/octet-stream'}}));
 await result(await call(other+'/media-imports/finish',{id:media.id}));
 const waitJob=async(route,id)=>{const end=Date.now()+20000;let job;do{job=(await result(await call(route,{id}))).job;if(['completed','failed'].includes(job.state))break;await delay(50);}while(Date.now()<end);assert.equal(job.state,'completed',JSON.stringify(job));return job;};
 const prepared=await waitJob(other+'/media-imports/job',media.id);
 assert.deepEqual(Buffer.from(await (await rawCall(other+'/media/'+prepared.result.id)).arrayBuffer()),bytes);
 assert.notEqual((await rawCall(prefix+'/media/'+prepared.result.id)).status,200);
 await result(await rawCall(prefix+'/fonts'));await result(await rawCall(prefix+'/media-policy'));
 assert.equal((await result(await call(prefix+'/media-imports/list',{cursor:null}))).items.length,0);
 // Parent lock revokes both book workers; unlock resumes their durable queues.
 await result(await call('/api/projects/'+projectId+'/access/lock'));
 assert.equal((await call(prefix+'/research/materials/job',{id:upload.id})).status,401);
 allow=true;await result(await call('/api/projects/'+projectId+'/access/unlock'));
 const job=await waitJob(prefix+'/research/materials/job',upload.id);assert.equal(job.attempt,2);
 const original=prefix+'/research/materials/original/'+job.result.id+'/'+job.result.revision+'?context='+context;
 const downloaded=await rawCall(original);assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
 const range=await rawCall(original,{headers:{Range:'bytes=2-7'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(2,8));
 assert.notEqual((await rawCall(original.replace('/'+b.labBookId+'/', '/'+a.labBookId+'/'))).status,200);
 assert.notEqual((await call(other+'/research/materials/job',{id:upload.id})).status,200);
 assert.equal((await new MediaImports(parent).list()).length,0);
 const raw=await readFile(path.join(project.root,'.observanda/lab-books.observanda'));assert.equal(raw.includes(Buffer.from('Field Book')),false);
 // Renaming through the application retains stable record and evidence routes.
 const inode=await stat(b.root),renameCommand={id:randomUUID(),expectedName:'Field Book 2',name:'Field Book 2 observations'};
 const renamed=await result(await call(prefix+'/storage/rename',renameCommand));assert.equal(renamed.complete,true);assert.equal(renamed.book.root,path.join(project.root,renameCommand.name));assert.equal((await stat(renamed.book.root)).ino,inode.ino);
 await assert.rejects(stat(b.root),{code:'ENOENT'});
 assert.equal((await result(await call(prefix+'/storage/rename',renameCommand))).book.root,renamed.book.root);
 assert.equal((await result(await call(prefix+'/research/records/writing/read',target))).value.body,'Updated through the selected book route');
 assert.deepEqual(Buffer.from(await (await rawCall(original)).arrayBuffer()),bytes);
 await result(await call(prefix+'/research/records/history/list',{workspaceId:b.namespaceId,recordId:record.id}));
 assert.equal((await result(await call(base+'/list',{}))).items.find(book=>book.labBookId===b.labBookId).directory,renameCommand.name);
 const outline=await result(await call(prefix+'/workspace/read/start')),configuration={profiles:[],sections:[{id:randomUUID(),profileId:null,key:'observation',label:'Field observation',description:'',enabled:true,fields:[]}]};
 const settings={id:randomUUID(),etag:outline.etag,book:{id:b.labBookId,projectId,title:'Field Book 2 laboratory',configuration}};
 const configured=await result(await call(prefix+'/settings/save',settings));assert.equal(configured.book.notebooks[0].title,settings.book.title);assert.deepEqual(configured.book.notebooks[0].configuration,configuration);
 assert.equal(configured.location.root,path.join(project.root,settings.book.title));assert.equal((await stat(configured.location.root)).ino,inode.ino);
 await result(await call(prefix+'/settings/save',settings));
 configuration.sections[0].label='Revised field observation';
 const changed=await result(await call(prefix+'/settings/save',{...settings,id:randomUUID(),etag:configured.etag}));assert.equal(changed.book.notebooks[0].configuration.sections[0].label,configuration.sections[0].label);
 assert.equal((await call(prefix+'/settings/save',{...settings,id:randomUUID(),etag:configured.etag})).status,409);
 assert.equal((await call(prefix+'/settings/save',{...settings,id:randomUUID(),etag:changed.etag,book:{...settings.book,projectId:randomUUID()}})).status,422);
 assert.equal((await result(await call(prefix+'/research/records/writing/read',target))).value.body,'Updated through the selected book route');
 assert.deepEqual(Buffer.from(await (await rawCall(original)).arrayBuffer()),bytes);
});

test('book routes exclude structural shortcuts and deny unauthorized owners before lookup',async()=>{
 const id=randomUUID();assert.equal(labBookRequest('lab-books/'+id+'/workspace/structure'),null);assert.equal(labBookRequest('lab-books/'+id+'/workspace/notebook'),null);assert.equal(labBookRequest('lab-books/invalid/research/records/query'),null);
 let lookedUp=false;const router=new LabBookRouter({locate:()=>{lookedUp=true;}},{authorize:async()=>false,unlock:async()=>{throw Error('Should not unlock');}});
 await assert.rejects(router.withLabBook(id,()=>{}),{code:'ACCESS_DENIED'});assert.equal(lookedUp,false);
});
