import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {buildPublication,renderPublication} from '../src/publication.js';
import {newElement} from '../src/web/composition-tree.js';
import {createRegion,assignRegion} from '../src/web/website-regions.js';
import {researchReference} from '../src/web/research-reference.js';
import {defaultPageLayout} from '../src/web/website-layouts.js';
import {websitePreviewSource} from '../src/website-preview-source.js';
import {ResearchRecords,recordRevision,recordRevisions} from '../src/research.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {workspaceSaveRequest} from '../src/web/workspace-edits.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {MediaStore} from '../src/media.js';

async function fixture(t,configure=()=>{}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-preview-draft-')),book=upgradeNotebook(sampleNotebook());
 book.website.home.sections=[];
 const seed=book.entries[0];book.entries=Array.from({length:42},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Record '+i,body:'Original '+i,attachments:[],figures:[],relations:[]}));
 configure(book);
 const f=await encryptedFixture(directory,book),etag=(await f.workspace.outline()).etag;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,book,etag,request:draft=>({...workspaceSaveRequest(book,draft,recordRevisions(book)),baseEtag:etag})};
}

const options=designTarget=>({designTarget,workspaceContent:true,singlePage:true});
function comparePage(context,draft,target){
 const expected=buildPublication(draft,options(target)),actual=renderPublication(context,options(target));
 assert.deepEqual(actual.files,expected.files);assert.deepEqual(actual.pages,expected.pages);
 return actual;
}
async function tracedSource(f,command,target,allowed){
 const record=ResearchCatalogue.prototype.record,read=ResearchCatalogue.prototype.read,loaded=[];
 ResearchCatalogue.prototype.record=async function(id,...args){assert.ok(allowed.includes(id),'Unexpected original read '+id);loaded.push(id);return record.call(this,id,...args);};
 ResearchCatalogue.prototype.read=()=>{throw Error('Canvas loaded the complete workspace');};
 try{return {loaded,...await websitePreviewSource(f.workspace,command,{designTarget:target})};}
 finally{ResearchCatalogue.prototype.record=record;ResearchCatalogue.prototype.read=read;}
}

test('empty home edits load no originals; a selected record loads only its original and exact unsaved edits',async t=>{
 const f=await fixture(t),draft=structuredClone(f.book);draft.website.title='Preview title';draft.projects[0].share=false;
 const command=f.request(draft);assert.equal(command.changes.length,0);assert.ok(!JSON.stringify(command).includes('Original 1'));
 let result=await tracedSource(f,command,'home',[]);comparePage(result.context,draft,'home');assert.deepEqual(result.loaded,[]);assert.equal(result.context.entries.length,0);assert.throws(()=>renderPublication(result.context),{code:'INVALID'});
 draft.entries[0].share=false;const target='entry:'+draft.entries[1].id;
 result=await tracedSource(f,f.request(draft),target,[draft.entries[0].id,draft.entries[1].id]);comparePage(result.context,draft,target);
 assert.deepEqual(result.context.entries.map(e=>e.id),[draft.entries[1].id]);
 assert.deepEqual((await f.workspace.read()).book,f.book);assert.equal((await f.workspace.outline()).etag,f.etag);
});

test('concurrent saves do not substitute new originals into an older unsaved website draft',async t=>{
 const f=await fixture(t),draft=structuredClone(f.book),record=f.book.entries[1];draft.website.footer='Uncommitted footer';
 await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,body:'Later original'}}]},{compact:true});
 const latest=(await f.workspace.outline()).etag;assert.notEqual(latest,f.etag);
 const target='entry:'+record.id,result=await tracedSource(f,f.request(draft),target,[record.id]);
 comparePage(result.context,draft,target);assert.equal(result.context.entries[0].body,record.body);assert.equal((await f.workspace.outline()).etag,latest);
});

test('preview validates changed, removed and new record identities and protects workspace metadata',async t=>{
 const f=await fixture(t),draft=structuredClone(f.book);draft.entries.splice(2,1);draft.entries.push({...structuredClone(draft.entries[0]),id:randomUUID(),title:'New draft only'});
 const target='entry:'+draft.entries.at(-1).id;
 const result=await tracedSource(f,f.request(draft),target,[f.book.entries[2].id]);comparePage(result.context,draft,target);
 const preview=command=>websitePreviewSource(f.workspace,command,{designTarget:target});
 for(const command of [{...f.request(draft),workspaceId:randomUUID()}, {...f.request(draft),removed:[{id:randomUUID(),expectedRevision:'0'.repeat(64)}]}, {...f.request(draft),changes:[{...f.request(draft).changes[0],expectedRevision:'0'.repeat(64)}]}])await assert.rejects(preview(command),error=>['WORKSPACE_CHANGED','RECORD_CHANGED'].includes(error.code));
 for(const command of [{...f.request(draft),response:'outline'},{...f.request(draft),metadata:{id:randomUUID()}},{...f.request(draft),projects:[{id:randomUUID(),share:true,logoId:null}]},{...f.request(draft),changes:[{...f.request(draft).changes[0],record:{...draft.entries.at(-1),body:34}}]}])await assert.rejects(preview(command),{code:'INVALID'});
 for(const designTarget of [null,42,{},'entry:'+randomUUID()])await assert.rejects(websitePreviewSource(f.workspace,f.request(draft),{designTarget}),{code:'INVALID'});
 assert.equal((await f.workspace.outline()).etag,f.etag);
});

