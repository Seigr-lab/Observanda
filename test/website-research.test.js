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
import {WorkspaceEdits} from '../src/workspace-edits.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {emptyWebsiteSelection,websiteSelectionDraft} from '../src/web/website-selection.js';

for(const count of [65,650])test('website selections and media discovery stay bounded across '+count+' records',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-research-')),book=sampleNotebook(),template=book.entries[2],imageId=randomUUID();
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(template),id:randomUUID(),title:'Take '+String(i).padStart(3,'0'),share:i%2===0,body:'Unrelated private prose. '.repeat(20),sections:[],attachments:[{id:imageId,kind:'image',caption:'Capture '+i,alt:'',transcript:'',share:false}]}));
 // The same real evidence may be associated independently with many records.
 // Creation now verifies its retained bytes as well as the record references.
 const f=await encryptedFixture(directory,book,{populate:workspace=>populateImageEvidence(workspace,[imageId])}),service=new WebsiteResearch(f.workspace),outline=await f.workspace.outline(),base={workspaceId:book.id,snapshotId:outline.etag},projectId=book.notebooks.find(n=>n.id===template.notebookId).projectId;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const original=ResearchCatalogue.prototype.record,reads=[];
 t.mock.method(ResearchCatalogue.prototype,'read',()=>{throw Error('Full website workspace read');});
 t.mock.method(ResearchCatalogue.prototype,'record',function(id,...rest){reads.push(id);return original.call(this,id,...rest);});
 const started=performance.now(),summary=await service.run('summary',{...base,selection:emptyWebsiteSelection(),search:''});
 assert.equal(summary.entries,Math.ceil(count/2));assert.equal(summary.media,0);assert.deepEqual(reads,[]);
 const first=await service.run('content',{...base,projectId,search:'',cursor:null});assert.equal(first.items.length,10);assert.equal(first.total,count);
 const second=await service.run('content',{...base,projectId,search:'',cursor:first.nextCursor});assert.equal(second.offset,10);
 const back=await service.run('content',{...base,projectId,search:'',cursor:second.previousCursor});assert.deepEqual(back.items,first.items);assert.equal(back.offset,0);assert.equal(back.total,count);assert.deepEqual(reads,[]);
 await assert.rejects(service.run('content',{...base,projectId,search:'changed',cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
 const media=await service.run('media',{...base,search:'',cursor:null});assert.equal(media.items.length,12);assert.equal(reads.length,12);reads.length=0;
 const details=await service.run('record',{...base,recordId:book.entries[0].id});assert.equal(details.record.body,undefined);assert.deepEqual(details.record.attachments,book.entries[0].attachments);assert.deepEqual(reads,[book.entries[0].id]);reads.length=0;
 const selection={includeProjects:[projectId],records:[{id:book.entries[0].id,share:false,attachments:[]},{id:book.entries[1].id,share:null,attachments:[{id:book.entries[1].attachments[0].id,share:true}]}]};
 const proposed=await service.run('summary',{...base,selection,search:''});assert.equal(proposed.entries,count-1);assert.equal(proposed.media,1);assert.deepEqual(reads,[]);assert.deepEqual(proposed.selectionProjects,{[book.entries[0].id]:projectId,[book.entries[1].id]:projectId});
 const command={workspaceId:book.id,baseEtag:outline.etag,metadata:{website:{...outline.metadata.website,footer:'A reviewed footer'}},projects:[],changes:[],removed:[],selection,response:'outline'};
 const beforeCommit=performance.now(),saved=await new WorkspaceEdits(f.workspace,{}).save(command),commitMs=performance.now()-beforeCommit;assert.equal(saved.outline,true);assert.equal(saved.book.entries.length,0);assert.equal(reads.length,count);assert.ok(commitMs<30000);
 const source=await f.workspace.catalogue(store=>store.snapshot(saved.etag));assert.equal(source.metadata.website.footer,'A reviewed footer');
 const firstRecord=await f.workspace.catalogue(async store=>original.call(store,book.entries[0].id,(await store.member(source,book.entries[0].id)).revision));
 assert.equal(firstRecord.share,false);assert.equal(firstRecord.body,book.entries[0].body);
 const after=await service.run('summary',{workspaceId:book.id,snapshotId:saved.etag,selection:emptyWebsiteSelection(),search:''});assert.equal(after.entries,count-1);assert.equal(after.media,1);
 await assert.rejects(new WorkspaceEdits(f.workspace,{}).save(command),{code:'CONFLICT'});
 // The old page remains tied to its exact saved selection after the new commit.
 assert.deepEqual((await service.run('content',{...base,projectId,search:'',cursor:null})).items,first.items);
 const before=await f.workspace.catalogue(async store=>({head:await store.head(),records:(await store.db.get('SELECT count(*)::text AS count FROM records')).count}));
 const put=ResearchCatalogue.prototype.putRecord;let written=0;t.mock.method(ResearchCatalogue.prototype,'putRecord',function(...args){if(++written===2)throw Object.assign(Error('Synthetic full disk'),{code:'ENOSPC'});return put.apply(this,args);});
 const failing={...command,baseEtag:saved.etag,selection:{includeProjects:[],records:book.entries.slice(1,4).map(r=>({id:r.id,share:false,attachments:[]}))}};
 await assert.rejects(new WorkspaceEdits(f.workspace,{}).save(failing),{code:'ENOSPC'});t.mock.restoreAll();
 assert.deepEqual(await f.workspace.catalogue(async store=>({head:await store.head(),records:(await store.db.get('SELECT count(*)::text AS count FROM records')).count})),before);
 await f.workspace.catalogue(store=>store.verifySnapshot(saved.etag,book.id));
 const elapsed=performance.now()-started;assert.ok(process.memoryUsage().heapUsed<384*1024*1024);
 t.diagnostic(JSON.stringify({records:count,elapsedMs:Math.round(elapsed),commitMs:Math.round(commitMs),pageBytes:Buffer.byteLength(JSON.stringify(first)),heapMiB:Math.round(process.memoryUsage().heapUsed/1048576)}));
});

test('website selection acknowledgement preserves newer edits without retaining record bodies',()=>{
 const draft=websiteSelectionDraft(),id=randomUUID(),attachment=randomUUID(),project=randomUUID();draft.includeProject(project);draft.share(id,true);draft.media(id,attachment,true);
 const sent=draft.snapshot();draft.share(id,false);draft.acknowledge(sent);assert.deepEqual(draft.snapshot(),{includeProjects:[],records:[{id,share:false,attachments:[]}]});
 draft.restore(sent);assert.equal(draft.attachmentShare(id,{id:attachment,share:false}),true);draft.reset();assert.equal(draft.isDirty(),false);
});
