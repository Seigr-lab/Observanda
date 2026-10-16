import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {EvidenceCorrections} from '../src/evidence-corrections.js';
import {associateOriginal} from '../src/evidence-associations.js';
import {MaterialIndex} from '../src/material-index.js';
import {contentBuffer} from '../src/file-content.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-evidence-correct-')),book=upgradeNotebook(sampleNotebook());
 const f=await encryptedFixture(directory,book),materials=new ResearchMaterials(f.workspace);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:5});});
 const bytes=Buffer.from('Synthetic original disk image; shared immutable bytes'),upload=await materials.startImport({recordId:book.entries[0].id,name:'returned.img',size:bytes.length,provenance:'Original acquisition'});await materials.appendImport(upload.id,0,[bytes]);const source=await materials.finishImport(upload.id);
 const second=await associateOriginal(materials,{recordId:book.entries[1].id,ref:source}),mistake=await associateOriginal(materials,{recordId:book.entries[2].id,ref:source});
 return {...f,directory,book,materials,corrections:new EvidenceCorrections(materials),source,second,mistake,bytes};
}
const command=(f,action='retire',extra={})=>({recordId:f.book.entries[2].id,ref:f.mistake,action,reason:'Evidence was associated with the wrong acquisition.',metadata:null,replacementRecordId:null,...extra});
async function apply(f,value){const plan=await f.corrections.preview(value);return f.corrections.apply({command:value,review:plan.review});}

test('retirement removes only the mistaken association, preserves pins and bytes, and survives copy and restoration',async t=>{
 const f=await fixture(t),prior=await f.workspace.outline(),before=await f.materials.current(f.mistake.id),value=command(f),plan=await f.corrections.preview(value);
 assert.equal((await f.materials.list({recordId:value.recordId})).items.length,1,'Review is read only');
 const event=await f.corrections.apply({command:value,review:plan.review});assert.deepEqual(await f.corrections.apply({command:value,review:plan.review}),event,'Lost acknowledgement is idempotent');
 assert.equal(await f.materials.current(f.mistake.id),null);assert.equal((await f.materials.list({recordId:value.recordId})).items.length,0);
 for(const reference of [f.source,f.second,f.mistake])assert.deepEqual(await contentBuffer((await f.materials.artifact(reference)).content),f.bytes);
 for(const recordId of f.book.entries.slice(0,2).map(r=>r.id))assert.equal((await f.materials.list({recordId})).items.length,1);
 assert.deepEqual((await f.corrections.history({recordId:value.recordId})).items.map(e=>e.id),[event.id]);assert.equal((await f.workspace.outline()).etag,prior.etag,'Record identities and revision history are unchanged');
 await assert.rejects(associateOriginal(f.materials,{recordId:value.recordId,ref:f.source}),{code:'MATERIAL_CHANGED'},'A retry cannot resurrect the retired association');
 await f.materials.verify();
 const root=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'restored')),{vault:f.vault}),copy=new ResearchMaterials(new Workspace(root,f.vault));await copy.verify();assert.equal(await copy.current(f.mistake.id),null);assert.deepEqual(await contentBuffer((await copy.artifact(f.mistake)).content),f.bytes);
 const restored=await apply(f,command(f,'restore',{reason:'Reviewed correction of the association retirement.'}));assert.deepEqual(restored.after,before);assert.deepEqual(await f.materials.current(f.mistake.id),before);
 const retiredAgain=await apply(f,value);assert.notEqual(retiredAgain.id,event.id);assert.equal(await f.materials.current(f.mistake.id),null);await f.materials.verify();
 const seen=[];let cursor=null;do{const page=await f.corrections.history({recordId:value.recordId,cursor,limit:1});seen.push(...page.items.map(item=>item.id));cursor=page.next;}while(cursor);assert.deepEqual(new Set(seen),new Set([event.id,restored.id,retiredAgain.id]));
 assert.deepEqual(await readdir(await f.materials.directory('originals')),[f.source.id]);
});

