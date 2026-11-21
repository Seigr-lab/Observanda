import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture} from './project-tree-fixture.js';
import {ProjectRenames} from '../src/project-rename.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {pendingProjectRename} from '../src/project-rename-receipt.js';
import {workspaceRename} from '../src/workspace-rename-state.js';
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
