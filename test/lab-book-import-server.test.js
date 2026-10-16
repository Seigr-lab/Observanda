import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {initializeLocation} from '../src/locations.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {createNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookImports} from '../src/lab-book-import.js';
import {copyLabBookLocation} from '../src/lab-book-transfer.js';
import {ResearchRecords} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {clearVault} from '../src/encryption.js';
import {startServer} from '../src/server.js';
import {TestDeviceStore} from './device-fixture.js';
async function result(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}

test('book import API authenticates its own source and resumes the destination after restart',{timeout:240000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-import-api-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),keys=[];let app;
 const original=LabBookImports.prototype.run;
 t.after(async()=>{LabBookImports.prototype.run=original;await app?.close();await provider.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-book-import-api-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')});
 async function credentials(){const access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);keys.push(vault);return {access,vault};}
 const initial=createNotebook('Research Workspace'),root=path.join(directory,initial.title),key=await credentials();await initializeLocation(root,initial,key.access,key.vault);
 const sourceModel=createNotebook('External Project'),sourceId=randomUUID(),sourceKey=await credentials();sourceModel.projects=[{id:sourceId,title:sourceModel.title,parentId:null,description:'',share:false,logoId:null}];const sourceProject=await initializeProjectLocation(path.join(directory,sourceModel.title),sourceId,sourceModel,sourceKey.access,sourceKey.vault);
 const created=await new LabBookCreation(sourceProject,device).create({id:randomUUID(),username:'',password:'Portable book password',book:{id:randomUUID(),projectId:sourceId,title:'Observations 1'}}),vault=await verifyAccess(await readAccess(created.book.root),'','Portable book password',{deviceStore:device});keys.push(vault);const source=new LabBookStorage(created.book.root,created.book.labBookId,vault),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:created.book.labBookId};await new ResearchRecords(source,new MediaStore(source)).save({workspaceId:created.book.namespaceId,changes:[{id:record.id,expectedRevision:null,record}]});
 const backups=path.join(directory,'Backups');await mkdir(backups);const backup=path.join(backups,created.book.directory);await copyLabBookLocation(source,backup,{id:randomUUID(),portable:true});
 async function start(){app=await startServer({root,port:0,headless:true,deviceStore:device});const response=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0],context=(await result(await fetch(app.origin+'/api/storage',{headers:{Cookie:cookie}}))).contextId;return (route,data={})=>fetch(app.origin+route,{signal:AbortSignal.timeout(90000),method:'POST',headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json','X-Observanda-Workspace':context,'X-Observanda-Wait':'1'},body:JSON.stringify(data)});}
 let call=await start();const project=(await result(await call('/api/projects/create',{id:randomUUID(),username:'',password:'Target project password',project:{id:randomUUID(),title:'Target Project',description:'',share:false,logoId:null}}))).project,prefix='/api/projects/'+project.projectId,request={id:randomUUID(),path:backup,username:'',password:'Portable book password',recovery:''};
 const denied=await result(await call(prefix+'/lab-books/import',request),422);assert.equal(denied.code,'DEVICE_UNKNOWN');
 await result(await call(prefix+'/access/unlock',{password:'Target project password'}));
 const wrong=await result(await call(prefix+'/lab-books/import',{...request,password:'Wrong password'}),422);assert.equal(wrong.code,'LAB_BOOK_IMPORT_ACCESS');assert.equal(wrong.projectId,undefined);assert.deepEqual((await result(await call(prefix+'/lab-books/import/pending'))).items,[]);
 let once=true;LabBookImports.prototype.run=function(command,options){return original.call(this,command,{...options,checkpoint:stage=>{if(stage==='copied'&&once){once=false;throw Error('Interrupted disposable book import');}}});};
 await result(await call(prefix+'/lab-books/import',request),500);const pending=await result(await call(prefix+'/lab-books/import/pending'));assert.equal(pending.items[0].id,request.id);assert.deepEqual((await result(await call(prefix+'/lab-books/move/pending'))).items,[]);
 await rename(backup,path.join(backups,'Source unavailable'));await app.close();app=null;call=await start();await result(await call(prefix+'/access/unlock',{password:'Target project password'}));
 const {path:unused,...resume}=request;void unused;const imported=await result(await call(prefix+'/lab-books/import/resume',resume));assert.equal(imported.complete,true);assert.equal(imported.book.root,path.join(project.root,created.book.directory));
 const address={workspaceId:created.book.namespaceId,recordId:record.id,sectionId:null},owned=prefix+'/lab-books/'+created.book.labBookId,read=await result(await call(owned+'/research/records/writing/read',address));assert.equal(read.value.body,record.body);
 await result(await call(owned+'/research/records/writing/save',{...address,expectedRevision:read.revision,value:{body:'Edited after import'}}));await result(await call(prefix+'/lab-books/import/resume',resume));assert.equal((await result(await call(owned+'/research/records/writing/read',address))).value.body,'Edited after import');
 assert.equal((await result(await call('/api/projects/reference-location',{workspaceId:created.book.namespaceId,kind:'record',id:record.id}))).labBookId,created.book.labBookId);assert.deepEqual((await result(await call(prefix+'/lab-books/import/pending'))).items,[]);
});
