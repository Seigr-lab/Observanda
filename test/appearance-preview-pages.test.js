import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {ResearchCatalogue,catalogueDescriptor} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {clearVault} from '../src/encryption.js';
import {appearancePreviewPage,appearancePreviewChoices} from '../src/appearance-preview.js';
import {AppearancePreviewSessions} from '../src/appearance-preview-sessions.js';
import {DesignCandidates} from '../src/design-candidates.js';
import {MediaStore} from '../src/media.js';
import {WorkspaceFonts} from '../src/workspace-fonts.js';
import {buildPublication,renderPublication,verifyPublication} from '../src/publication.js';
import {newElement} from '../src/web/composition-tree.js';
import {createRegion,assignRegion} from '../src/web/website-regions.js';
import {plainRichText} from '../src/web/rich-text-model.js';
import {researchReference} from '../src/web/research-reference.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {digest,serialize} from '../src/storage-format.js';

async function fixture(t,book){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-appearance-pages-')),f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,directory,book,command:{workspaceId:book.id,etag:(await f.workspace.outline()).etag,appearance:book.appearance,mode:'website'}};
}
const dependencies=f=>({media:new MediaStore(f.workspace.root,f.vault),fonts:new WorkspaceFonts(f.workspace)});

test('preview page choices and original reads stay bounded as the published corpus exceeds the old preview cache envelope',async t=>{
 const original=ResearchCatalogue.prototype.record,decode=ResearchCatalogue.prototype.decode,read=ResearchCatalogue.prototype.read;
 let measuring=false,bodies=[],summaries=0;
 ResearchCatalogue.prototype.record=function(id,...args){if(measuring)bodies.push(id);return original.call(this,id,...args);};
 ResearchCatalogue.prototype.decode=function(table,id,...args){if(measuring&&table==='state'&&id.startsWith('record-summary:'))summaries++;return decode.call(this,table,id,...args);};
 ResearchCatalogue.prototype.read=function(...args){assert.equal(measuring,false,'Preview cannot request the complete book');return read.apply(this,args);};
 t.after(()=>{ResearchCatalogue.prototype.record=original;ResearchCatalogue.prototype.decode=decode;ResearchCatalogue.prototype.read=read;});
 for(const count of [80,800]){
  const book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];book.entries=[];
  book.website.home.sections=[{...newElement('records',randomUUID),filter:{projectId:null,tag:'',limit:3}}];
  const f=await fixture(t,book),service=new ResearchRecords(f.workspace,{}),records=[];
  for(let offset=0;offset<count;offset+=40){
   const changes=Array.from({length:Math.min(40,count-offset)},(_,i)=>{
    const record={...structuredClone(seed),id:randomUUID(),title:'Published '+(offset+i),body:'Observation '+(offset+i)+' '+'.'.repeat(44000),share:true,sections:[],attachments:[],figures:[],relations:[]};records.push(record);return {id:record.id,expectedRevision:null,record};
   });
   await service.save({workspaceId:book.id,changes},{receipt:true});
  }
  f.command.etag=(await f.workspace.outline()).etag;
  let cursor=null;const seen=[];measuring=true;
  do{
   bodies=[];summaries=0;const page=await appearancePreviewChoices(f.workspace,f.command,{cursor});
   assert.ok(page.pages.length<=40);assert.ok(summaries<=40);assert.deepEqual(bodies,[]);
   seen.push(...page.pages.filter(p=>p.path.startsWith('entries/')).map(p=>p.path));cursor=page.nextCursor;
  }while(cursor);
  assert.deepEqual(seen,records.map(r=>'entries/'+r.id+'.html'));
  bodies=[];const home=await appearancePreviewPage(f.workspace,f.command,'index.html');assert.deepEqual(bodies,[]);assert.equal(home.recordCards.length,3);assert.equal(home.publicationCounts.total,count);
  bodies=[];const last=records.at(-1),entry=await appearancePreviewPage(f.workspace,f.command,'entries/'+last.id+'.html');assert.deepEqual(bodies,[last.id]);assert.equal(entry.entries[0].body,last.body);
  assert.ok(JSON.stringify(entry).length<55000);measuring=false;
  t.diagnostic(JSON.stringify({records:count,sourceProseCharacters:count*44000,choicePage:40,homeBodies:0,entryBodies:1,entryContextBytes:Buffer.byteLength(JSON.stringify(entry))}));
 }
});

