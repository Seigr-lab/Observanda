import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {legacyCatalogueFixture} from './legacy-catalogue-fixture.js';
import {StructureCommands} from '../src/structure-commands.js';
import {ResearchCatalogue,catalogueDescriptor} from '../src/research-catalogue.js';
import {clearVault} from '../src/encryption.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {encryptedCopy,copyPlan} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {completeSnapshotOwnership} from '../src/snapshot-ownership.js';

async function fixture(t,options){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-legacy-structure-')),f=await legacyCatalogueFixture(directory,options);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,directory,service:new StructureCommands(f.workspace)};
}
const counts=workspace=>workspace.catalogue(async store=>({states:(await store.db.get('SELECT COUNT(*) AS count FROM state')).count,snapshots:(await store.db.get('SELECT COUNT(*) AS count FROM snapshots')).count}));

for(const kind of ['flat','indexed'])test(kind+' older catalogue can preview and save structure beyond whole-book limits without assembling records',async t=>{
 const count=kind==='flat'?80:1002,f=await fixture(t,{kind,count,size:kind==='flat'?40000:20,missingOwners:true}),service=f.service;
 const read=ResearchCatalogue.prototype.read;ResearchCatalogue.prototype.read=()=>{throw Error('Complete research document requested');};t.after(()=>{ResearchCatalogue.prototype.read=read;});
 const change={workspaceTitle:'A wider research workspace',workspaceDescription:'Independent work',projectId:f.book.projects[0].id,copyLogos:false},before=await f.workspace.outline();
 const rowsBefore=await counts(f.workspace),preview=await service.execute('reorganize',{etag:before.etag,change},{preview:true});
 assert.equal(preview.summary.records,count);assert.deepEqual(await counts(f.workspace),rowsBefore);assert.equal((await f.workspace.outline()).etag,before.etag);
 const saved=await service.execute('structure',{etag:before.etag,response:'outline',change:{kind:'notebook',value:{...f.book.notebooks[0],title:'Renamed without a whole-book load'}}});
 assert.equal(saved.total,count);assert.equal(saved.book.notebooks[0].title,'Renamed without a whole-book load');
 await f.workspace.catalogue(async store=>{
  const next=await store.snapshot();assert.equal(await new SnapshotIndex(store).scopedCount(next.membership),count);
  assert.equal((await store.snapshot(before.etag)).indexVersion,kind==='flat'?undefined:1);
  const previous=await store.snapshot(before.etag);
  for(const record of f.records){const member=await store.member(next,record.id),original=await store.member(previous,record.id);assert.equal(member.revision,original.revision);assert.equal((await store.record(member.id,member.revision)).body,record.body);}
  await store.verify(catalogueDescriptor(next.metadata));
 });
});

test('interrupted ownership reconstruction and invalid identities roll back before retry and fresh-key recovery',async t=>{
 const f=await fixture(t,{count:40,missingOwners:true}),before=await counts(f.workspace),controller=new AbortController(),record=ResearchCatalogue.prototype.record;
 let loaded=0;
 ResearchCatalogue.prototype.record=async function(...args){const value=await record.apply(this,args);if(++loaded===7)controller.abort();return value;};
 try{await assert.rejects(f.workspace.withLock(()=>f.workspace.catalogue(async store=>completeSnapshotOwnership(store,await store.snapshot(),{signal:controller.signal}))),{name:'AbortError'});}
 finally{ResearchCatalogue.prototype.record=record;}
 assert.equal(loaded,7);assert.deepEqual(await counts(f.workspace),before);assert.equal((await f.workspace.outline()).etag,f.etag);
 const bad={kind:'notebook',value:{...f.book.notebooks[0],id:f.records[0].id}};
 await assert.rejects(f.service.execute('structure',{etag:f.etag,response:'outline',change:bad}),{code:'INVALID'});
 assert.deepEqual(await counts(f.workspace),before);
 const source=f.book.notebooks[1],destination=f.book.notebooks[0];
 const saved=await f.service.execute('structure',{etag:f.etag,response:'outline',change:{kind:'delete-notebook',value:{id:source.id,records:'move',destinationId:destination.id,confirmed:true}}});
 assert.equal(saved.total,40);assert.deepEqual(saved.notebookCounts,{[destination.id]:40});
 await f.workspace.catalogue(async store=>{
  const current=await store.snapshot(),previous=await store.snapshot(f.etag);
  for(const record of f.records){
   const member=await store.member(current,record.id),original=await store.member(previous,record.id),now=await store.record(member.id,member.revision),old=await store.record(original.id,original.revision);
   assert.equal(now.notebookId,destination.id);assert.deepEqual({...now,notebookId:old.notebookId,updatedAt:old.updatedAt},old);
   if(old.notebookId===destination.id)assert.equal(member.revision,original.revision);
  }
  await store.verify(catalogueDescriptor(current.metadata));
 });
 await assert.rejects(f.service.execute('structure',{etag:f.etag,response:'outline',change:bad}),{code:'CONFLICT'});
 const access=await createAccess('','synthetic legacy recovery secret'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const location=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'recovered')),access,vault,f.vault),restored=new Workspace(location,vault);
 const outline=await restored.outline();assert.equal(outline.etag,saved.etag);
 const renamed=await new StructureCommands(restored).execute('structure',{etag:outline.etag,response:'outline',change:{kind:'notebook',value:{...outline.metadata.notebooks[0],title:'Continued after recovery'}}});
 assert.equal(renamed.total,40);assert.equal(renamed.book.notebooks[0].title,'Continued after recovery');
 await restored.catalogue(async store=>{assert.deepEqual(await store.snapshot(f.etag),await f.workspace.catalogue(s=>s.snapshot(f.etag)));await store.verify(catalogueDescriptor((await store.snapshot()).metadata));});
});

test('missing declared ownership keys are rejected rather than silently rebuilt',async t=>{
 const f=await fixture(t,{kind:'indexed',count:12,missingOwners:true});
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const source=await store.snapshot(),index=new SnapshotIndex(store),row=await store.member(source,f.records[0].id);
  source.membership=await index.change(source.membership,'book:'+row.notebookId+':'+row.id,null);await index.flush(source.membership);
  await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',f.etag,source),f.etag);
 }));
 const before=await counts(f.workspace);
 await assert.rejects(f.workspace.withLock(()=>f.workspace.catalogue(async store=>completeSnapshotOwnership(store,await store.snapshot()))),{code:'CATALOGUE_DAMAGED'});
 assert.deepEqual(await counts(f.workspace),before);
});
