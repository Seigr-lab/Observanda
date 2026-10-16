import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mediaValueFixture} from './record-media-values-fixture.js';
import {RecordMediaCommands} from '../src/record-media-commands.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordContent} from '../src/record-content.js';
import {RecordWriting} from '../src/record-writing.js';
import {RecordQueryDocuments} from '../src/record-query-documents.js';
import {withRecordDocument} from '../src/record-document.js';
import {FileContent} from '../src/file-content.js';
import {digest} from '../src/storage-format.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {MediaStore} from '../src/media.js';

const command=(f,mediaId,extra={})=>({workspaceId:f.book.id,recordId:f.record.id,mediaId,action:'attach',...extra});
const forbidRecord=(t,id)=>{const read=ResearchCatalogue.prototype.record;t.mock.method(ResearchCatalogue.prototype,'record',function(target,...rest){if(target===id)throw Error('Media intake reconstructed the selected record');return read.call(this,target,...rest);});};

test('reader media intake exceeds thirty attachments on a heavy record, composes with details, and removes only its association',async t=>{
 const f=await mediaValueFixture({large:true,shared:true,count:31});t.after(f.close);forbidRecord(t,f.record.id);
 assert.ok(Buffer.byteLength(JSON.stringify(f.record))>2*1024*1024);
 const commands=new RecordMediaCommands(f.workspace),reader=new RecordContent(f.workspace),target={workspaceId:f.book.id,recordId:f.record.id,pagedHeader:true},prior=(await f.workspace.outline()).etag;
 const asset=await f.media.import(f.files.audio.bytes,'audio');
 // Admission verifies the prepared stream once, without a second read for an
 // unused file header or buffering a recording in memory.
 t.mock.method(FileContent.prototype,'read',()=>{throw Error('Media admission read a verified file again');});
 const added=await commands.run(command(f,asset.id));FileContent.prototype.read.mock.restore();
 assert.equal(added.total,32);assert.equal(added.position,31);
 const selected=await f.values.read(f.target(asset.id));assert.equal(selected.definition.mediaKind,'audio');assert.equal(selected.value.value.share,false);
 await f.save(selected,{caption:'Tone',alt:'Measured tone',transcript:'One tone',share:true});
 const edited=(await f.workspace.outline()).etag,retry=await commands.run(command(f,asset.id));assert.equal(retry.etag,edited);assert.equal((await f.values.read(f.target(asset.id))).value.value.caption,'Tone');
 assert.equal((await reader.read({...target,windows:{attachments:28}})).collections.attachments.total,32);
 await assert.rejects(commands.run(command(f,asset.id,{action:'remove',expectedRevision:selected.revision})),{code:'RECORD_CHANGED'});
 const shared=f.record.attachments[0],base=await f.values.read(f.target(shared.id)),remove=command(f,shared.id,{action:'remove',expectedRevision:base.revision});
 const removed=await commands.run(remove);assert.equal(removed.total,31);assert.deepEqual(await commands.run(remove),{...removed,position:-1});
 await assert.rejects(f.values.read(f.target(shared.id)),{code:'MISSING'});
 assert.deepEqual((await f.values.read({...f.target(shared.id),recordId:f.book.entries[1].id})).value,base.value);
 assert.equal((await reader.read({...target,snapshotId:prior})).header.attachments[0].id,shared.id);
 assert.equal(digest(await f.workspace.readFile(path.join(f.workspace.root,'.observanda/media',shared.id,'original'))),digest(f.files.image.bytes));await f.media.get(shared.id);
 await f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),row=await store.member(snapshot,f.record.id),[query]=await Array.fromAsync(new RecordQueryDocuments(store).read([row],snapshot.metadata,{search:false,cards:true,publication:true,inventory:true}));
  assert.equal(query.publication.attachments.length,31);assert.deepEqual(query.editionInventory.choice.attachments,[asset.id]);
  await withRecordDocument(store,row.id,row.revision,async document=>{assert.equal((await document.field(['body'])).value,f.record.body);for(let i=0;i<f.record.sections.length;i++)assert.deepEqual((await document.field(['sections',String(i)])).value,f.record.sections[i]);});
  await store.verifySnapshot(undefined,f.book.id);
 });
 await commands.run(command(f,shared.id));assert.equal((await f.values.read(f.target(shared.id))).value.value.share,false);
 const access=await createAccess('','synthetic media association recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const root=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'recovered')),access,vault,f.vault),recovered=new Workspace(root,vault),reopened=await new RecordContent(recovered).read({...target,windows:{attachments:30}});
 assert.equal(reopened.collections.attachments.total,32);assert.deepEqual(reopened.header.attachments.map(item=>item.id),[asset.id,shared.id]);
 assert.equal((await new RecordContent(recovered).read({...target,snapshotId:prior})).collections.attachments.total,31);
 assert.equal(digest(await recovered.readFile(path.join(root,'.observanda/media',asset.id,'original'))),digest(f.files.audio.bytes));await new MediaStore(root,vault).get(asset.id);
});

test('media removal protects inline placements beyond the reading window, validates admission and rolls back atomically',async t=>{
 const f=await mediaValueFixture();t.after(f.close);forbidRecord(t,f.record.id);
 const commands=new RecordMediaCommands(f.workspace),writing=new RecordWriting(f.workspace),asset=f.record.attachments[0],value=await f.values.read(f.target(asset.id));
 const remove=command(f,asset.id,{action:'remove',expectedRevision:value.revision}),target={workspaceId:f.book.id,recordId:f.record.id,sectionId:f.record.sections.at(-1).id},base=await writing.read(target);
 const body={type:'doc',content:[{type:'book_figure',attrs:{version:1,id:randomUUID(),figureId:asset.id,alternative:'Image in the final section'}}]};
 await writing.save({...target,expectedRevision:base.revision,value:{title:base.value.title,body}});
 await assert.rejects(commands.run(remove),{code:'MEDIA_IN_USE'});
 const placed=await writing.read(target);await writing.save({...target,expectedRevision:placed.revision,value:base.value});
 const current=(await f.workspace.outline()).etag,finish=ResearchCatalogue.prototype.finishRecordChanges;
 t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){await finish.apply(this,args);throw Error('Interrupted association commit');});
 await assert.rejects(commands.run(remove),/Interrupted association commit/);ResearchCatalogue.prototype.finishRecordChanges.mock.restore();
 assert.equal((await f.workspace.outline()).etag,current);assert.deepEqual((await f.values.read(f.target(asset.id))).value,value.value);await commands.run(remove);
 await assert.rejects(commands.run(command(f,randomUUID())),{code:'MISSING'});
 await assert.rejects(commands.run({...command(f,asset.id),workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 for(const extra of [{kind:'video'},{share:true},{action:'remove'},{action:'delete-original'},{action:'__proto__'},{action:'remove',expectedRevision:'bad'}])await assert.rejects(commands.run(command(f,asset.id,extra)),{code:'INVALID'});
 await f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
});
