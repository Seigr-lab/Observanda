import {privateDirectory,digest,serialize} from '../src/storage.js';
import {MediaStore} from '../src/media.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {upgradeNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {clearVault} from '../src/encryption.js';
import {publicationSourceMedia} from '../src/publication-source-media.js';
import {defaultEditionRecord} from '../src/web/publication-selection.js';

test('source media pages span records and attachments without original reads and honor edition consent',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-source-media-'));let fixture;
 try{
  const book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];book.id=id();book.entries=Array.from({length:3},(_,n)=>({...structuredClone(seed),id:id(),title:'Observation '+n,body:'Private prose sentinel',share:false,attachments:Array.from({length:n===2?0:27},(_,i)=>({id:id(),kind:'image',share:i!==1,caption:'Evidence '+n+' '+i,alt:'Description',transcript:'Private transcript sentinel'})),figures:[],relations:[]}));
  fixture=await encryptedFixture(directory,{...book,entries:[]});
  const png=await readFile(new URL('../src/preview-assets/image.png',import.meta.url));
  for(const record of book.entries)for(const attachment of record.attachments){const folder=await privateDirectory(fixture.workspace.root,'.observanda/media/'+attachment.id),metadata={id:attachment.id,kind:'image',extension:'png',mime:'image/png',bytes:png.length,sha256:digest(png),originalBytes:png.length,originalSha256:digest(png)};await fixture.workspace.writeFile(path.join(folder,'asset.json'),serialize(metadata));await fixture.workspace.writeFile(path.join(folder,'public.png'),png);await fixture.workspace.writeFile(path.join(folder,'original'),png);}
  await new ResearchRecords(fixture.workspace,new MediaStore(fixture.workspace)).save({workspaceId:book.id,changes:book.entries.map(record=>({id:record.id,expectedRevision:null,record}))});
  const head=await fixture.workspace.outline(),host={workspaceId:id()},source={workspaceId:book.id,projectIds:[book.projects[0].id],selection:{defaultShare:false,includeProjects:[book.projects[0].id],records:[{id:book.entries[0].id,share:true,attachments:[{id:book.entries[0].attachments[1].id,share:true},{id:book.entries[0].attachments[2].id,share:false}]}]}};
  const pinned={snapshotId:head.etag,storage:fixture.workspace,owner:{workspaceId:book.id,projectId:book.projects[0].id,labBookId:null},projectNamespaceId:book.id},query={workspaceId:book.id,snapshotId:head.etag,source,search:'',cursor:null,backward:false};
  await fixture.workspace.catalogue(async store=>{
   const snapshot=await store.snapshot(head.etag),original=store.record;store.record=()=>{throw Error('Media listing read a record original');};
   const run=change=>publicationSourceMedia(store,snapshot,pinned,host,{...query,...change}),pages=[];let cursor=null;
   do{const page=await run({cursor});pages.push(page);assert.ok(page.items.length<=12);cursor=page.nextCursor;}while(cursor);
   const all=pages.flatMap(page=>page.items);assert.equal(all.length,52);assert.equal(new Set(all.map(item=>item.key)).size,52);assert.ok(all.some(item=>item.sourceAttachmentId===book.entries[0].attachments[1].id));assert.equal(all.some(item=>item.sourceAttachmentId===book.entries[0].attachments[2].id),false);assert.equal(all.some(item=>item.sourceAttachmentId===book.entries[1].attachments[1].id),false);
   for(let i=pages.length-1;i>0;i--)assert.deepEqual((await run({cursor:pages[i].previousCursor})).items,pages[i-1].items);
   assert.equal(JSON.stringify(all).includes('Private prose sentinel'),false);assert.equal(JSON.stringify(all).includes('Private transcript sentinel'),false);assert.ok(all.every(item=>item.entryId!==book.entries.find(record=>record.title===item.record.title).id&&item.asset.id!==item.sourceAttachmentId));
   assert.equal((await run({search:'Evidence 1 26'})).items[0].sourceAttachmentId,book.entries[1].attachments[26].id);
   const changed=structuredClone(source);changed.selection.records=[];await assert.rejects(run({source:changed,cursor:pages[0].nextCursor}),{code:'PUBLICATION_SELECTION_CURSOR'});
   await assert.rejects(run({search:'Changed search',cursor:pages[0].nextCursor}),{code:'PUBLICATION_SELECTION_CURSOR'});
   store.record=original;const raw=await original.call(store,book.entries[0].id,(await store.member(snapshot,book.entries[0].id)).revision),choice=defaultEditionRecord(raw,recordRevision(raw));choice.attachments=[raw.attachments[1].id];
   const limited=structuredClone(source);limited.selection.includeProjects=[];limited.selection.records=[{id:raw.id,share:true,attachments:[]}];limited.edition={version:1,records:[choice]};
   const edition=await run({source:limited});assert.equal(edition.items.length,1);assert.equal(edition.items[0].sourceAttachmentId,raw.attachments[1].id);
   limited.edition.records=[{...choice,include:false}];limited.edition.history=[choice];const history=await run({source:limited});assert.equal(history.items.length,1);assert.equal(history.items[0].sourceAttachmentId,raw.attachments[1].id);assert.notEqual(history.items[0].entryId,edition.items[0].entryId);
  });
  assert.equal((await fixture.workspace.outline()).etag,head.etag);
 }finally{if(fixture)clearVault(fixture.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await rm(directory,{recursive:true,force:true});}
});
