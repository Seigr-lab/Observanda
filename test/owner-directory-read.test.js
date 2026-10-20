import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {createNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {Workspace} from '../src/storage.js';

test('directory admission reuses connections without inheriting a pinned snapshot',{timeout:60000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-directory-read-')),book=createNotebook('Research Workspace');
 const {workspace,vault}=await encryptedFixture(directory,book),registry=new ProjectRegistry(workspace,book.id);
 t.after(async()=>{clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-directory-read-'));await rm(directory,{recursive:true,force:true});});
 const entry={projectId:randomUUID(),namespaceId:randomUUID(),vaultId:randomUUID(),root:path.join(workspace.root,'Field Project'),parentId:null,summary:{title:'Field Project',description:'',kind:'Project',templateName:null}};
 const writer=new ProjectRegistry(new Workspace(workspace.root,vault),book.id);
 const before=(await registry.apply(await registry.version(),[{state:'active',entry}])).revision;
 const opened=[],open=workspace.openCatalogue.bind(workspace);t.mock.method(workspace,'openCatalogue',async options=>{
  const db=await open(options),item={closed:false},close=db.close.bind(db);opened.push(item);db.close=async()=>{try{return await close();}finally{item.closed=true;}};return db;
 });
 await workspace.withCatalogueConnections(async()=>{
  const ready=Promise.withResolvers(),changed=Promise.withResolvers();let after;
  const reading=workspace.catalogue(async()=>{
   assert.equal(await registry.inspect(view=>view.revision),before);
   assert.equal(await registry.version(),before);ready.resolve();await changed.promise;
   assert.equal(await registry.inspect(view=>view.revision),before,'Ordinary reads keep their original snapshot');
   assert.equal(await registry.version(),after,'Admission sees the newly committed directory head');
   const count=opened.length;assert.equal(await registry.version(),after);assert.equal(opened.length,count,'Further admission reuses the independent connection');
  });
  reading.catch(ready.reject);
  try{await ready.promise;after=(await writer.apply(before,[{state:'active',entry:{...entry,summary:{...entry.summary,title:'Changed project title'}}}])).revision;}
  finally{changed.resolve();await reading;}
  assert.notEqual(after,before);
  const failure=new Error('Interrupted directory read'),current=registry.directoryOwner.access.current;
  const broken=t.mock.method(registry.directoryOwner.access,'current',async()=>{throw failure;});
  try{await assert.rejects(registry.version(),error=>error===failure);}finally{broken.mock.restore();}
  assert.equal(registry.directoryOwner.access.current,current);
  assert.equal(await registry.version(),after,'A failed read rolls back and can reopen');
 });
 assert.ok(opened.length>=3);assert.ok(opened.every(item=>item.closed),'All retained and failed connections close');
});
