import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {newElement} from '../src/web/composition-tree.js';
import {defaultFeed,orderFeed} from '../src/web/website-feed-model.js';
import {createRegion,assignRegion} from '../src/web/website-regions.js';
import {websitePreviewSource as pinnedPreviewSource} from '../src/website-preview-source.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {workspaceSaveRequest} from '../src/web/workspace-edits.js';
import {recordRevisions} from '../src/research.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {renderPublication} from '../src/publication.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {Workspace} from '../src/storage.js';
import {WebsitePreviewRecords} from '../src/website-preview-records.js';

async function websitePreviewSource(workspace,command,options){
 const {websitePin}=await websiteWorkspace(workspace,workspace.websiteId??null).outline();
 return pinnedPreviewSource(workspace,command,{websitePin,...options});
}

async function fixture(t,count=601,configure=()=>{}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-canvas-collections-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 // Equal-date tag-filter work has a reproducible ID order, independent of UUID randomness.
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:'00000000-0000-4000-8000-'+String(i).padStart(12,'0'),title:'Observation '+String(i).padStart(4,'0'),body:'Exact original '+i,occurredOn:'2026-10-'+String(1+i%9).padStart(2,'0'),sections:[],attachments:[],figures:[],relations:[],tags:i%2?['odd']:['even'],share:true}));
 const feed=(size,tag='',limit=0)=>({...newElement('records',randomUUID),filter:{projectId:null,tag,limit},feed:{...defaultFeed('records'),pageSize:size,visitorFilters:true,visitorOrder:true,visitorView:true}});
 book.website.home.sections=[feed(10),feed(17,'odd',81)];
 const sidebar=createRegion(book.website,'sidebar','Independent view',{makeId:randomUUID});sidebar.sections=[feed(7,'even')];assignRegion(book.website,'home','sidebar',sidebar.id);
 configure(book);
 const f=await encryptedFixture(directory,book),etag=(await f.workspace.outline()).etag;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,directory,book,command:draft=>({...workspaceSaveRequest(book,draft,recordRevisions(book)),baseEtag:etag})};
}
const navigation=(page,cursor,visitor=page.visitor)=>{
 const params=new URLSearchParams();if(cursor){params.set('collection',page.key);params.set('cards',cursor);}
 if(visitor){params.set('feed',page.key);for(const name of ['search','tag','type','order'])if(visitor[name])params.set('feed'+name[0].toUpperCase()+name.slice(1),visitor[name]);}
 return {key:page.key,definition:page.definition,query:params.toString()};
};
const ids=records=>records.map(record=>record.id);

