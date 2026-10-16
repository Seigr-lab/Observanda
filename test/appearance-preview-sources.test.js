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
import {ResearchRecords,recordRevision} from '../src/research.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {appearancePreviewSource,appearancePreviewChoices,appearancePreviewPage} from '../src/appearance-preview.js';
import {AppearancePreviewSessions} from '../src/appearance-preview-sessions.js';
import {publicationOwnerId} from '../src/publication-owner-identities.js';
import {newElement} from '../src/web/composition-tree.js';
import {MediaStore} from '../src/media.js';
import {WorkspaceFonts} from '../src/workspace-fonts.js';
import {AppError} from '../src/errors.js';
import {defaultEditionRecord} from '../src/web/publication-selection.js';

async function fixture(t,{count=65,edition=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-appearance-owners-')),base=upgradeNotebook(sampleNotebook()),seed=base.entries[0],sources=[];
 t.after(async()=>{for(const source of sources)clearVault(source.vault);await rm(directory,{recursive:true,force:true});});
 base.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'First owner '+i,body:'Saved observation '+i,share:false,attachments:[],figures:[],sections:[],relations:[]}));
 for(const title of ['First owner','Second owner']){
  const book=structuredClone(base);book.id=randomUUID();book.title=title;book.entries.forEach((record,i)=>record.title=title+' '+i);
  if(sources.length){const target=sources[0].book.entries.at(-1);book.entries[2].relations=[{id:randomUUID(),label:target.title,type:'Related to',target:{workspaceId:sources[0].book.id,kind:'record',id:target.id}}];}
  const source=await encryptedFixture(path.join(directory,title),book);sources.push({...source,book});
 }
 const host=upgradeNotebook(sampleNotebook());host.id=randomUUID();host.entries=[];host.projects=[];host.notebooks=[];host.pages=[];
 host.website.home.sections=[{...newElement('records',randomUUID),filter:{projectId:null,tag:'',limit:0}}];
 host.website.researchSources=sources.map(({book})=>({workspaceId:book.id,projectIds:[book.projects[0].id],selection:{defaultShare:false,includeProjects:[book.projects[0].id],records:[{id:book.entries[0].id,share:false,attachments:[]}]}}));
 if(edition)host.website.researchSources[0].edition={version:1,records:[{...defaultEditionRecord(sources[0].book.entries[3],recordRevision(sources[0].book.entries[3])),body:false}]};
 const f=await encryptedFixture(path.join(directory,'Host'),host);sources.push({...f,book:host});let allowed=true,opened=0,closed=0;
 const sourceReader=async()=>{opened++;return {async use(id,snapshotId,consume){if(!allowed)throw new AppError('ACCESS_LOCKED');const source=sources.find(source=>source.book.id===id);assert.ok(source);return source.workspace.catalogue(async store=>{const revision=snapshotId??await store.head(),snapshot=await store.snapshot(revision);return {value:await consume(store,snapshot,{snapshotId:revision,storage:source.workspace,owner:{workspaceId:id,projectId:null,labBookId:null}})};});},async verify(){if(!allowed)throw new AppError('ACCESS_LOCKED');},async close(){closed++;}};};
 return {...f,host,sources:sources.slice(0,2),sourceReader,revoke:()=>{allowed=false;},handles:()=>({opened,closed}),command:{workspaceId:host.id,etag:(await f.workspace.outline()).etag,appearance:host.appearance,mode:'website'},id:(source,record)=>publicationOwnerId(host.id,source.book.id,'record',record.id)};
}

test('appearance pages combine selected owners with stable identities, bounded choices and no private originals',async t=>{
 const f=await fixture(t),original=ResearchCatalogue.prototype.record,reads=[];ResearchCatalogue.prototype.record=function(id,...args){reads.push({owner:this.workspace.vault.id,id});return original.call(this,id,...args);};t.after(()=>ResearchCatalogue.prototype.record=original);
 const options={sourceReader:f.sourceReader,sourceSnapshots:new Map()},choice=await appearancePreviewSource(f.workspace,{...f.command,mode:'auto'},options);assert.equal(choice.source,'website');
 let cursor=null;const pages=[];do{const result=await appearancePreviewChoices(f.workspace,f.command,{...options,cursor});assert.ok(result.pages.length<=40);pages.push(...result.pages);cursor=result.nextCursor;}while(cursor);
 const records=pages.filter(page=>page.path.startsWith('entries/'));assert.equal(records.length,128);assert.equal(new Set(records.map(page=>page.path)).size,128);assert.deepEqual(reads,[]);
 const home=await appearancePreviewPage(f.workspace,f.command,'index.html',options);assert.equal(home.publicationCounts.total,128);assert.equal(home.recordCards.length,24);assert.deepEqual(reads,[]);
 const seen=[];let query='';do{const result=(await appearancePreviewPage(f.workspace,f.command,'browse.html'+query,options)).browsePage;assert.ok(result.records.length<=40);seen.push(...result.records.map(record=>record.id));query=result.nextCursor?'?'+new URLSearchParams({cursor:result.nextCursor}):null;}while(query);
 assert.equal(seen.length,128);assert.equal(new Set(seen).size,128);assert.deepEqual(reads,[]);
 const selected=f.sources[1].book.entries.at(-1),id=f.id(f.sources[1],selected),page=await appearancePreviewPage(f.workspace,f.command,'entries/'+id+'.html',options);
 assert.equal(page.entries[0].body,selected.body);assert.equal(page.entries[0].title,selected.title);assert.equal(page.entries[0].id,id);assert.deepEqual(reads.map(read=>read.id),[selected.id]);
 const target=f.sources[0].book.entries.at(-1),targetId=f.id(f.sources[0],target),linked=await appearancePreviewPage(f.workspace,f.command,'entries/'+targetId+'.html',options);
 assert.deepEqual(linked.referencePage.recordIds,[f.id(f.sources[1],f.sources[1].book.entries[2])]);
 assert.deepEqual(page.referencePage.recordIds,[],'equal record IDs in another namespace do not borrow backlinks');
 for(const source of f.sources)await assert.rejects(appearancePreviewPage(f.workspace,f.command,'entries/'+f.id(source,source.book.entries[0])+'.html',options),{code:'NOT_FOUND'});
 assert.equal(f.handles().opened,f.handles().closed);
});

