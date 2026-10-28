import {WebsiteSites} from '../src/website-sites.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {appearancePreviewPage,appearancePreviewChoices} from '../src/appearance-preview.js';
import {renderPublication} from '../src/publication.js';
import {hasPrivateText} from '../src/privacy.js';
import {sectionItems} from '../src/web/website-model.js';
import {createRegion,assignRegion} from '../src/web/website-regions.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {defaultFeed} from '../src/web/website-feed-model.js';
import {appearanceFeedParameters} from '../src/appearance-preview-feeds.js';

async function fixture(t,count,{limit=0,tag='',regions=false,feed=null}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-preview-collections-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),title:'Observation '+i,share:true,body:'Public body '+i,occurredOn:'2026-10-09',tags:[i===count-1?'rare':'common'],sections:[],figures:[],attachments:[],relations:[]}));
 book.entries.push({...structuredClone(seed),id:randomUUID(),title:'PRIVATE_CARD',body:'PRIVATE_BODY',share:false,sections:[],figures:[],attachments:[],relations:[]});
 const section={id:'records',kind:'records',title:'Selected observations',show:true,layout:'inherit',filter:{projectId:null,tag,limit},...(feed?{feed}:{})};book.website.home.sections=[section];
 if(regions){
  const sidebar=createRegion(book.website,'sidebar','Related observations',{makeId:randomUUID});sidebar.sections=[{...structuredClone(section),filter:{projectId:null,tag:'rare',limit:0}}];
  assignRegion(book.website,'home','sidebar',sidebar.id);
  book.website.layouts.push({target:'home',showHeading:true,heading:'',description:'',placement:'after',sections:[{...structuredClone(section),filter:{projectId:null,tag:'common',limit:3}}]});
 }
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,book,directory,command:{workspaceId:book.id,etag:(await f.workspace.outline()).etag,websitePin:(await new WebsiteSites(f.workspace).read(null)).websitePin,appearance:book.appearance,mode:'website'}};
}
const get=(f,path='index.html')=>appearancePreviewPage(f.workspace,f.command,path);
const next=(path,page,field='nextCursor')=>path+'?'+new URLSearchParams({collection:page.key,cards:page[field]});
const collection=(context,key='section:records')=>context.collectionPages.find(page=>page.key===key);

test('authored feed counts and visitor queries preserve the selected set through pinned continuation',async t=>{
 const f=await fixture(t,90,{limit:37,feed:{...defaultFeed('records'),pageSize:29,visitorFilters:true,visitorOrder:true}});
 const first=collection(await get(f)),continued=(page,direction='nextCursor')=>{
  const params=appearanceFeedParameters(page.visitor);params.set('collection',page.key);params.set('cards',page[direction]);return 'index.html?'+params;
 };
 assert.equal(first.recordIds.length,29);const second=collection(await get(f,continued(first)));assert.equal(second.recordIds.length,8);assert.equal(second.nextCursor,null);
 assert.deepEqual(collection(await get(f,continued(second,'previousCursor'))).recordIds,first.recordIds);
 const restyled={...f.command,appearance:{...f.command.appearance,accent:'#334455'},websitePin:Object.fromEntries(Object.entries(f.command.websitePin).reverse())};
 assert.deepEqual(collection(await appearancePreviewPage(f.workspace,restyled,continued(first))).recordIds,second.recordIds);
 await assert.rejects(appearancePreviewPage(f.workspace,{...restyled,websitePin:{...restyled.websitePin,websiteRevision:'0'.repeat(64)}},continued(first)));
 const reversed=collection(await get(f,'index.html?feed=section:records&feedOrder=oldest'));
 assert.deepEqual(reversed.recordIds,f.book.entries.slice(0,37).reverse().slice(0,29).map(r=>r.id));
 const tail=collection(await get(f,continued(reversed)));assert.deepEqual(tail.recordIds,f.book.entries.slice(0,8).reverse().map(r=>r.id));assert.equal(tail.nextCursor,null);
 await assert.rejects(get(f,continued(reversed).replace('oldest','newest')),{code:'INVALID'});
 const noMatches=await get(f,'index.html?feed=section:records&feedTag=rare');assert.deepEqual(collection(noMatches).recordIds,[]);
 assert.ok(renderPublication(noMatches).files.get('index.html').includes('data-public-feed'));
 const sparse=collection(await get(f,'index.html?feed=section:records&feedSearch=Observation+36'));assert.deepEqual(sparse.recordIds,[f.book.entries[36].id]);
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(appearancePreviewPage(f.workspace,f.command,'index.html',{signal:cancelled.signal}),{name:'AbortError'});
});

