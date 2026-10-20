import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture} from './project-tree-fixture.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ProjectAccessSettings} from '../src/project-access-settings.js';
import {ScopedLocationAccess} from '../src/scoped-location-access.js';
import {catalogueBinding,CATALOGUE_ARCHIVE} from '../src/postgres-activation.js';

test('selected project application copies and exports independent owners with scoped borrowed keys',{timeout:240000},async t=>{
 const f=await projectTreeFixture(t),app=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore}),client={},selected=f.projects[0],password='Portable project access';t.after(()=>app.close());
 for(const entry of f.projects){const settings=new ProjectAccessSettings(new ProjectStorage(entry.root,entry.projectId,entry.key));await settings.password({etag:(await settings.details()).etag,username:'',password},{deviceStore:f.deviceStore});await app.unlock(client,entry.projectId,{password});}
 const route=operation=>projectRequest('/api/projects/'+selected.projectId+'/storage/'+operation),parent=path.join(f.directory,'Copies');await mkdir(parent);
 await assert.rejects(app.run(client,route('copy'),{id:randomUUID(),parent}),error=>['ACCESS_LOCKED','DEVICE_UNKNOWN'].includes(error.code));await assert.rejects(stat(path.join(parent,path.basename(selected.root))),{code:'ENOENT'});
 for(const book of f.books)await app.run(client,projectRequest('/api/projects/'+book.projectId+'/lab-books/'+book.labBookId+'/access/unlock'),{username:'',password:'Protected observations 456!',recovery:''});
 const originals=new Map([...app.session(client)].map(([id,grant])=>[id,{grant,root:grant.root}]));let activeProjects=0,activeBooks=0,peakProjects=0,peakBooks=0,borrowed=0;
 for(const method of ['withProject','withBook']){const original=ScopedLocationAccess.prototype[method];t.mock.method(ScopedLocationAccess.prototype,method,async function(...args){const use=args.pop();let key;try{return await original.call(this,...args,async storage=>{key=storage.vault;borrowed++;if(method==='withProject')peakProjects=Math.max(peakProjects,++activeProjects);else peakBooks=Math.max(peakBooks,++activeBooks);try{return await use(storage);}finally{if(method==='withProject')activeProjects--;else activeBooks--;}});}finally{if(key)assert.equal(key.key,null,'The awaited owner must clear its borrowed key');}});}
 const copied=await app.run(client,route('copy'),{id:randomUUID(),parent});assert.equal(copied.phase,'complete');
 const exportParent=path.join(f.directory,'Exports');await mkdir(exportParent);const exported=await app.run(client,route('export'),{id:randomUUID(),parent:exportParent});assert.equal(exported.phase,'complete');assert.equal(exported.portable,true);
 for(const book of f.books){const relative=path.relative(selected.root,book.root),copyRoot=path.join(copied.destination,relative),exportRoot=path.join(exported.destination,relative);assert.deepEqual(await new LabBookStorage(copyRoot,book.labBookId,book.key).read(),book.before);assert.equal(await catalogueBinding(exportRoot),null);assert.ok(await stat(path.join(exportRoot,CATALOGUE_ARCHIVE)));}
 for(const project of f.projects){const relative=path.relative(selected.root,project.root);assert.ok(await catalogueBinding(path.join(copied.destination,relative)));assert.equal(await catalogueBinding(path.join(exported.destination,relative)),null);}
 assert.equal(app.session(client).size,originals.size);for(const [id,{grant,root}] of originals){assert.equal(app.session(client).get(id),grant);assert.equal(grant.root,root);}
 assert.ok(borrowed>0);assert.equal(peakProjects,1);assert.equal(peakBooks,1);assert.equal(activeProjects,0);assert.equal(activeBooks,0);t.diagnostic(JSON.stringify({projects:2,books:2,peakBorrowedProjects:peakProjects,peakBorrowedBooks:peakBooks,retainedClientGrants:originals.size}));
});