test('page rendering matches publication including exact links, backlinks, regions and page-specific resources; eviction regenerates pinned pages',async t=>{
 const book=upgradeNotebook(sampleNotebook()),first=book.entries[0],second=book.entries[1];first.share=true;second.share=true;
 const hidden={...structuredClone(first),id:randomUUID(),title:'PRIVATE_RECORD_TITLE',body:'PRIVATE_RECORD_BODY',share:false,figures:[],attachments:[],relations:[]};book.entries.push(hidden);
 second.type='run';second.relations=[{id:randomUUID(),type:'Run / take of',role:'run-of',target:{workspaceId:book.id,kind:'record',id:first.id},label:first.title}];
 second.sections=[{id:randomUUID(),title:'Exact observations',body:'The retained observations.'}];
 first.body=plainRichText('Exact section destination');first.body.content[0].content[0].marks=[{type:'link',attrs:{href:researchReference({workspaceId:book.id,kind:'record',id:second.id,selector:{version:1,kind:'section',id:second.sections[0].id}}),title:'',target:'_self',nofollow:false}}];
 const footer=createRegion(book.website,'footer','Closing credits',{makeId:randomUUID});footer.sections=[{...newElement('text',randomUUID),body:'Closing credits',style:{width:'full',surface:'none',align:'start',space:'normal',bodyAlign:'end'}}];assignRegion(book.website,'home','footer',footer.id);
 const f=await fixture(t,book),expected=buildPublication(book),sessions=new AppearancePreviewSessions({cache:new DesignCandidates({maxEntries:1})}),result=await sessions.create(f.workspace,f.command,dependencies(f)),id=result.baseUrl.split('/')[2];
 for(const page of expected.pages){
  const context=await appearancePreviewPage(f.workspace,f.command,page.path),actual=renderPublication(context,{emitBrowse:false});
  if(page.path==='browse.html'){
   const list=html=>/<ol class="book-record-index"[\s\S]*?<\/ol>/.exec(html)?.[0];assert.equal(list(actual.files.get(page.path)),list(expected.files.get(page.path)));
   const footer=html=>/<footer[\s\S]*?<\/footer>/.exec(html)?.[0];assert.equal(footer(actual.files.get(page.path)),footer(expected.files.get(page.path)));
  }else assert.equal(actual.files.get(page.path),expected.files.get(page.path),page.path);
  assert.throws(()=>verifyPublication(actual),{code:'INVALID'});
 }
 const page='entries/'+first.id+'.html',before=await sessions.file(id,page),asset=/_assets\/[^" ]+\/styles\.css/.exec(before.content)[0];
 assert.ok((await sessions.file(id,asset)).content.includes('--accent:'));assert.ok(before.content.includes('record-section-'+second.sections[0].id));assert.ok(before.content.includes('Runs and takes'));
 await sessions.file(id,'entries/'+second.id+'.html');
 await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:first.id,expectedRevision:recordRevision(first),record:{...first,title:'Newer revision title'}}]},{receipt:true});
 assert.deepEqual(await sessions.file(id,page),before);
 for(const invalid of ['entries/'+hidden.id+'.html','../index.html','_assets/invalid/styles.css'])await assert.rejects(sessions.file(id,invalid),{code:'NOT_FOUND'});
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(appearancePreviewPage(f.workspace,f.command,page,{signal:cancelled.signal}),{name:'AbortError'});
 const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'backup')),{vault:f.vault}),restored=new Workspace(backup,f.vault);
 assert.deepEqual(await appearancePreviewPage(restored,f.command,page),await appearancePreviewPage(f.workspace,f.command,page));
 const uncached=new AppearancePreviewSessions({cache:new DesignCandidates({maxBytes:1})}),tiny=await uncached.create(f.workspace,f.command,dependencies(f));
 assert.deepEqual((await uncached.file(tiny.baseUrl.split('/')[2],page)).content.replaceAll(tiny.baseUrl,result.baseUrl),before.content);assert.equal(uncached.cache.size,0);
 sessions.clear();await assert.rejects(sessions.file(id,page),{code:'NOT_FOUND'});
});