test('filtered collections and shared regions select originals before loading, with stable counts and destinations',async t=>{
 const f=await fixture(t),draft=structuredClone(f.book);
 draft.website.home.sections=[{...newElement('records',randomUUID),filter:{projectId:null,tag:'',limit:2}},newElement('projects',randomUUID)];
 const region=createRegion(draft.website,'sidebar','Related',{makeId:randomUUID});region.sections=[{...newElement('link',randomUUID),label:'Other record',href:'entry:'+draft.entries[40].id}];assignRegion(draft.website,'*','sidebar',region.id);
 const expected=buildPublication(draft,options('home'));
 // All dates are equal; the shared ordering contract breaks ties by record ID.
 const order=[...draft.entries].sort((a,b)=>a.id.localeCompare(b.id,'en')).slice(0,2).map(e=>e.id);
 const result=await tracedSource(f,f.request(draft),'home',[]);comparePage(result.context,draft,'home');
 assert.deepEqual(result.context.recordCards.map(r=>r.id).sort(),order.sort());assert.equal(result.loaded.length,0);assert.match(expected.files.get('index.html'),/42 records/);assert.ok(expected.files.get('index.html').includes('entries/'+draft.entries[40].id+'.html'));
});

test('replacement project pages and unassigned hidden collections do not read default records',async t=>{
 const f=await fixture(t),draft=structuredClone(f.book),target='project:'+draft.projects[0].id;
 draft.website.layouts.push({...defaultPageLayout(target),placement:'replace',sections:[{...newElement('heading',randomUUID),title:'Custom project'}]});
 const other=createRegion(draft.website,'sidebar','Unused',{makeId:randomUUID});other.sections=[newElement('records',randomUUID)];
 const result=await tracedSource(f,f.request(draft),target,[]);comparePage(result.context,draft,target);assert.deepEqual(result.loaded,[]);
});

test('original project and lab-book pages use authenticated cards without reading record bodies',async t=>{
 const f=await fixture(t),draft=structuredClone(f.book);
 draft.website.home.sections=[newElement('records',randomUUID)];
 for(const target of ['project:'+draft.projects[0].id,'notebook:'+draft.notebooks[0].id]){
  const ids=draft.entries.filter(r=>r.notebookId===draft.notebooks[0].id).map(r=>r.id).sort(),result=await tracedSource(f,f.request(draft),target,[]);
  assert.equal(result.loaded.length,0);assert.deepEqual(result.context.recordCards.map(r=>r.id).sort(),ids.slice(0,24));
  const window=result.context.collectionPages.find(p=>p.key==='body'),query=new URLSearchParams({collection:'body',cards:window.nextCursor}).toString();
  const next=await websitePreviewSource(f.workspace,f.request(draft),{designTarget:target,collections:[{key:'body',definition:window.definition,query}]});
  assert.deepEqual(next.context.recordCards.map(r=>r.id).sort(),ids.slice(24));assert.equal(next.context.collectionPages.find(p=>p.key==='body').nextCursor,null);
  const output=renderPublication(result.context,options(target));assert.match([...output.files].find(([name])=>name.endsWith('.html'))[1],/data-collection-next/);
 }
});

test('cancelled previews stop before loading originals',async t=>{
 const f=await fixture(t),command=f.request(f.book),controller=new AbortController();controller.abort();
 await assert.rejects(websitePreviewSource(f.workspace,command,{designTarget:'home',signal:controller.signal}),{name:'AbortError'});
});

