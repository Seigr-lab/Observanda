import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {largeCatalogueFixture} from './large-catalogue-fixture.js';
import {StructureCommands} from '../src/structure-commands.js';
import {ResearchCatalogue,catalogueDescriptor} from '../src/research-catalogue.js';
import {clearVault} from '../src/encryption.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {encryptedCopy,copyPlan} from '../src/locations.js';
import {Workspace} from '../src/storage.js';

async function fixture(t,options){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-large-structure-')),f=await largeCatalogueFixture(directory,options);
 t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,directory,service:new StructureCommands(f.workspace)};
}
const counts=workspace=>workspace.catalogue(async store=>({states:(await store.db.get('SELECT COUNT(*) AS count FROM state')).count,snapshots:(await store.db.get('SELECT COUNT(*) AS count FROM snapshots')).count}));

test('a catalogue beyond whole-book limits can preview and save structure without assembling records',async t=>{
 const count=1002,f=await fixture(t,{count,size:20}),service=f.service;
 const read=ResearchCatalogue.prototype.read;ResearchCatalogue.prototype.read=()=>{throw Error('Complete research document requested');};t.after(()=>{ResearchCatalogue.prototype.read=read;});
 const change={workspaceTitle:'A wider research workspace',workspaceDescription:'Independent work',projectId:f.book.projects[0].id},before=await f.workspace.outline();
 const rowsBefore=await counts(f.workspace),preview=await service.execute('reorganize',{etag:before.etag,change},{preview:true});
 assert.equal(preview.summary.records,count);assert.deepEqual(await counts(f.workspace),rowsBefore);assert.equal((await f.workspace.outline()).etag,before.etag);
 const saved=await service.execute('structure',{etag:before.etag,response:'outline',change:{kind:'notebook',value:{...f.book.notebooks[0],title:'Renamed without a whole-book load'}}});
 assert.equal(saved.total,count);assert.equal(saved.book.notebooks[0].title,'Renamed without a whole-book load');
 await f.workspace.catalogue(async store=>{
  const next=await store.snapshot(),previous=await store.snapshot(before.etag);assert.equal(await new SnapshotIndex(store).scopedCount(next.membership),count);
  for(const record of f.records){const member=await store.member(next,record.id),original=await store.member(previous,record.id);assert.equal(member.revision,original.revision);assert.equal((await store.record(member.id,member.revision)).body,record.body);}
  await store.verify(catalogueDescriptor(next.metadata));
 });
});

test('invalid identities roll back, moved records keep their bodies and an encrypted copy continues',async t=>{
 const f=await fixture(t,{count:40}),before=await counts(f.workspace);
 const bad={kind:'notebook',value:{...f.book.notebooks[0],id:f.records[0].id}};
 await assert.rejects(f.service.execute('structure',{etag:f.etag,response:'outline',change:bad}),{code:'INVALID'});
 assert.deepEqual(await counts(f.workspace),before);assert.equal((await f.workspace.outline()).etag,f.etag);
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
 const access=await createWorkspaceAccess('','synthetic structure recovery secret',new TestDeviceStore({file:path.join(f.directory,'device.key')})),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const location=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'recovered'),{vault:f.vault}),access,vault,f.vault),restored=new Workspace(location,vault);
 const outline=await restored.outline();assert.equal(outline.etag,saved.etag);
 const renamed=await new StructureCommands(restored).execute('structure',{etag:outline.etag,response:'outline',change:{kind:'notebook',value:{...outline.metadata.notebooks[0],title:'Continued after recovery'}}});
 assert.equal(renamed.total,40);assert.equal(renamed.book.notebooks[0].title,'Continued after recovery');
 await restored.catalogue(async store=>{assert.deepEqual(await store.snapshot(f.etag),await f.workspace.catalogue(s=>s.snapshot(f.etag)));await store.verify(catalogueDescriptor((await store.snapshot()).metadata));});
});

test('a missing lab book ownership key is damage: structure commands and the outline refuse it',async t=>{
 const f=await fixture(t,{count:12});
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const source=await store.snapshot(),index=new SnapshotIndex(store),row=await store.member(source,f.records[0].id);
  source.membership=await index.change(source.membership,'book:'+row.notebookId+':'+row.id,null);await index.flush(source.membership);
  await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',f.etag,source),f.etag);
 }));
 const before=await counts(f.workspace),change={kind:'notebook',value:{...f.book.notebooks[0],title:'Not saved over damage'}};
 await assert.rejects(f.service.execute('structure',{etag:f.etag,response:'outline',change}),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(f.service.execute('reorganize',{etag:f.etag,change:{workspaceTitle:'Not previewed',workspaceDescription:'',projectId:f.book.projects[0].id}},{preview:true}),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(f.workspace.catalogue(store=>store.recordOutline()),{code:'CATALOGUE_DAMAGED'});
 assert.deepEqual(await counts(f.workspace),before);assert.equal((await f.workspace.outline()).etag,f.etag);
});