test('older flat snapshots and pre-descriptor summaries retain page order and fall back without rewriting history',async t=>{
 const book=upgradeNotebook(sampleNotebook());for(const entry of book.entries)entry.share=true;
 const f=await fixture(t,book);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const manifest=await store.manifest();
  for(const row of manifest.records){
   const slot='record-summary:'+row.id+':'+row.summaryRevision,value=store.decode('state',slot,(await store.db.get('SELECT payload FROM state WHERE slot=$1',slot)).payload);
   delete value.publicationDescriptor;row.summaryRevision=digest(serialize(value));const prior='record-summary:'+row.id+':'+row.summaryRevision;
   await store.db.run('INSERT INTO state VALUES ($1,$2)',prior,store.encode('state',prior,value));
  }
  await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',f.command.etag,manifest),f.command.etag);
 }));
 const choices=await appearancePreviewChoices(f.workspace,f.command);assert.deepEqual(choices.pages.filter(p=>p.path.startsWith('entries/')).map(p=>p.path),book.entries.map(r=>'entries/'+r.id+'.html'));
 const expected=buildPublication(book);
 for(const record of book.entries){const path='entries/'+record.id+'.html',context=await appearancePreviewPage(f.workspace,f.command,path);assert.equal(renderPublication(context,{emitBrowse:false}).files.get(path),expected.files.get(path));}
 assert.equal((await f.workspace.outline()).etag,f.command.etag);
});

test('cached publication references are verified against their originals',async t=>{
 const book=upgradeNotebook(sampleNotebook()),f=await fixture(t,book),record=book.entries[0];
 await f.workspace.catalogue(store=>store.verify(catalogueDescriptor(book)));
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const row=await store.member(await store.snapshot(),record.id),slot='record-summary:'+record.id+':'+row.summaryRevision;
  const value=store.decode('state',slot,(await store.db.get('SELECT payload FROM state WHERE slot=$1',slot)).payload);
  value.publicationDescriptor.title='Incorrect derived title';
  await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',store.encode('state',slot,value),slot);
 }));
 await assert.rejects(appearancePreviewPage(f.workspace,f.command,'entries/'+record.id+'.html'),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(f.workspace.catalogue(store=>store.verify(catalogueDescriptor(book))),{code:'CATALOGUE_DAMAGED'});
});

test('page assets cannot expose other records and separately styled preview sessions do not share styles',async t=>{
 const book=upgradeNotebook(sampleNotebook());for(const record of book.entries)record.share=true;
 const f=await fixture(t,book),deps=dependencies(f),media=await deps.media.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>'),'image'),first=book.entries[0],second=book.entries[1];
 const updated={...first,attachments:[{...media,caption:'Shared image',alt:'Blue square',transcript:'',share:true}]};
 await new ResearchRecords(f.workspace,deps.media).save({workspaceId:book.id,changes:[{id:first.id,expectedRevision:recordRevision(first),record:updated}]},{receipt:true});
 f.command.etag=(await f.workspace.outline()).etag;
 const sessions=new AppearancePreviewSessions(),firstSession=await sessions.create(f.workspace,f.command,deps),secondSession=await sessions.create(f.workspace,{...f.command,appearance:{...book.appearance,accent:'#771133'}},deps),a=firstSession.baseUrl.split('/')[2],b=secondSession.baseUrl.split('/')[2];
 const path='entries/'+first.id+'.html',key=Buffer.from(path).toString('base64url'),resource='_assets/'+key+'/media/'+media.id+'.png';
 assert.ok((await sessions.file(a,path)).content.includes(resource));assert.ok((await sessions.file(a,resource)).content);
 await assert.rejects(sessions.file(a,'_assets/'+Buffer.from('entries/'+second.id+'.html').toString('base64url')+'/media/'+media.id+'.png'),{code:'NOT_FOUND'});
 const css='_assets/'+key+'/styles.css';assert.ok((await sessions.file(a,css)).content.includes('--accent:'+book.appearance.accent));assert.ok((await sessions.file(b,css)).content.includes('--accent:#771133'));
 const choices=await appearancePreviewChoices(f.workspace,f.command);assert.equal(choices.nextCursor,null);
 for(const cursor of ['invalid',Buffer.from(JSON.stringify({offset:0,after:null,etag:'0'.repeat(64),websiteId:null})).toString('base64url'),Buffer.from(JSON.stringify({offset:-1,after:null,etag:f.command.etag,websiteId:null})).toString('base64url')])await assert.rejects(appearancePreviewChoices(f.workspace,f.command,{cursor}),{code:'INVALID'});
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(sessions.file(a,path,{signal:cancelled.signal}),{name:'AbortError'});
});
