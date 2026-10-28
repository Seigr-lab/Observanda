import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {WebsiteResearch} from '../src/website-research.js';
import {populateImageEvidence} from './image-evidence-fixture.js';
import {WebsiteSites} from '../src/website-sites.js';
import {WebsiteDocumentStore} from '../src/website-document-store.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {emptyWebsiteSelection,websiteSelectionDraft} from '../src/web/website-selection.js';

for(const count of [65,650])test('website selections and media discovery stay bounded across '+count+' records',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-research-')),book=sampleNotebook(),template=book.entries[2],imageId=randomUUID();
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(template),id:randomUUID(),title:'Take '+String(i).padStart(3,'0'),share:i%2===0,body:'Unrelated private prose. '.repeat(20),sections:[],attachments:[{id:imageId,kind:'image',caption:'Capture '+i,alt:'',transcript:'',share:false}]}));
 // The same real evidence may be associated independently with many records.
 // Creation now verifies its retained bytes as well as the record references.
 const f=await encryptedFixture(directory,book,{populate:workspace=>populateImageEvidence(workspace,[imageId])}),service=new WebsiteResearch(f.workspace),sites=new WebsiteSites(f.workspace),site=await sites.read(null),outline=await f.workspace.outline(),base={workspaceId:book.id,snapshotId:outline.etag,websitePin:site.websitePin},projectId=book.notebooks.find(n=>n.id===template.notebookId).projectId;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const original=ResearchCatalogue.prototype.record,reads=[];
 t.mock.method(ResearchCatalogue.prototype,'read',()=>{throw Error('Full website workspace read');});
 t.mock.method(ResearchCatalogue.prototype,'record',function(id,...rest){reads.push(id);return original.call(this,id,...rest);});
 const started=performance.now(),summary=await service.run('summary',{...base,selection:emptyWebsiteSelection(),search:''});
 assert.equal(summary.entries,Math.ceil(count/2));assert.equal(summary.media,0);assert.deepEqual(reads,[]);
 const first=await service.run('content',{...base,projectId,search:'',cursor:null});assert.equal(first.items.length,10);assert.equal(first.total,count);
 const second=await service.run('content',{...base,projectId,search:'',cursor:first.nextCursor});assert.equal(second.offset,10);
 const reordered=Object.fromEntries(Object.entries({...base,websitePin:Object.fromEntries(Object.entries(base.websitePin).reverse()),projectId,search:'',cursor:first.nextCursor}).reverse());
 assert.deepEqual((await service.run('content',reordered)).items,second.items,'Equivalent JSON field order must not invalidate a content cursor');
 const back=await service.run('content',{...base,projectId,search:'',cursor:second.previousCursor});assert.deepEqual(back.items,first.items);assert.equal(back.offset,0);assert.equal(back.total,count);assert.deepEqual(reads,[]);
 await assert.rejects(service.run('content',{...base,projectId,search:'changed',cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
 const media=await service.run('media',{...base,search:'',cursor:null});assert.equal(media.items.length,12);assert.equal(reads.length,12);reads.length=0;
 const details=await service.run('record',{...base,recordId:book.entries[0].id});assert.equal(details.record.body,undefined);assert.deepEqual(details.record.attachments,book.entries[0].attachments);assert.deepEqual(reads,[book.entries[0].id]);reads.length=0;
 const selection={defaultShare:false,includeProjects:[projectId],records:[{id:book.entries[0].id,share:false,attachments:[]},{id:book.entries[1].id,share:null,attachments:[{id:book.entries[1].attachments[0].id,share:true}]}]};
 const proposed=await service.run('summary',{...base,selection,search:''});assert.equal(proposed.entries,Math.ceil(count/2)-1);assert.equal(proposed.media,0);assert.deepEqual(reads,[]);assert.deepEqual(proposed.selectionProjects,{[book.entries[0].id]:projectId,[book.entries[1].id]:projectId});
 // Site choices cannot grant publication permission to a private original.
 const command={workspaceId:book.id,baseEtag:outline.etag,websitePin:site.websitePin,metadata:{website:{...site.book.website,footer:'A reviewed footer'}},projects:[],changes:[],removed:[],selection};
 const beforeCommit=performance.now(),saved=await sites.save(null,command),commitMs=performance.now()-beforeCommit;assert.equal(saved.book.entries.length,0);assert.ok(reads.length<=1);assert.ok(commitMs<30000);
 const source=await f.workspace.catalogue(store=>store.snapshot(saved.etag));assert.equal(saved.book.website.footer,'A reviewed footer');assert.equal(saved.etag,outline.etag);
 const firstRecord=await f.workspace.catalogue(async store=>original.call(store,book.entries[0].id,(await store.member(source,book.entries[0].id)).revision));
 assert.equal(firstRecord.share,true);assert.equal(firstRecord.body,book.entries[0].body);
 const after=await service.run('summary',{workspaceId:book.id,snapshotId:saved.etag,websitePin:saved.websitePin,selection:saved.site.selection,search:''});assert.equal(after.entries,Math.ceil(count/2)-1);assert.equal(after.media,0);
 await assert.rejects(sites.save(null,command),{code:'CONFLICT'});
 // The old page remains tied to its exact saved selection after the new commit.
 assert.deepEqual((await service.run('content',{...base,projectId,search:'',cursor:null})).items,first.items);
 const before=await f.workspace.catalogue(async store=>({head:await store.head(),records:(await store.db.get('SELECT count(*)::text AS count FROM records')).count}));
 const put=WebsiteDocumentStore.prototype.save;t.mock.method(WebsiteDocumentStore.prototype,'save',async function(...args){await put.apply(this,args);throw Object.assign(Error('Synthetic full disk after writing website'),{code:'ENOSPC'});});
 const failing={...command,baseEtag:saved.etag,websitePin:saved.websitePin,selection:{defaultShare:false,includeProjects:[],records:book.entries.slice(1,4).map(r=>({id:r.id,share:false,attachments:[]}))}};
 await assert.rejects(sites.save(null,failing),{code:'ENOSPC'});t.mock.restoreAll();assert.deepEqual((await sites.read(null)).websitePin,saved.websitePin);assert.deepEqual((await sites.read(null)).site.selection,saved.site.selection);
 assert.deepEqual(await f.workspace.catalogue(async store=>({head:await store.head(),records:(await store.db.get('SELECT count(*)::text AS count FROM records')).count})),before);
 await f.workspace.catalogue(store=>store.verifySnapshot(saved.etag,book.id));
 const elapsed=performance.now()-started;assert.ok(process.memoryUsage().heapUsed<384*1024*1024);
 t.diagnostic(JSON.stringify({records:count,elapsedMs:Math.round(elapsed),commitMs:Math.round(commitMs),pageBytes:Buffer.byteLength(JSON.stringify(first)),heapMiB:Math.round(process.memoryUsage().heapUsed/1048576)}));
});

test('website selection acknowledgement preserves newer edits without retaining record bodies',()=>{
 const draft=websiteSelectionDraft(),id=randomUUID(),attachment=randomUUID(),project=randomUUID();draft.includeProject(project);draft.share(id,true);draft.media(id,attachment,true);
 const sent=draft.snapshot();draft.share(id,false);draft.acknowledge(sent);assert.deepEqual(draft.snapshot(),{includeProjects:[],records:[{id,share:false,attachments:[]}]});
 draft.restore(sent);assert.equal(draft.attachmentShare(id,{id:attachment,share:false}),false);assert.equal(draft.attachmentShare(id,{id:attachment,share:true}),true);draft.reset();assert.equal(draft.isDirty(),false);
});
