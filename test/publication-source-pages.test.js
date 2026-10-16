import {publicationSourceSections} from '../src/publication-source-sections.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {clearVault} from '../src/encryption.js';
import {publicationSourcePages} from '../src/publication-source-pages.js';
import {defaultEditionRecord} from '../src/web/publication-selection.js';

test('selected-source pages seek both directions, pin consent, search privately and retain historical destinations',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-source-pages-'));let fixture;
 try{
  const book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];book.id=id();book.entries=Array.from({length:300},(_,n)=>({...structuredClone(seed),id:id(),title:'Observation '+String(n).padStart(2,'0'),body:'Private body sentinel',share:false,attachments:[],figures:[],relations:[]}));
  book.entries[0].sections=[{id:id(),title:'Admitted section',body:'Selected prose'},{id:id(),title:'Hidden section',body:'Excluded prose'}];
  fixture=await encryptedFixture(directory,{...book,entries:[]});await new ResearchRecords(fixture.workspace,new MediaStore(fixture.workspace)).save({workspaceId:book.id,changes:book.entries.map(record=>({id:record.id,expectedRevision:null,record}))});
  const head=await fixture.workspace.outline(),host={workspaceId:id()},source={workspaceId:book.id,projectIds:[book.projects[0].id],selection:{defaultShare:false,includeProjects:[book.projects[0].id],records:[{id:book.entries[1].id,share:false,attachments:[]}]}};
  const pinned={snapshotId:head.etag,storage:fixture.workspace,owner:{workspaceId:book.id,projectId:book.projects[0].id,labBookId:null},projectNamespaceId:book.id};
  const query={workspaceId:book.id,snapshotId:head.etag,source,search:'',cursor:null,backward:false};
  await fixture.workspace.catalogue(async store=>{
   const snapshot=await store.snapshot(head.etag),read=store.record;let originals=0,summaries=0;const documents=store.queryDocuments;store.queryDocuments=async function*(...args){for await(const summary of documents.apply(store,args)){summaries++;yield summary;}};store.record=(...args)=>{originals++;return read.apply(store,args);};
   const run=change=>publicationSourcePages(store,snapshot,pinned,host,{...query,...change});
   const first=await run(),second=await run({cursor:first.nextCursor});assert.equal(first.items.length,25);assert.equal(second.items.length,25);assert.ok(second.nextCursor);assert.equal(first.previousCursor,null);assert.deepEqual((await run({cursor:second.previousCursor})).items,first.items);
   const all=[...first.items,...second.items];let cursor=second.nextCursor;while(cursor){const page=await run({cursor});all.push(...page.items);cursor=page.nextCursor;}assert.equal(all.length,299);assert.equal(new Set(all.map(item=>item.target)).size,299);assert.equal(first.items.some(item=>item.recordId===book.entries[1].id),false);assert.equal(JSON.stringify(first).includes('Private body sentinel'),false);assert.equal(originals,0);
   const search=await run({search:'Observation 38'});assert.equal(search.items.length,1);assert.equal(search.items[0].recordId,book.entries[38].id);assert.equal(originals,0);
   const beforeSearch=summaries,sparse=await run({search:'Private body sentinel'});assert.ok(summaries-beforeSearch<=257);assert.deepEqual(sparse.items,[]);assert.ok(sparse.nextCursor);const tailSearch=await run({search:'Private body sentinel',cursor:sparse.nextCursor});assert.deepEqual(tailSearch.items,[]);assert.equal(tailSearch.nextCursor,null);assert.equal(originals,0);
   await assert.rejects(run({search:'Changed search',cursor:first.nextCursor}),{code:'PUBLICATION_SELECTION_CURSOR'});
   const changed=structuredClone(source);changed.selection.records=[];await assert.rejects(run({source:changed,cursor:first.nextCursor}),{code:'PUBLICATION_SELECTION_CURSOR'});
   await assert.rejects(run({cursor:first.nextCursor.slice(0,-2)+'XX'}),{code:'PUBLICATION_SELECTION_CURSOR'});
   const controller=new AbortController();controller.abort();await assert.rejects(publicationSourcePages(store,snapshot,pinned,host,query,{signal:controller.signal}),{name:'AbortError'});
   const historySource=structuredClone(source),record=await read.call(store,book.entries[0].id,(await store.member(snapshot,book.entries[0].id)).revision),choice=defaultEditionRecord(record,recordRevision(record));historySource.edition={version:1,records:[],history:[{...choice,include:true}]};
   const selected=structuredClone(source),limited={...choice,sections:[record.sections[0].id]};selected.edition={version:1,records:[limited]};
   const sectionQuery={workspaceId:book.id,snapshotId:head.etag,source:selected,target:first.items.find(item=>item.recordId===record.id).target,offset:0};
   const sections=await publicationSourceSections(store,snapshot,pinned,host,sectionQuery);assert.equal(sections.total,1);assert.deepEqual(sections.items,[{id:'record-section-'+record.sections[0].id,title:'Admitted section'}]);assert.equal(JSON.stringify(sections).includes('Hidden section'),false);
   const excluded=structuredClone(selected);excluded.selection.records.push({id:record.id,share:false,attachments:[]});await assert.rejects(publicationSourceSections(store,snapshot,pinned,host,{...sectionQuery,source:excluded}),{code:'NOT_FOUND'});
   const tail=await run({source:historySource,backward:true});assert.equal(tail.items.length,25);assert.equal(tail.items.at(-1).revision,choice.revision);assert.notEqual(tail.items.at(-1).target,first.items.find(item=>item.recordId===record.id).target);
  });
  assert.equal((await fixture.workspace.outline()).etag,head.etag);
 }finally{if(fixture)clearVault(fixture.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await rm(directory,{recursive:true,force:true});}
});
