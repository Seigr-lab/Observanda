import {recordRevision} from '../src/research.js';
import {sampleNotebook} from '../src/sample.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture} from './project-tree-fixture.js';
import {startServer} from '../src/server.js';
import {RecordOwnerTransfer} from '../src/record-owner-transfer.js';
import {AppError} from '../src/errors.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {verifyRecordOwnerTransfers} from '../src/record-owner-transfer-verification.js';
import {readRecordOwnerTransfer,writeRecordOwnerTransfer} from '../src/record-owner-transfer-state.js';

test('record transfer HTTP commands recover across sessions without changing destinations or exposing protected owners',{timeout:240000},async t=>{
 const f=await projectTreeFixture(t);let server,api;
 for(const book of f.books)await new LabBookDirectory(f.registry).register(book.projectId,book);
 t.after(()=>server?.close());
 async function open(){
  server=await startServer({root:f.root,port:0,headless:true,deviceStore:f.deviceStore});
  const session=await fetch(server.origin+'/api/session',{method:'POST',headers:{Origin:server.origin,'Content-Type':'application/json'},body:JSON.stringify({token:server.launchToken})});
  assert.equal(session.status,200);const cookie=session.headers.get('set-cookie').split(';')[0];
  const headers={Cookie:cookie,Origin:server.origin},storage=await fetch(server.origin+'/api/storage',{headers});assert.equal(storage.status,200);headers['X-Observanda-Workspace']=(await storage.json()).contextId;
  const raw=(route,data)=>fetch(server.origin+route,{signal:AbortSignal.timeout(120000),method:data===undefined?'GET':'POST',headers:{...headers,...(data===undefined?{}:{'Content-Type':'application/json','X-Observanda-Wait':'1'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  return {raw,call:async(route,data,status=200)=>{const response=await raw(route,data);assert.equal(response.status,status,route+': '+await response.clone().text());return response.json();}};
 }
 api=await open();const [source,target]=f.books,record=source.before.book.entries[0],prefix=book=>'/api/projects/'+book.projectId+'/lab-books/'+book.labBookId;
 const transfer=prefix(source)+'/research/records/transfer/',unlock=book=>api.call(prefix(book)+'/access/unlock',{username:'',password:'Protected observations 456!'});
 await unlock(source);
 const selected=await api.call(prefix(source)+'/workspace/read/record-content',{workspaceId:source.namespaceId,recordId:record.id,pagedHeader:true});
 const command={id:randomUUID(),workspaceId:source.namespaceId,recordId:record.id,sourceNotebookId:source.labBookId,expectedStorageRevision:selected.storageRevision,targetProjectId:target.projectId,targetLabBookId:target.labBookId,targetWorkspaceId:target.namespaceId,targetNotebookId:target.labBookId};
 const originalRef={workspaceId:source.namespaceId,kind:'record',id:record.id,revision:recordRevision(record)};
 assert.equal(await api.call(transfer+'status',{workspaceId:source.namespaceId,recordId:record.id}),null);
 const deniedResponse=await api.raw(transfer+'start',command),denied=await deniedResponse.json();assert.ok([401,422].includes(deniedResponse.status));assert.equal(denied.projectId,target.projectId);assert.equal(denied.labBookId,target.labBookId);assert.equal(denied.operationNotStarted,true);
 assert.equal(await api.call(transfer+'status',{workspaceId:source.namespaceId,recordId:record.id}),null);
 assert.equal((await api.call('/api/activity')).operations.some(value=>value.kind===transfer+'start'),false);
 await unlock(target);
 const original=RecordOwnerTransfer.prototype.perform;let interrupted=false;
 const injected=t.mock.method(RecordOwnerTransfer.prototype,'perform',function(id,options){return original.call(this,id,{...options,checkpoint:async(stage,status)=>{await options.checkpoint?.(stage,status);if(stage==='verified'&&!interrupted){interrupted=true;throw new AppError('IO');}}});});
 const failed=await api.raw(transfer+'start',command);assert.notEqual(failed.status,200);await failed.arrayBuffer();assert.equal(interrupted,true);injected.mock.restore();
 const discovered=await api.call(transfer+'status',{workspaceId:source.namespaceId,recordId:record.id});assert.equal(discovered.id,command.id);assert.equal(discovered.phase,'verified');assert.equal(discovered.canResume,true);
 assert.equal((await api.call(prefix(target)+'/workspace/read/selection',{workspaceId:target.namespaceId,ids:[record.id]})).book.entries.length,0);
 const unpublishedReference=await api.raw(prefix(target)+'/reference-location',originalRef);assert.notEqual(unpublishedReference.status,200);assert.equal((await unpublishedReference.json()).code,'NOT_FOUND');
 const unpublishedHistory=await api.raw(prefix(target)+'/research/materials/record',{ref:originalRef,offset:0});assert.notEqual(unpublishedHistory.status,200);assert.equal((await unpublishedHistory.json()).code,'MATERIAL_INCOMPLETE');

 await api.call(prefix(target)+'/access/lock',{});
 assert.equal((await api.call(transfer+'status',{workspaceId:source.namespaceId,recordId:record.id})).phase,'verified');
 const resumeDenied=await api.raw(transfer+'resume',{workspaceId:source.namespaceId,recordId:record.id,id:command.id});assert.equal(resumeDenied.status,401);assert.equal((await resumeDenied.json()).labBookId,target.labBookId);
 await server.close();server=null;api=await open();await unlock(source);await unlock(target);
 const resumed=await api.call(transfer+'resume',{workspaceId:source.namespaceId,recordId:record.id,id:command.id});assert.equal(resumed.phase,'complete');assert.equal(resumed.result.recordId,record.id);assert.equal(resumed.result.labBookId,target.labBookId);
 assert.deepEqual(await api.call(transfer+'start',command),resumed);
 const location=await api.call('/api/projects/reference-location',originalRef);assert.equal(location.namespaceId,target.namespaceId);assert.equal(location.labBookId,target.labBookId);
 assert.equal((await api.call('/api/projects/reference',originalRef)).value.body,record.body);
 const foreign=await api.raw(prefix(target)+'/reference-location',{...originalRef,workspaceId:randomUUID()});assert.notEqual(foreign.status,200);assert.equal((await foreign.json()).code,'NOT_FOUND');
 const retained=await api.call('/api/projects/material-reference/record',{ref:originalRef,offset:0});assert.equal(retained.namespaceId,target.namespaceId);assert.equal(retained.value.previous.header.body,record.body);

 assert.equal((await api.call(prefix(source)+'/workspace/read/selection',{workspaceId:source.namespaceId,ids:[record.id]})).book.entries.length,0);
 const moved=(await api.call(prefix(target)+'/workspace/read/selection',{workspaceId:target.namespaceId,ids:[record.id]})).book.entries[0];assert.equal(moved.id,record.id);assert.equal(moved.notebookId,target.labBookId);assert.equal(moved.body,record.body);
 const writing={workspaceId:target.namespaceId,recordId:record.id,sectionId:null},before=await api.call(prefix(target)+'/research/records/writing/read',writing);
 await api.call(prefix(target)+'/research/records/writing/save',{...writing,expectedRevision:before.revision,value:{body:'Continued after transfer'}});
 assert.equal((await api.call(prefix(target)+'/research/records/writing/read',writing)).value.body,'Continued after transfer');
 assert.deepEqual(await api.call(transfer+'status',{workspaceId:source.namespaceId,recordId:record.id,id:command.id}),resumed);
 const sourceStorage=new LabBookStorage(source.root,source.labBookId,source.key),targetStorage=new LabBookStorage(target.root,target.labBookId,target.key);
 await sourceStorage.catalogue(store=>verifyRecordOwnerTransfers(store));await targetStorage.catalogue(store=>verifyRecordOwnerTransfers(store));await f.workspace.catalogue(store=>verifyRecordOwnerTransfers(store));
 await targetStorage.withLock(()=>targetStorage.catalogue(async store=>{
  const retained=await readRecordOwnerTransfer(store,command.id);
  try{await writeRecordOwnerTransfer(store,{...retained,result:{...retained.result,notebookId:randomUUID()}});await assert.rejects(verifyRecordOwnerTransfers(store),{code:'CATALOGUE_DAMAGED'});}
  finally{await writeRecordOwnerTransfer(store,retained);}
 }));
 const conflicting=await api.raw(transfer+'start',{...command,targetNotebookId:randomUUID()});assert.notEqual(conflicting.status,200);await conflicting.arrayBuffer();
 assert.equal((await api.call('/api/activity')).operations.some(value=>value.kind.endsWith('/transfer/status')),false);
 // Returning to a workspace-owned book remains explicit owner routing; it must
 // not fall back merely because a foreign namespace was not registered.
 const legacy=sampleNotebook(),legacyProject={...legacy.projects[0],id:randomUUID(),share:false},legacyBook={...legacy.notebooks[0],id:randomUUID(),projectId:legacyProject.id};
 await f.workspace.update(book=>{book.projects.push(legacyProject);book.notebooks.push(legacyBook);return book;});
 const latest=await api.call(prefix(target)+'/workspace/read/record-content',{workspaceId:target.namespaceId,recordId:record.id,pagedHeader:true});
 const returned=await api.call(prefix(target)+'/research/records/transfer/start',{id:randomUUID(),workspaceId:target.namespaceId,recordId:record.id,sourceNotebookId:target.labBookId,expectedStorageRevision:latest.storageRevision,targetProjectId:null,targetLabBookId:null,targetWorkspaceId:f.registry.workspaceId,targetNotebookId:legacyBook.id});assert.equal(returned.phase,'complete');
 const rootLocation=await api.call('/api/projects/reference-location',originalRef);assert.equal(rootLocation.namespaceId,f.registry.workspaceId);assert.equal(rootLocation.projectId,null);
 assert.equal((await api.call('/api/projects/reference',originalRef)).value.body,record.body);
 const rootRead=await api.call('/api/projects/material-reference/record',{ref:originalRef,offset:0});assert.equal(rootRead.namespaceId,f.registry.workspaceId);assert.equal(rootRead.projectId,null);assert.equal(rootRead.value.previous.header.body,record.body);
 const canonical=await api.call('/api/workspace/read/record-content',{workspaceId:f.registry.workspaceId,recordId:record.id,pagedHeader:true});assert.equal(canonical.header.body,'Continued after transfer');assert.equal(canonical.header.notebookId,legacyBook.id);

});