test('appearance sessions pin external revisions and reauthorize cached pages and assets',async t=>{
 const f=await fixture(t),client={},otherClient={},source=f.sources[0],record=source.book.entries[1],mediaStore=new MediaStore(source.workspace);
 const media=await mediaStore.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>'),'image'),updated={...record,attachments:[{...media,caption:'Shared image',alt:'Blue square',transcript:'',share:true}]};
 await new ResearchRecords(source.workspace,mediaStore).save({workspaceId:source.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:updated}]},{receipt:true});
 const sessions=new AppearancePreviewSessions(),session=await sessions.create(f.workspace,f.command,{client,sourceReader:f.sourceReader,media:new MediaStore(f.workspace),fonts:new WorkspaceFonts(f.workspace)}),key=session.baseUrl.split('/')[2];
 const name='entries/'+f.id(source,record)+'.html',before=await sessions.file(key,name,{client}),mediaId=publicationOwnerId(f.host.id,source.book.id,'media',media.id),resource='_assets/'+Buffer.from(name).toString('base64url')+'/media/'+mediaId+'.png';
 assert.ok(before.content.includes(resource));assert.ok((await sessions.file(key,resource,{client})).content);
 await assert.rejects(sessions.file(key,name,{client:otherClient}),{code:'NOT_FOUND'});await assert.rejects(sessions.file(key,resource,{client:otherClient}),{code:'NOT_FOUND'});await assert.rejects(sessions.choices(key,{client:otherClient}),{code:'NOT_FOUND'});
 const persisted=await source.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),record.id);return store.record(record.id,row.revision);});
 await new ResearchRecords(source.workspace,mediaStore).save({workspaceId:source.book.id,changes:[{id:record.id,expectedRevision:recordRevision(persisted),record:{...persisted,title:'Changed later',body:'Changed later'}}]},{receipt:true});
 assert.deepEqual(await sessions.file(key,name,{client}),before);
 const choices=await sessions.choices(key,{path:name,client});assert.equal(choices.pages[0].title,record.title);
 const asset=/_assets\/[^" ]+\/styles\.css/.exec(before.content)[0];await sessions.file(key,asset,{client});
 f.revoke();for(const path of [name,asset,resource])await assert.rejects(sessions.file(key,path,{client}),{code:'ACCESS_LOCKED'});await assert.rejects(sessions.choices(key,{client}),{code:'ACCESS_LOCKED'});
 assert.equal(f.handles().opened,f.handles().closed);
});


test('edition page choices and sparse browse read summaries without hydrating selected originals',async t=>{
 const f=await fixture(t,{count:6,edition:true}),original=ResearchCatalogue.prototype.record,reads=[];
 ResearchCatalogue.prototype.record=function(id,...args){reads.push(id);return original.call(this,id,...args);};t.after(()=>ResearchCatalogue.prototype.record=original);
 const options={sourceReader:f.sourceReader,sourceSnapshots:new Map()};
 const choices=await appearancePreviewChoices(f.workspace,f.command,options);assert.equal(choices.pages.filter(page=>page.path.startsWith('entries/')).length,10);
 const browse=await appearancePreviewPage(f.workspace,f.command,'browse.html?q=First+owner+3',options);assert.deepEqual(browse.browsePage.records.map(record=>record.title),['First owner 3']);assert.deepEqual(reads,[]);
 const selected=f.sources[0].book.entries[3],page=await appearancePreviewPage(f.workspace,f.command,'entries/'+f.id(f.sources[0],selected)+'.html',options);assert.equal(page.entries[0].body,'');assert.ok(reads.includes(selected.id));assert.equal(f.handles().opened,f.handles().closed);
});