test('unlimited collections traverse every public card at tenfold growth with bounded bodies, summaries and responses',async t=>{
 const original=ResearchCatalogue.prototype.record,decode=ResearchCatalogue.prototype.decode;let measuring=false,bodies=0,summaries=0;
 ResearchCatalogue.prototype.record=function(...args){if(measuring)bodies++;return original.apply(this,args);};
 ResearchCatalogue.prototype.decode=function(table,id,...args){if(measuring&&table==='state'&&id.startsWith('record-summary:'))summaries++;return decode.call(this,table,id,...args);};
 t.after(()=>{ResearchCatalogue.prototype.record=original;ResearchCatalogue.prototype.decode=decode;});
 for(const count of [80,800]){
  const f=await fixture(t,count),seen=[];let request='index.html',first,second;measuring=true;
  do{
   summaries=0;const context=await get(f,request),page=collection(context);first??=page;if(seen.length===24)second=page;
   assert.ok(context.recordCards.length<=24);assert.ok(summaries<=24);assert.equal(bodies,0);assert.ok(Buffer.byteLength(JSON.stringify(context))<65000);
   assert.deepEqual(sectionItems(context.website.home.sections[0],context).map(r=>r.id),page.recordIds);
   let html;try{html=renderPublication(context,{emitBrowse:false}).files.get('index.html');}
   catch(error){
    if(error.code==='PRIVACY')t.diagnostic(JSON.stringify({records:count,completed:seen.length,cursorPrivacy:context.collectionPages.map(item=>({key:item.key,previous:!!item.previousCursor&&hasPrivateText(item.previousCursor),next:!!item.nextCursor&&hasPrivateText(item.nextCursor)}))}));
    throw error;
   }
   assert.ok(!html.includes('PRIVATE_CARD'));assert.equal((html.match(/<article class="publication-card/g)??[]).length,page.recordIds.length);
   seen.push(...page.recordIds);request=page.nextCursor?next('index.html',page):null;
  }while(request);
  assert.deepEqual(seen,f.book.entries.filter(r=>r.share).map(r=>r.id));
  assert.deepEqual(collection(await get(f,next('index.html',second,'previousCursor'))).recordIds,first.recordIds);
  const notebook=await get(f,'notebooks/'+f.book.entries[0].notebookId+'.html');assert.equal(collection(notebook,'body').recordIds.length,24);
  const project=await get(f,'projects/'+f.book.notebooks.find(n=>n.id===f.book.entries[0].notebookId).projectId+'.html');assert.equal(collection(project,'body').recordIds.length,24);
  measuring=false;t.diagnostic(JSON.stringify({records:count,cardsPerPage:24,originalReads:bodies}));
 }
});

test('sparse collections keep their continuation and separate layout, sidebar and body choices',async t=>{
 const f=await fixture(t,600,{regions:true});let request='index.html',page,windows=0;
 do{
  const context=await get(f,request);page=collection(context,'sidebar:records');windows++;
  assert.ok(page.scanned<=256);assert.equal(collection(context,'section:records').recordIds.length,24);assert.equal(collection(context,'layout:records').recordIds.length,3);
  assert.equal(context.website.regions.find(r=>r.kind==='sidebar').sections.length,1);
  const html=renderPublication(context,{emitBrowse:false}).files.get('index.html');assert.ok(html.includes('sidebar-section-records'));
  if(page.nextCursor)assert.ok(html.includes('No matches in this part of the index.'));
  request=page.nextCursor?next('index.html',page):null;
 }while(request);
 assert.equal(windows,3);assert.deepEqual(page.recordIds,[f.book.entries[599].id]);
 const previous=collection(await get(f,next('index.html',page,'previousCursor')),'sidebar:records');assert.ok(previous.nextCursor);assert.equal(previous.recordIds.length,0);
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(appearancePreviewPage(f.workspace,f.command,'index.html',{signal:cancelled.signal}),{name:'AbortError'});
});

test('author selection limits, snapshot and page bindings survive edits and verified backup without replaying skipped cards',async t=>{
 const f=await fixture(t,90,{limit:37}),first=collection(await get(f)),request=next('index.html',first),last=collection(await get(f,request));
 assert.equal(first.recordIds.length,24);assert.equal(last.recordIds.length,13);assert.equal(last.nextCursor,null);
 assert.deepEqual(collection(await get(f,next('index.html',last,'previousCursor'))).recordIds,first.recordIds);
 assert.equal((await appearancePreviewChoices(f.workspace,f.command,{path:request})).pages[0].path,request);
 for(const bad of ['index.html?collection=section:records','index.html?cards=invalid','index.html?collection=section:records&cards=invalid',request+'&collection=body',request.replace('section%3Arecords','body'),request.replace('index.html','projects/'+f.book.projects[0].id+'.html')])await assert.rejects(get(f,bad));
 const record=f.book.entries[24];await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Changed title'}}]},{receipt:true});
 assert.equal((await get(f,request)).recordCards[0].title,record.title);
 await assert.rejects(get({...f,command:{...f.command,etag:(await f.workspace.outline()).etag}},request),{code:'INVALID'});
 const restored=new Workspace(await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'backup')),{vault:f.vault}),f.vault);
 assert.deepEqual(collection(await get({...f,workspace:restored},request)).recordIds,last.recordIds);
});