test('a page previews from an actual corpus beyond the legacy envelope without reading unrelated bodies',async t=>{
 const f=await fixture(t),records=new ResearchRecords(f.workspace,{});
 for(let start=0;start<f.book.entries.length;start+=10){
  const changed=f.book.entries.slice(start,start+10).map(record=>({...record,body:'Retained observations. '.repeat(2600)}));
  const saved=await records.save({workspaceId:f.book.id,changes:changed.map(record=>({id:record.id,expectedRevision:recordRevision(f.book.entries.find(r=>r.id===record.id)),record}))},{recordIds:changed.map(r=>r.id)});
  f.book.entries.splice(start,changed.length,...saved.book.entries);
 }
 const outline=await f.workspace.outline(),snapshot=await f.workspace.catalogue(store=>store.snapshot());
 assert.ok(snapshot.bytes>2*1024*1024);
 const record=f.book.entries[7],target='entry:'+record.id,command={...f.request(f.book),baseEtag:outline.etag};
 const result=await tracedSource(f,command,target,[record.id]);
 assert.deepEqual(result.context.entries.map(r=>r.id),[record.id]);assert.equal(result.context.entries[0].body,record.body);assert.deepEqual(result.loaded,[record.id]);
 assert.ok(renderPublication(result.context,options(target)).files.get('entries/'+record.id+'.html').includes('Retained observations.'));
});

test('exact research links and reverse workflow journeys retain destinations without loading their bodies',async t=>{
 const f=await fixture(t,book=>{
  const [current,method,run,comparison]=book.entries;
  current.relations=[{id:randomUUID(),type:'Uses method',role:'uses-method',target:{workspaceId:book.id,kind:'record',id:method.id,revision:recordRevision(method)},label:method.title}];
  run.type='run';run.relations=[{id:randomUUID(),type:'Run / take of',role:'run-of',target:{workspaceId:book.id,kind:'record',id:current.id},label:current.title}];
  comparison.relations=[{id:randomUUID(),type:'Compares',role:'compares',target:{workspaceId:book.id,kind:'record',id:current.id,revision:recordRevision(current)},label:current.title}];
 });
 const [current,method,run,comparison]=f.book.entries,target='entry:'+current.id;
 let result=await tracedSource(f,f.request(f.book),target,[current.id,run.id,comparison.id]);
 const output=comparePage(result.context,f.book,target).files.get('entries/'+current.id+'.html');
 assert.ok(output.includes('entries/'+method.id+'.html'));assert.match(output,/Runs and takes/);assert.match(output,/Compared in/);
 // A legacy cached summary lacks a canonical revision. Only referenced targets
 // are allowed to fall back to originals, and the selected original is reused.
 const queryDocuments=ResearchCatalogue.prototype.queryDocuments;
 ResearchCatalogue.prototype.queryDocuments=async function*(...args){for await(const value of queryDocuments.apply(this,args))yield {...value,revision:null};};
 try{
  result=await tracedSource(f,f.request(f.book),target,[current.id,method.id,run.id,comparison.id]);
  comparePage(result.context,f.book,target);assert.equal(result.loaded.filter(id=>id===current.id).length,1);assert.equal(result.loaded.filter(id=>id===method.id).length,1);
 }finally{ResearchCatalogue.prototype.queryDocuments=queryDocuments;}
});

test('shared research media and hidden ancestors select only visible dependencies',async t=>{
 const f=await fixture(t),media=new MediaStore(f.workspace.root,f.vault),asset=await media.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="teal"/></svg>'),'image'),mediaId=asset.id;
 const previous=f.book.entries[4],saved=await new ResearchRecords(f.workspace,media).save({workspaceId:f.book.id,changes:[{id:previous.id,expectedRevision:recordRevision(previous),record:{...previous,attachments:[{...asset,caption:'Selected media',alt:'Selected media',transcript:'',share:false}]}}]},{recordIds:[previous.id]});
 f.book.entries[4]=saved.book.entries[0];const request=draft=>({...f.request(draft),baseEtag:saved.etag});
 const draft=structuredClone(f.book),record=draft.entries[4],sidebar=createRegion(draft.website,'sidebar','Research media',{makeId:randomUUID});
 sidebar.sections=[{...newElement('media',randomUUID),entryId:record.id,attachmentId:mediaId}];assignRegion(draft.website,'home','sidebar',sidebar.id);
 const hidden={...newElement('container',randomUUID),show:false};draft.website.home.sections=[hidden,{...newElement('records',randomUUID),parentId:hidden.id}];
 const result=await tracedSource(f,request(draft),'home',[record.id]);assert.deepEqual(result.loaded,[record.id]);assert.equal(result.context.website.regions[0].sections[0].attachmentId,mediaId);
 const without=structuredClone(draft);without.website.design.regions.definitions[0].sections[0].show=false;
 const empty=await tracedSource(f,request(without),'home',[]);assert.deepEqual(empty.loaded,[]);
});