test('verification rejects damaged correction receipts, historical heads and missing history pointers',async t=>{
 const f=await fixture(t),event=await apply(f,command(f)),prefix='.observanda/materials/corrections',eventPath=prefix+'/events/'+event.id+'.json',receiptPath=prefix+'/receipts/'+event.review+'.json',feed=f.corrections.feed(event.command.recordId),pointerPath=feed.order+'/'+feed.key(event);
 for(const [file,value] of [[receiptPath,{id:randomUUID()}],[eventPath,{...event,before:{...event.before,title:'Changed audit history'}}],[pointerPath,null]]){
  const original=await f.workspace.readMetadata(file);
  await f.workspace.withLock(()=>value===null?f.workspace.removeMetadata(file):f.workspace.writeMetadata(file,JSON.stringify(value)));
  await assert.rejects(f.materials.verify(),{code:'CATALOGUE_DAMAGED'});
  await f.workspace.withLock(()=>f.workspace.writeMetadata(file,original));
 }
 await f.materials.verify();
});

test('metadata changes retain old provenance and a stale review cannot overwrite a newer correction',async t=>{
 const f=await fixture(t),doc=await f.materials.read(f.mistake),value=command(f,'metadata',{metadata:{title:'Current return',provenance:'Corrected source notes',sourcePath:'window-37/return/returned.img',sourcePurpose:'current-return'}});
 const obsolete=await f.corrections.preview(command(f));const event=await apply(f,value),head=await f.materials.current(f.mistake.id),updated=await f.materials.read(head);
 assert.equal(updated.previous,f.mistake.revision);assert.equal(updated.content.sourcePath,value.metadata.sourcePath);assert.equal(updated.content.sha256,doc.content.sha256);assert.deepEqual(await f.materials.read(f.mistake),doc);
 await assert.rejects(f.corrections.apply({command:obsolete.command,review:obsolete.review}),{code:'MATERIAL_CHANGED'});
 const list=await f.corrections.history({recordId:value.recordId});assert.equal(list.items[0].id,event.id);
 await f.materials.verify();
 for(const edit of [{reason:''},{recordId:randomUUID()},{ref:{...f.mistake,revision:'0'.repeat(64)}},{metadata:{...value.metadata,sourcePath:'../outside/returned.img'}},{metadata:{...value.metadata,sourcePath:'wrong-name.img'}}])await assert.rejects(f.corrections.preview({...value,...edit}));
 assert.equal((await f.materials.current(f.mistake.id)).revision,head.revision);
});

test('reassignment preserves existing correct associations and rolls back both discovery changes on interruption',async t=>{
 const f=await fixture(t),value=command(f,'reassign',{replacementRecordId:f.book.entries[1].id}),plan=await f.corrections.preview(value),remove=MaterialIndex.prototype.removeHead;
 t.mock.method(MaterialIndex.prototype,'removeHead',async function(head){await remove.call(this,head);throw Error('Interrupted correction');});
 await assert.rejects(f.corrections.apply({command:value,review:plan.review}),/Interrupted correction/);t.mock.restoreAll();
 assert.ok(await f.materials.current(f.mistake.id));assert.equal((await f.corrections.history({recordId:value.recordId})).items.length,0);
 const event=await f.corrections.apply({command:value,review:plan.review});
 // This source is a third-record association, so an explicitly reviewed new
 // destination association retains that exact source chain. Existing originals
 // remain independently accessible and are not silently merged by byte hash.
 assert.equal((await f.materials.read(event.replacement)).recordId,value.replacementRecordId);assert.ok(await f.materials.current(f.second.id));assert.equal(await f.materials.current(f.mistake.id),null);
 assert.deepEqual(await contentBuffer((await f.materials.artifact(event.replacement)).content),f.bytes);await f.materials.verify();
});


test('qualified correction references preserve ownership through retirement and restoration',async t=>{
 const f=await fixture(t),ref={...f.mistake,workspaceId:f.book.id},before=await f.corrections.status(ref);
 assert.equal(before.recordId,f.book.entries[2].id);
 const foreign={...ref,workspaceId:randomUUID()};await assert.rejects(f.corrections.status(foreign),{code:'MATERIAL_INVALID'});
 await assert.rejects(f.corrections.preview(command(f,'retire',{ref:foreign})),{code:'MATERIAL_INVALID'});
 const retired=await apply(f,command(f));assert.equal((await f.corrections.status(ref)).lastEvent,retired.id);
 const restored=await apply(f,command(f,'restore',{ref}));assert.equal(restored.after.id,ref.id);assert.equal((await f.corrections.status(ref)).retired,null);
 const next=await apply(f,command(f,'retire',{ref}));assert.equal(next.command.ref.workspaceId,f.book.id);
 const local=await apply(f,command(f,'restore'));assert.equal(local.after.id,ref.id);await f.materials.verify();
});