test('canvas feeds retain independent windows over growing saved and unsaved records, with reversible author limits',async t=>{
 const f=await fixture(t),draft=structuredClone(f.book);draft.entries.splice(4,1);draft.entries[2].occurredOn='2030-01-01';draft.entries[2].tags=['odd'];draft.entries.push({...structuredClone(draft.entries[0]),id:randomUUID(),title:'New unsaved observation',occurredOn:'2031-01-01'});
 const command=f.command(draft),load=collections=>websitePreviewSource(f.workspace,command,{designTarget:'home',collections});
 const original=ResearchCatalogue.prototype.record,documents=ResearchCatalogue.prototype.queryDocuments,allowed=new Set([...command.changes,...command.removed].filter(c=>f.book.entries.some(r=>r.id===c.id)).map(c=>c.id));let read=0;
 ResearchCatalogue.prototype.record=function(id,...args){assert.ok(allowed.has(id),'A feed loaded an original record');return original.call(this,id,...args);};
 ResearchCatalogue.prototype.queryDocuments=async function*(...args){for await(const value of documents.apply(this,args)){read++;yield value;}};
 try{
  let {context}=await load([]);assert.ok(context.recordCards.length<=34);assert.equal(context.entries.length,0);assert.ok(read<140,'Initial preview read '+read+' record summaries');const keys=draft.website.home.sections.map(s=>'section:'+s.id),first=context.collectionPages.find(p=>p.key===keys[0]),limited=context.collectionPages.find(p=>p.key===keys[1]);
  const publicIds=new Set(f.book.entries.filter(record=>record.share).map(record=>record.id)),expected=orderFeed(draft.entries.filter(record=>publicIds.has(record.id)),'records','newest');
  assert.deepEqual(context.previewCounts,{total:expected.length,notebooks:Object.fromEntries(draft.notebooks.map(book=>[book.id,expected.filter(record=>record.notebookId===book.id).length]))});
  assert.ok(!context.recordCards.some(record=>record.id===draft.entries.at(-1).id),'A website draft cannot grant publication consent to a new research record');
  assert.deepEqual(first.recordIds,ids(expected.slice(0,10)));assert.deepEqual(limited.recordIds,ids(expected.filter(r=>r.tags.includes('odd')).slice(0,17)));
  const second=navigation(first,first.nextCursor);({context}=await load([second]));assert.deepEqual(context.collectionPages.find(p=>p.key===keys[0]).recordIds,ids(expected.slice(10,20)));assert.deepEqual(context.collectionPages.find(p=>p.key===keys[1]).recordIds,limited.recordIds);
  const backwards=navigation(limited,null,{...limited.visitor,order:'oldest'}),selection=expected.filter(r=>r.tags.includes('odd')).slice(0,81).reverse(),seen=[];let current=backwards;
  for(;;){
   ({context}=await load([second,current]));const page=context.collectionPages.find(p=>p.key===keys[1]);seen.push(...page.recordIds);assert.deepEqual(context.collectionPages.find(p=>p.key===keys[0]).recordIds,ids(expected.slice(10,20)));
   if(!page.nextCursor){assert.equal(page.recordIds.length,13);current=navigation(page,page.previousCursor);break;}current=navigation(page,page.nextCursor);
  }
  assert.deepEqual(seen,ids(selection));({context}=await load([second,current]));assert.deepEqual(context.collectionPages.find(p=>p.key===keys[1]).recordIds,ids(selection.slice(51,68)));
  // Presentation edits retain position; author selection edits restart only
  // the changed feed, without applying a stale selection's cursor.
  draft.website.title='Edited design';let result=await websitePreviewSource(f.workspace,f.command(draft),{designTarget:'home',collections:[second,current]});assert.deepEqual(result.context.collectionPages.find(p=>p.key===keys[0]).recordIds,ids(expected.slice(10,20)));
  draft.website.home.sections[1].filter.tag='even';result=await websitePreviewSource(f.workspace,f.command(draft),{designTarget:'home',collections:[second,current]});assert.deepEqual(result.context.collectionPages.find(p=>p.key===keys[0]).recordIds,ids(expected.slice(10,20)));assert.deepEqual(result.context.collectionPages.find(p=>p.key===keys[1]).recordIds,ids(expected.filter(r=>r.tags.includes('even')).slice(0,17)));
  for(const collections of [null,[second,second],[{...second,query:second.query+'&unknown=x'}],[{...second,query:'collection='+encodeURIComponent(first.key)+'&cards=invalid'}]])await assert.rejects(load(collections),{code:'INVALID'});
  const {websitePin}=await websiteWorkspace(f.workspace).outline();
  await assert.rejects(pinnedPreviewSource(f.workspace,command,{websitePin:{...websitePin,websiteId:randomUUID()},designTarget:'home',collections:[second]}),{code:'INVALID'});
  assert.throws(()=>renderPublication(context),{code:'INVALID'});
 }finally{ResearchCatalogue.prototype.record=original;ResearchCatalogue.prototype.queryDocuments=documents;}
});

test('canvas continuation preserves presentation edits and restarts after source selection changes',async t=>{
 const f=await fixture(t,61),command=f.command(f.book),load=(request,collections=[])=>websitePreviewSource(f.workspace,request,{designTarget:'home',collections}),key='section:'+f.book.website.home.sections[0].id;
 const expected=orderFeed(f.book.entries.filter(record=>record.share),'records','newest');
 const initial=(await load(command)).context.collectionPages.find(page=>page.key===key),next=navigation(initial,initial.nextCursor);
 assert.deepEqual(initial.recordIds,ids(expected.slice(0,10)));assert.ok(initial.nextCursor);
 const restyled=structuredClone(command);restyled.metadata.website={...structuredClone(f.book.website),title:'A different presentation'};
 const continued=(await load(restyled,[next])).context.collectionPages.find(page=>page.key===key);
 assert.deepEqual(continued.recordIds,ids(expected.slice(10,20)));assert.equal(continued.definition,initial.definition);
 const selected={...restyled,selection:{includeProjects:[],records:[{id:expected[0].id,share:false,attachments:[]}]}};
 const selectedContext=(await load(selected,[next])).context,restarted=selectedContext.collectionPages.find(page=>page.key===key);
 assert.deepEqual(selectedContext.previewCounts,{total:expected.length-1,notebooks:Object.fromEntries(f.book.notebooks.map(book=>[book.id,expected.filter(record=>record.id!==expected[0].id&&record.notebookId===book.id).length]))});
 assert.notEqual(restarted.definition,initial.definition);assert.deepEqual(restarted.recordIds,ids(expected.slice(1,11)));assert.equal(restarted.previousCursor,null);
 const following=(await load(selected,[navigation(restarted,restarted.nextCursor)])).context.collectionPages.find(page=>page.key===key);
 assert.deepEqual(following.recordIds,ids(expected.slice(11,21)));assert.ok(!following.recordIds.includes(expected[0].id));
});

