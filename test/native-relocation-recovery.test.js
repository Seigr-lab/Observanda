import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {projectTreeFixture} from './project-tree-fixture.js';
import {ProjectRenames} from '../src/project-rename.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {WorkspaceProjectRename} from '../src/workspace-project-rename.js';
import {ProjectBookRename} from '../src/project-book-rename.js';
import {RENAME_BOOK_KEYS_FILE} from '../src/workspace-rename-keys.js';
import {pendingProjectRename,directoryIdentity} from '../src/project-rename-receipt.js';
import {workspaceRename} from '../src/workspace-rename-state.js';
import {assertRegular,digest,workspaceFile} from '../src/storage.js';
import {ProjectDomains} from '../src/project-domains.js';
import {InventoryOperationStore} from '../src/inventory-operation-store.js';
const callbacks=f=>({withProject:async(id,use)=>use(new ProjectStorage((await f.registry.locate(id)).root,id,f.projects.find(item=>item.projectId===id).key)),withBook:async(project,id,use)=>use(new LabBookStorage((await new LabBookRegistry(project).locate(id)).root,id,f.books.find(item=>item.labBookId===id).key))});
test('completed native rename keeps recovery discoverable until keys are erased and carries inventory reservations',{timeout:240000},async t=>{
 const f=await projectTreeFixture(t),entry=f.projects[0],storage=new ProjectStorage(entry.root,entry.projectId,entry.key),renames=new ProjectRenames(f.registry,entry.projectId),id=randomUUID(),name='Relocated Field \u00c5 Notes';
 const domains=new ProjectDomains(storage,entry.namespaceId),reservation=randomUUID(),saved={version:1,id:reservation};await domains.initialize(['inventory']);await domains.run(['inventory'],get=>new InventoryOperationStore(get('inventory')).write('live',reservation,saved),{write:['inventory']});
 await assert.rejects(renames.run(storage,{id,name,expectedName:path.basename(entry.root),...callbacks(f),checkpoint:async stage=>{if(stage==='complete')throw Error('Before credential erasure');}}),/Before credential erasure/);
 const value=await renames.read(),destination=renames.scope(value).destination;assert.equal(value.ownerDirectoryVersion,2);assert.equal((await pendingProjectRename(f.registry,entry.projectId)).id,id);assert.equal((await workspaceRename(destination)).id,id);
 let fail=true;const original=ProjectStorage.prototype.openCatalogue,patch=t.mock.method(ProjectStorage.prototype,'openCatalogue',async function(...args){const db=await original.apply(this,args),run=db.run.bind(db);if(this.root===destination)db.run=async(sql,...params)=>{if(fail&&sql==='DELETE FROM state WHERE slot LIKE $1'&&params[0]==='portability:'+value.ownerKeys.id+':%')throw Error('Credential erasure refused');return run(sql,...params);};return db;});
 await assert.rejects(renames.resume(entry.key),/Credential erasure refused/);assert.equal((await pendingProjectRename(f.registry,entry.projectId)).id,id);assert.equal((await workspaceRename(destination)).id,id);
 fail=false;await assert.rejects(renames.resume(entry.key,{checkpoint:async stage=>{if(stage==='keys-erased')throw Error('Lost erasure acknowledgement');}}),/Lost erasure acknowledgement/);patch.mock.restore();assert.equal((await pendingProjectRename(f.registry,entry.projectId)).id,id);assert.equal((await workspaceRename(destination)).id,id);
 const result=await renames.resume(entry.key);assert.equal(result.complete,true);assert.equal(await pendingProjectRename(f.registry,entry.projectId),null);assert.equal(await workspaceRename(destination),null);
 const target=new ProjectStorage(destination,entry.projectId,entry.key);await target.catalogue(async store=>assert.equal(Number((await store.db.get('SELECT count(*)::text AS count FROM state WHERE slot LIKE $1','portability:'+value.ownerKeys.id+':%')).count),0));
 const moved=new ProjectDomains(target,entry.namespaceId);await moved.run(['inventory'],async get=>assert.deepEqual(await new InventoryOperationStore(get('inventory')).read('live',reservation),saved));
 for(const book of f.books){const project=await f.registry.locate(book.projectId),owner=new ProjectStorage(project.root,project.projectId,f.projects.find(item=>item.projectId===book.projectId).key),child=await new LabBookRegistry(owner).locate(book.labBookId);assert.deepEqual(await new LabBookStorage(child.root,child.labBookId,book.key).read(),book.before);}
});
test('legacy aggregate prepared rename resumes with independent project and book credentials',{timeout:180000},async t=>{
 const f=await projectTreeFixture(t),entry=f.projects[0],source=new ProjectStorage(entry.root,entry.projectId,entry.key),renames=new ProjectRenames(f.registry,entry.projectId),projects=new WorkspaceProjectRename(source,{registry:f.registry}),books=new ProjectBookRename(source,{keyFile:RENAME_BOOK_KEYS_FILE}),access=callbacks(f),name='Legacy Relocated Tree';
 try{
  await projects.prepare(access.withProject,access.withBook);await books.prepare((id,use)=>access.withBook(source,id,use));
  const value={version:1,id:randomUUID(),projectId:entry.projectId,namespaceId:entry.namespaceId,vaultId:entry.vaultId,parentId:entry.parentId,source:path.relative(f.root,entry.root).split(path.sep).join('/'),destination:name,identity:directoryIdentity(await assertRegular(entry.root,{directory:true})),accessHash:digest(await readFile(path.join(entry.root,'.observanda/access.json'))),descriptorHash:digest(await readFile(await workspaceFile(entry.root))),phase:'prepared',settings:null,rootBooks:{}};
  await projects.persist(value);await books.persist(value.id,value.rootBooks);await renames.save(value);
 }finally{projects.close();books.close();}
 const result=await renames.resume(entry.key);assert.equal(result.complete,true);assert.equal(path.basename(result.project.root),name);assert.equal((await renames.read()).ownerDirectoryVersion,undefined);
 for(const book of f.books){const project=await f.registry.locate(book.projectId),parent=new ProjectStorage(project.root,project.projectId,f.projects.find(item=>item.projectId===book.projectId).key),child=await new LabBookRegistry(parent).locate(book.labBookId);assert.deepEqual(await new LabBookStorage(child.root,child.labBookId,book.key).read(),book.before);}
});