test('rich-text revision links resolve from summaries and stale or removed targets stay excluded',async t=>{
 const f=await fixture(t),draft=structuredClone(f.book),record=draft.entries[6],reference={workspaceId:draft.id,kind:'record',id:record.id,revision:recordRevision(record)};
 draft.website.home.sections=[{...newElement('text',randomUUID),format:'rich',body:'Retained method',richText:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Retained method',marks:[{type:'link',attrs:{href:researchReference(reference),title:'',target:'_self',nofollow:false}}]}]}]}}];
 const result=await tracedSource(f,f.request(draft),'home',[]);const html=comparePage(result.context,draft,'home').files.get('index.html');assert.ok(html.includes('entries/'+record.id+'.html'));
 draft.entries[6].body='New draft method';
 const stale=await tracedSource(f,f.request(draft),'home',[record.id]);const changed=comparePage(stale.context,draft,'home').files.get('index.html');assert.ok(!changed.includes('entries/'+record.id+'.html'));
 draft.entries.splice(6,1);const removed=await tracedSource(f,f.request(draft),'home',[record.id]);comparePage(removed.context,draft,'home');assert.ok(!removed.context.entryDestinations.some(e=>e.id===record.id));
});

test('indexed previews inspect only selected summaries as the unrelated corpus grows',async t=>{
 for(const count of [65,650]){
  const f=await fixture(t,book=>{
   const seed=book.entries[0];book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Observation '+i,body:'Unrelated original '+i,sections:[],tags:i%3?[]:['selected']}));
  });
  const draft=structuredClone(f.book),current=draft.entries[30],target='entry:'+current.id;
  const members=ResearchCatalogue.prototype.members,queries=ResearchCatalogue.prototype.queryDocuments;let inspected=0;
  ResearchCatalogue.prototype.members=()=>{throw Error('Page preview enumerated the whole corpus');};
  ResearchCatalogue.prototype.queryDocuments=async function*(...args){for await(const value of queries.apply(this,args)){inspected++;yield value;}};
  try{
   let start=performance.now(),result=await tracedSource(f,f.request(draft),target,[current.id]);
   comparePage(result.context,draft,target);assert.equal(inspected,3);assert.equal(result.context.browseRecords.length,3);assert.equal(result.context.previewCounts.total,count);
   t.diagnostic(JSON.stringify({records:count,target:'entry',summaries:inspected,previewMs:Math.round(performance.now()-start)}));
   inspected=0;draft.website.home.sections=[{...newElement('records',randomUUID),filter:{projectId:null,tag:'',limit:2}},newElement('projects',randomUUID)];
   start=performance.now();result=await tracedSource(f,f.request(draft),'home',[]);comparePage(result.context,draft,'home');
   assert.equal(inspected,2);assert.equal(result.context.recordCards.length,2);assert.equal(result.context.entryDestinations.length,2);
   t.diagnostic(JSON.stringify({records:count,target:'home',summaries:inspected,previewMs:Math.round(performance.now()-start)}));
  }finally{ResearchCatalogue.prototype.members=members;ResearchCatalogue.prototype.queryDocuments=queries;}
 }
});

test('unsaved additions, moves, removals, dates and links retain exact page counts and navigation',async t=>{
 const f=await fixture(t,book=>book.notebooks.push({...structuredClone(book.notebooks[0]),id:randomUUID(),title:'Other book'})),draft=structuredClone(f.book),selected=draft.entries[4];
 draft.website.home.sections=[{...newElement('records',randomUUID),filter:{projectId:null,tag:'picked',limit:2}},newElement('projects',randomUUID)];
 draft.entries[0].tags=['picked'];draft.entries[0].occurredOn='2029-01-01';
 draft.entries[1].tags=['picked'];draft.entries[1].occurredOn={kind:'unknown'};
 draft.entries[3].notebookId=draft.notebooks[1].id;
 draft.entries.splice(5,1);draft.entries.push({...structuredClone(selected),id:randomUUID(),title:'Unsaved later record',tags:['picked'],occurredOn:'2030-01-01'});
 const command=f.request(draft),allowed=[...command.changes.map(c=>c.id).filter(id=>f.book.entries.some(r=>r.id===id)),...command.removed.map(c=>c.id)];
 for(const target of ['home','entry:'+selected.id,'entry:'+draft.entries.at(-1).id,'notebook:'+draft.notebooks[1].id]){
  const result=await tracedSource(f,command,target,[...allowed,selected.id]);comparePage(result.context,draft,target);
  assert.equal(result.context.previewCounts.total,draft.entries.length);
 }
 // Unknown-date placement and ties use the same order as actual publication.
 draft.entries[0].occurredOn={kind:'range',from:'2028-01-01',to:'2028-02-01',estimated:true};
 const result=await tracedSource(f,f.request(draft),'home',allowed);comparePage(result.context,draft,'home');
});
