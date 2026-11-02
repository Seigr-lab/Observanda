import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture} from './project-tree-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {publicationSourceReader} from '../src/project-publication-sources.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {discoverEligibleWebsiteSources,lastWebsiteLibraryDiscovery} from '../src/website-library-discovery.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';

test('workspace discovery follows registered project/book owners and defers locked book grants until unlocked',{timeout:240000},async t=>{
 const f=await projectTreeFixture(t),store=new WebsiteFileStore(f.workspace),application=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore}),client={};
 const namespace=f.registry.workspaceId,sourceDirectory=new LabBookDirectory(f.registry),fixture=sampleNotebook(),hostBook=fixture.notebooks[0],recordId=randomUUID();
 const host=fixture.entries[1];host.id=recordId;host.notebookId=hostBook.id;host.share=true;host.title='Shared observation';
 await f.workspace.update(book=>{book.projects.push(fixture.projects[0]);book.notebooks.push(hostBook);book.entries.push(host);return book;});
 const records=[];
 for(const book of f.books){
  await sourceDirectory.register(book.projectId,book);
  const storage=new LabBookStorage(book.root,book.labBookId,book.key);
  await storage.update(model=>{
   const approved={...model.entries[0],id:recordId,title:'Shared observation',share:true},denied={...approved,id:randomUUID(),title:'Withheld in this book',share:false};
   model.entries=[approved,denied];records.push({workspaceId:model.id,projectId:book.projectId,notebookId:book.labBookId,recordId,projectTitle:model.projects[0].title,notebookTitle:model.notebooks[0].title});
   return model;
  });
 }
 const unlockBook=b=>application.run(client,projectRequest('/api/projects/'+b.projectId+'/lab-books/'+b.labBookId+'/access/unlock','POST'),{password:'Protected observations 456!'});
 const discover=async()=>{const reader=await publicationSourceReader(application,client,{workspaceId:namespace,signal:t.signal});
  try{const value=await discoverEligibleWebsiteSources(store,reader,{signal:t.signal});await reader.verify();return value;}finally{await reader.close();}};
 try{
  for(const p of f.projects)await application.unlock(client,p.projectId,{});
  await unlockBook(f.books[0]);
  assert.deepEqual(await discover(),{state:'locked',deferred:1});
  assert.equal((await lastWebsiteLibraryDiscovery(store)).state,'locked');
  const first=await store.searchLibrary({search:'Shared observation'});
  assert.deepEqual(new Set(first.items.map(r=>r.workspaceId)),new Set([namespace,f.books[0].namespaceId]));
  assert.equal((await store.searchLibrary({search:'Withheld'})).items.length,0);
  await unlockBook(f.books[1]);assert.deepEqual(await discover(),{state:'ready',deferred:0});
  const all=(await store.searchLibrary({search:'Shared observation'})).items;assert.equal(all.length,3);assert.ok(all.every(r=>r.recordId===recordId));
  for(const owner of records){
   const source=all.find(r=>r.id===websiteSourceId(owner));assert.ok(source);assert.equal(source.workspaceId,owner.workspaceId);
   assert.equal(source.projectTitle,owner.projectTitle);assert.equal(source.notebookTitle,owner.notebookTitle);
   assert.equal((await store.searchLibrary({projectId:owner.projectId,notebookId:owner.notebookId})).items.length,1);
  }
  // A selected project cannot enumerate its workspace's other projects/books.
  const project=f.projects[0],scoped=await publicationSourceReader(application,client,{workspaceId:project.namespaceId,scope:project.projectId});
  try{
   await assert.rejects(scoped.projectOwners(null),{code:'ACCESS_DENIED'});
   await assert.rejects(scoped.bookOwners(f.projects[1].projectId,f.projects[1].namespaceId,{}),{code:'ACCESS_DENIED'});
  }finally{await scoped.close();}
  assert.equal((await store.searchLibrary({search:'Withheld'})).items.length,0);
 }finally{await application.close();await closeIdleMutationFiles();}
});
