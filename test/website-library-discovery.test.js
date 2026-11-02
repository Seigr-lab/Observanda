import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {seedEligibleWebsiteOwner} from '../src/website-library-discovery.js';

test('pre-existing unplaced grants are discovered across books and resume from a durable window',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-library-discovery-'));
 const book=sampleNotebook(),first=book.notebooks[0],second={...first,id:randomUUID(),title:'Instrument log'},closed={...first,id:randomUUID(),title:'Private book',share:false};
 book.notebooks.push(second,closed);
 const example=book.entries[1],entry=(n,owner,share)=>({...example,id:randomUUID(),title:'Sample '+n,notebookId:owner.id,share,
  sections:[{id:randomUUID(),title:'Withheld section',body:'PRIVATE-CANARY',share:false}]});
 book.entries=Array.from({length:41},(_,i)=>entry(i,i%2?second:first,true));
 book.entries.push(entry(41,closed,true),entry(42,first,false));
 const {workspace,vault}=await encryptedFixture(directory,book);
 t.after(async()=>{await closeIdleMutationFiles();await clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});});
 const store=new WebsiteFileStore(workspace),reader={
  async use(namespace,_revision,consume){
   assert.equal(namespace,book.id);
   return {value:await workspace.catalogue(async catalogue=>{
    const snapshotId=await catalogue.head();return consume(catalogue,await catalogue.snapshot(snapshotId),{snapshotId,storage:workspace});
   })};
  }
 };
 const firstPass=new AbortController(),write=store.writeControl.bind(store);
 store.writeControl=async(name,value,options)=>{
  await write(name,value,options);
  if(name.includes('/eligible-entries-')&&value.complete===false)firstPass.abort();
 };
 await assert.rejects(seedEligibleWebsiteOwner(store,reader,book.id,{signal:firstPass.signal}),{name:'AbortError'});
 const before=await store.library({limit:100});assert.equal(before.items.length,40);
 await seedEligibleWebsiteOwner(store,reader,book.id);
 const after=await store.library({limit:100});assert.equal(after.items.length,41);
 const visible=new Map(after.items.map(row=>[row.recordId,row]));
 for(const row of before.items)assert.equal(visible.get(row.recordId).revision,row.revision);
 assert.equal(visible.has(book.entries[41].id),false);assert.equal(visible.has(book.entries[42].id),false);
 const site=await store.create({name:'Discovery proof'}),source=visible.get(book.entries[40].id);
 const placed=await store.insertSource(site.site.id,{expectedRevision:site.site.revision,sourceId:source.id});
 assert.match(placed.html,/Sample 40/);assert.doesNotMatch(placed.html,/Withheld section|PRIVATE-CANARY/);
 await seedEligibleWebsiteOwner(store,{use:()=>assert.fail('Completed discovery reopened research')},book.id);
});