test('preview counts respect source consent, notebook moves and exclusions without reading or retaining every selected document',async t=>{
 const f=await fixture(t,6,book=>{
  const privateBook={...structuredClone(book.notebooks[0]),id:randomUUID(),title:'Private book',share:false};book.notebooks.push(privateBook);
  book.entries[0].share=false;for(const entry of book.entries.slice(3))entry.notebookId=privateBook.id;
 }),draft=structuredClone(f.book),publicId=draft.notebooks[0].id,privateId=draft.notebooks.at(-1).id;
 draft.entries[0].share=true; // A website edit cannot grant source consent.
 draft.entries[2].notebookId=privateId;draft.entries[3].notebookId=publicId;draft.entries[5].share=false;draft.entries.splice(1,1);
 const command=f.command(draft),controller=new AbortController();
 await f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),metadata={...snapshot.metadata,...command.metadata},records=new WebsitePreviewRecords(store,snapshot,metadata,command,{signal:controller.signal});await records.initialize();
  const retained=records.rows.size,queries=store.queryDocuments;store.queryDocuments=()=>{throw Error('Counts loaded record summaries');};
  try{
   const empty=Object.fromEntries(metadata.notebooks.map(book=>[book.id,0]));
   assert.deepEqual(await records.counts(),{total:1,notebooks:{...empty,[publicId]:1}});assert.equal(records.rows.size,retained);
   records.selection={includeProjects:[metadata.projects[0].id],records:[{id:f.book.entries[3].id,share:false,attachments:[]}]};
   assert.deepEqual(await records.counts(),{total:0,notebooks:empty});assert.equal(records.rows.size,retained);
   const member=store.member;let lookups=0;store.member=async function(...args){lookups++;const row=await member.apply(this,args);controller.abort();return row;};
   try{await assert.rejects(records.counts(),{name:'AbortError'});assert.equal(lookups,1);}finally{store.member=member;}
  }finally{store.queryDocuments=queries;}
 });
});

test('sparse feed filters and default record directories continue without retaining the corpus and restore under a fresh key',async t=>{
 const f=await fixture(t,601),command=f.command(f.book),target='notebook:'+f.book.notebooks[0].id,expected=ids(orderFeed(f.book.entries,'records','newest'));let collections=[],seen=[],last;
 for(;;){const {context}=await websitePreviewSource(f.workspace,command,{designTarget:target,collections});assert.ok(context.recordCards.length<=24);last=context.collectionPages.find(p=>p.key==='body');seen.push(...last.recordIds);if(!last.nextCursor)break;collections=[navigation(last,last.nextCursor)];}
 assert.deepEqual(seen,expected);assert.equal(last.recordIds.length,1);
 const home=await websitePreviewSource(f.workspace,command,{designTarget:'home'}),page=home.context.collectionPages.find(p=>p.key.startsWith('section:'));
 const query=navigation(page,null,{...page.visitor,search:'No such observation'}),sparse=await websitePreviewSource(f.workspace,command,{designTarget:'home',collections:[query]}),window=sparse.context.collectionPages.find(p=>p.key===page.key);
 assert.equal(window.scanned,256);assert.deepEqual(window.recordIds,[]);assert.ok(window.nextCursor);assert.ok(sparse.context.recordCards.length<=24);
 const output=renderPublication(sparse.context,{designTarget:'home',workspaceContent:true,singlePage:true});assert.match(output.files.get('index.html'),/No matches in this part of the feed/);
 const further=await websitePreviewSource(f.workspace,command,{designTarget:'home',collections:[navigation(window,window.nextCursor)]}),forward=further.context.collectionPages.find(p=>p.key===page.key);assert.equal(forward.scanned,256);assert.ok(forward.previousCursor);
 const back=await websitePreviewSource(f.workspace,command,{designTarget:'home',collections:[navigation(forward,forward.previousCursor)]});assert.equal(back.context.collectionPages.find(p=>p.key===page.key).previousCursor,null);
 const controller=new AbortController();controller.abort();await assert.rejects(websitePreviewSource(f.workspace,command,{designTarget:target,signal:controller.signal}),{name:'AbortError'});
 const access=await createAccess('','canvas collection recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const location=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'restored')),access,vault,f.vault),restored=new Workspace(location,vault),recovered=await websitePreviewSource(restored,command,{designTarget:'home'});
 assert.deepEqual(recovered.context.collectionPages.map(p=>p.recordIds),home.context.collectionPages.map(p=>p.recordIds));
 const next=home.context.collectionPages[0],restoredPage=recovered.context.collectionPages[0];
 const originalNext=await websitePreviewSource(f.workspace,command,{designTarget:'home',collections:[navigation(next,next.nextCursor)]}),restoredNext=await websitePreviewSource(restored,command,{designTarget:'home',collections:[navigation(restoredPage,restoredPage.nextCursor)]});
 assert.deepEqual(restoredNext.context.recordCards,originalNext.context.recordCards);
});
