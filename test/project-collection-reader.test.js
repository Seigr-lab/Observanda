import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture} from './project-tree-fixture.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {ProjectSessionOwner} from '../src/project-session-owner.js';
import {LabBookAccessSession} from '../src/lab-book-access-session.js';
import {projectCollectionReader} from '../src/project-collection-reader.js';

test('collection readers reuse only the live parent and recheck every previous book grant',{timeout:180000},async t=>{
 const f=await projectTreeFixture(t),parent=f.projects[0],storage=new ProjectStorage(parent.root,parent.projectId,parent.key);
 const extra=(await new LabBookCreation(storage,f.deviceStore).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:parent.projectId,title:'Independent sibling book'}})).book;
 const app=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore}),client={},readers=[];
 t.after(async()=>{for(const reader of readers)await reader.close();await app.close();});
 const call=(route,data={})=>app.run(client,projectRequest('/api/projects/'+route,'POST'),data);
 await app.unlock(client,parent.projectId,{});
 for(const book of f.books)await call(book.projectId+'/lab-books/'+book.labBookId+'/access/unlock',{password:'Protected observations 456!'});
 const parents=[],bookKeys=[],router=ProjectSessionOwner.prototype.router,key=LabBookAccessSession.prototype.key;
 t.mock.method(ProjectSessionOwner.prototype,'router',async function(){const first=!this.selectedRouter,result=await router.call(this);if(first)parents.push(this);return result;});
 t.mock.method(LabBookAccessSession.prototype,'key',async function(root){const value=await key.call(this,root);bookKeys.push(value.key);return value;});
 const reader=projectCollectionReader(app,client,async()=>{});readers.push(reader);
 const use=book=>reader.use({workspaceId:book.namespaceId,projectId:book.projectId??parent.projectId,labBookId:book.labBookId},undefined,(_store,snapshot)=>snapshot.metadata.id);
 assert.equal(await use(f.books[0]),f.books[0].namespaceId);const firstParent=parents[0],parentKey=firstParent.vault.key;
 assert.equal(await use(extra),extra.namespaceId);assert.equal(parents.length,1);assert.equal(firstParent.closed,undefined);
 assert.ok(bookKeys[0].every(value=>value===0));assert.ok(bookKeys[1].some(value=>value!==0));assert.ok(parentKey.some(value=>value!==0));
 await reader.verify();
 await call(parent.projectId+'/lab-books/'+f.books[0].labBookId+'/access/lock');
 await assert.rejects(reader.verify(),error=>error.code==='ACCESS_LOCKED'&&error.labBookId===f.books[0].labBookId);
 await reader.close();assert.ok(parentKey.every(value=>value===0));assert.ok(bookKeys[1].every(value=>value===0));
 const next=projectCollectionReader(app,client,async()=>{});readers.push(next);
 await next.use({workspaceId:extra.namespaceId,projectId:parent.projectId,labBookId:extra.labBookId},undefined,()=>{});
 const retained=parents.at(-1),retainedKey=retained.vault.key;
 await next.use({workspaceId:f.books[1].namespaceId,projectId:f.books[1].projectId,labBookId:f.books[1].labBookId},undefined,()=>{});
 assert.equal(retained.closed,true);assert.ok(retainedKey.every(value=>value===0));
 await next.verify();
 // An unrelated sibling directory change does not revoke this exact book.
 const sibling=(await new LabBookCreation(storage,f.deviceStore).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:parent.projectId,title:'Later independent book'}})).book;
 const parentCount=parents.length;await next.verify();assert.equal(parents.length,parentCount+1);assert.equal(parents.at(-1).closed,true);
 const unchangedCount=parents.length;await next.verify();assert.equal(parents.length,unchangedCount);
 const directory=new LabBookRegistry(storage),before=await directory.read();
 await directory.change(before.revision,value=>({...value,books:value.books.map(book=>book.labBookId===sibling.labBookId?{...book,directory:'Renamed independent book'}:book)}));
 await next.verify();
 const selected=await directory.read();
 await directory.change(selected.revision,value=>({...value,books:value.books.map(book=>book.labBookId===extra.labBookId?{...book,vaultId:randomUUID()}:book)}));
 await assert.rejects(next.verify(),error=>error.code==='ACCESS_LOCKED'&&error.labBookId===extra.labBookId);
 const restore=await directory.read();await directory.change(restore.revision,()=>selected.value);
 await next.verify();
 // Preparation may revoke the grant after the initial use admission. The
 // production lock starts immediately but waits for the tracked reader to end.
 const target={workspaceId:extra.namespaceId,projectId:parent.projectId,labBookId:extra.labBookId};
 const preparing=projectCollectionReader(app,client,async()=>{});readers.push(preparing);let bookLock,prepared=false;
 await assert.rejects(preparing.use(target,undefined,()=>assert.fail('revoked preparation reached the reader'),{prepare:async()=>{
  prepared=true;bookLock=new LabBookAccessSession(app,client,storage,extra.labBookId,async()=>{}).lock();
  // Let the lock's asynchronous parent check finish; do not await its active-reader drain here.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.session(client).get('book:'+parent.projectId+':'+extra.labBookId).locked,true);
 }}),error=>error.code==='ACCESS_LOCKED'&&error.projectId===parent.projectId&&error.labBookId===extra.labBookId);
 await bookLock;assert.equal(prepared,true);await preparing.close();
 await call(parent.projectId+'/lab-books/'+extra.labBookId+'/access/unlock');
 // A parent revoked inside the read callback must prevent its value escaping.
 const consuming=projectCollectionReader(app,client,async()=>{});readers.push(consuming);let parentLock,consumed=false;
 await assert.rejects(consuming.use(target,undefined,()=>{
  consumed=true;parentLock=app.lock(client,parent.projectId);
  assert.equal(app.session(client).get(parent.projectId).locked,true);return 'Must not be published';
 }),error=>error.code==='ACCESS_LOCKED'&&error.projectId===parent.projectId);
 await parentLock;assert.equal(consumed,true);await consuming.close();
 await assert.rejects(next.verify(),{code:'ACCESS_LOCKED'});
 await next.close();assert.ok(bookKeys.every(value=>value.every(byte=>byte===0)));
});
