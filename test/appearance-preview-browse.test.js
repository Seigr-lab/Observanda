import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {appearancePreviewPage,appearancePreviewChoices} from '../src/appearance-preview.js';
import {AppearancePreviewSessions} from '../src/appearance-preview-sessions.js';
import {MediaStore} from '../src/media.js';
import {WorkspaceFonts} from '../src/workspace-fonts.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {renderPublication} from '../src/publication.js';

async function fixture(t,count){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-preview-browse-')),book=sampleNotebook(),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:i===count-1?'End only':'Observation '+i,body:'Original body '+i,share:true,type:i%2?'run':'protocol',tags:[i%3?'field':'control'],occurredOn:'2026-09-'+String(i%28+1).padStart(2,'0'),sections:[],attachments:[],figures:[],relations:[]}));
 book.entries.push({...structuredClone(book.entries.at(-1)),id:randomUUID(),title:'PRIVATE_TITLE',share:false});
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,directory,book,command:{workspaceId:book.id,etag:(await f.workspace.outline()).etag,appearance:book.appearance,mode:'website'}};
}
const browse=(f,query='')=>appearancePreviewPage(f.workspace,f.command,'browse.html'+(query?'?'+query:''));
const request=(page,key='nextCursor')=>new URLSearchParams({...Object.fromEntries(new URLSearchParams(page.query)),cursor:page[key]}).toString();

test('public index pages and sparse searches keep bounded summary work at tenfold growth without original reads',async t=>{
 const read=ResearchCatalogue.prototype.record,decode=ResearchCatalogue.prototype.decode;let measuring=false,bodies=0,summaries=0;
 ResearchCatalogue.prototype.record=function(...args){if(measuring)bodies++;return read.apply(this,args);};
 ResearchCatalogue.prototype.decode=function(table,id,...args){if(measuring&&table==='state'&&id.startsWith('record-summary:'))summaries++;return decode.call(this,table,id,...args);};
 t.after(()=>{ResearchCatalogue.prototype.record=read;ResearchCatalogue.prototype.decode=decode;});
 for(const count of [80,800]){
  const f=await fixture(t,count);measuring=true;const seen=[];let query='',first,second;
  do{
   summaries=0;const context=await browse(f,query),page=context.browsePage;
   first??=page;if(seen.length===40)second=page;
   assert.ok(page.records.length<=40);assert.ok(summaries<=40);assert.equal(context.entryDestinations.length,0);assert.equal(bodies,0);
   assert.ok(Buffer.byteLength(JSON.stringify(context))<60000);seen.push(...page.records.map(r=>r.id));query=page.nextCursor?request(page):null;
  }while(query);
  assert.deepEqual(seen,f.book.entries.filter(r=>r.share).map(r=>r.id));
  assert.deepEqual((await browse(f,request(second,'previousCursor'))).browseRecords,first.records);
  const matching=[];query='q=End+only';let windows=0;
  do{
   summaries=0;const context=await browse(f,query),page=context.browsePage;windows++;
   assert.ok(summaries<=256);assert.equal(bodies,0);assert.equal(context.entryDestinations.length,0);matching.push(...page.records.map(r=>r.title));
   assert.ok(!JSON.stringify(context).includes('PRIVATE_TITLE'));query=page.nextCursor?request(page):null;
  }while(query);
  assert.deepEqual(matching,['End only']);assert.equal(windows,Math.ceil(count/256));measuring=false;
  t.diagnostic(JSON.stringify({records:count,rowsPerPage:40,sparseSearchWindows:windows,maxSearchSummaries:256,originals:bodies}));
 }
});

test('filtered continuations bind source, website and query; saved pages remain usable after edits and verified backup',async t=>{
 const f=await fixture(t,100),first=await browse(f),page=first.browsePage,next=request(page);
 const deps={media:new MediaStore(f.workspace.root,f.vault),fonts:new WorkspaceFonts(f.workspace)},sessions=new AppearancePreviewSessions(),session=await sessions.create(f.workspace,f.command,deps),id=session.baseUrl.split('/')[2];
 const content=await sessions.file(id,'browse.html?'+next);assert.ok(content.content.includes('Observation 40'));assert.ok(!content.content.includes('PRIVATE_TITLE'));
 const resource=/_assets\/[^" ]+\/public-book\.js/.exec(content.content)[0];assert.ok((await sessions.file(id,resource)).content.includes('matchesPublicRecord'));
 assert.equal((await appearancePreviewChoices(f.workspace,f.command,{path:'browse.html?'+next})).pages[0].path,'browse.html?'+next);
 for(const invalid of [next+'&q=other',next+'&tag=field','cursor=invalid','q=a&q=b','from=2026-02-30','unknown=x'])await assert.rejects(browse(f,invalid),{code:'INVALID'});
 const record=f.book.entries[40];await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Later title',share:false}}]},{receipt:true});
 await assert.rejects(browse({...f,command:{...f.command,etag:(await f.workspace.outline()).etag}},next),{code:'INVALID'});
 assert.equal((await browse(f,next)).browseRecords[0].title,record.title);
 const restored=new Workspace(await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'backup')),{vault:f.vault}),f.vault);
 assert.deepEqual((await browse({...f,workspace:restored},next)).browseRecords,(await browse(f,next)).browseRecords);
 const empty=await browse(f,'q=absent'),html=renderPublication(empty,{emitBrowse:false}).files.get('browse.html');assert.ok(html.includes('No matching records.'));assert.ok(html.includes('public-book.js'));assert.ok(html.includes('data-book-count>0<'));
 for(const query of ['tag=CONTROL','journey=methods','type=run','from=2026-09-20&to=2026-09-22']){
  const items=[];let current=query;do{const result=(await browse(f,current)).browsePage;items.push(...result.records);current=result.nextCursor?request(result):null;}while(current);
  const params=new URLSearchParams(query),expected=f.book.entries.filter(r=>r.share&&(!params.has('tag')||r.tags.includes('control'))&&(!params.has('journey')||r.type==='protocol')&&(!params.has('type')||r.type==='run')&&(!params.has('from')||r.occurredOn>=params.get('from')&&r.occurredOn<=params.get('to')));
  assert.deepEqual(items.map(r=>r.id),expected.map(r=>r.id));
 }
 const aborted=new AbortController();aborted.abort();await assert.rejects(appearancePreviewPage(f.workspace,f.command,'browse.html',{signal:aborted.signal}),{name:'AbortError'});
 sessions.clear();await assert.rejects(sessions.file(id,'browse.html?'+next),{code:'NOT_FOUND'});
});
