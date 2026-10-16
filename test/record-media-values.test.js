import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mediaValueFixture} from './record-media-values-fixture.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordValues} from '../src/record-values.js';
import {RecordValueDrafts,verifyRecordValueDraft} from '../src/record-value-drafts.js';
import {RecordContent} from '../src/record-content.js';
import {RecordQueryDocuments} from '../src/record-query-documents.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {withRecordDocument,RecordDocument} from '../src/record-document.js';
import {withDraftDocument} from '../src/record-draft-document.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {digest} from '../src/storage-format.js';
import {MediaStore} from '../src/media.js';
import {buildPublication} from '../src/publication.js';
import {withQueryValue} from '../src/record-query-storage.js';
const checkpoint=(f,base,value)=>({id:randomUUID(),workspaceId:f.book.id,recordId:f.record.id,expectedRevision:null,selection:{field:base.field,revision:base.revision,storageRevision:base.storageRevision},value:{value}});
const forbidRecord=(t,recordId)=>{const read=ResearchCatalogue.prototype.record;t.mock.method(ResearchCatalogue.prototype,'record',function(id,...args){if(id===recordId)throw Error('Media details reconstructed the selected record');return read.call(this,id,...args);});};

test('media descriptions compose by attachment, retain old revisions and update publication choices without modifying files',async t=>{
 const f=await mediaValueFixture({shared:true});t.after(f.close);forbidRecord(t,f.record.id);const prior=(await f.workspace.outline()).etag;
 const items=RecordDocument.prototype.items;t.mock.method(RecordDocument.prototype,'items',function(path,...rest){if(path[0]==='attachments')throw Error('Selected media read scanned every attachment');return items.call(this,path,...rest);});
 const first=await f.values.read(f.target(f.record.attachments[0].id)),late=await f.values.read(f.target(f.record.attachments[8].id));RecordDocument.prototype.items.mock.restore();
 const a={...first.value.value,caption:'Reviewed image',alt:'A green rectangle',transcript:'Extended image description',share:true},b={...late.value.value,caption:'Reviewed video',transcript:'First line\nSecond line',share:true};
 await f.save(first,a);const saved=await f.save(late,b);assert.deepEqual(await f.save(late,b),saved);await assert.rejects(f.save(first,{...a,caption:'Stale caption'}),{code:'RECORD_CHANGED'});
 assert.deepEqual((await f.values.read({...f.target(f.record.attachments[0].id),recordId:f.book.entries[1].id})).value,first.value);
 const reader=new RecordContent(f.workspace),target={workspaceId:f.book.id,recordId:f.record.id,pagedHeader:true};
 assert.deepEqual((await reader.read({...target,snapshotId:prior})).header.attachments,f.record.attachments.slice(0,4));
 assert.deepEqual((await reader.read({...target,windows:{attachments:8}})).header.attachments,[{...f.record.attachments[8],...b}]);
 const publication=structuredClone(f.book);publication.entries[0].share=true;
 await f.workspace.catalogue(async store=>{const snapshot=await store.snapshot(),row=await store.member(snapshot,f.record.id),[query]=await Array.fromAsync(new RecordQueryDocuments(store).read([row],snapshot.metadata,{search:false,cards:true,publication:true,inventory:true}));assert.equal(query.publicationCard.attachments[0].caption,a.caption);assert.deepEqual(query.publication.attachments.map(item=>item.share),[true,false,false,false,false,false,false,false,true]);assert.deepEqual(query.editionInventory.choice.attachments,[f.record.attachments[0].id,f.record.attachments[8].id]);publication.entries[0].attachments=await withRecordDocument(store,row.id,row.revision,async document=>(await document.field(['attachments'])).value);await store.verifySnapshot(undefined,f.book.id);});
 const candidate=buildPublication(publication,{mediaFiles:await f.media.publicFiles(publication)}),html=candidate.files.get('entries/'+f.record.id+'.html');
 assert.match(html,/Reviewed image/);assert.match(html,/A green rectangle/);assert.match(html,/Reviewed video/);assert.ok(candidate.files.has('media/'+f.record.attachments[8].id+'.mp4'));assert.ok(!candidate.files.has('media/'+f.record.attachments[1].id+'.wav'));
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'copy')),{vault:f.vault}),access=await createAccess('','Filtered media recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'fresh')),access,vault,f.vault);
 for(const workspace of [f.workspace,new Workspace(copy,f.vault),new Workspace(fresh,vault)])await workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),row=await store.member(snapshot,f.record.id),source={revision:row.queryRevision,slot:'record-query:'+row.id+':'+row.queryRevision},found=await store.db.get('SELECT payload FROM state WHERE slot=$1',source.slot);
  await withQueryValue(store,store.decode('state',source.slot,found.payload),source,row,async({value,tree})=>{
   assert.equal(value.version,6);const target=await tree.select(value.root,['editionInventory','choice','attachments']);assert.equal((await tree.node(target.revision)).type,'keyed-array');
   assert.deepEqual((await tree.page(value.root,['editionInventory','choice','attachments'])).values,[f.record.attachments[0].id,f.record.attachments[8].id]);
  });
  await store.verifySnapshot(undefined,f.book.id);await store.verifySnapshot(prior,f.book.id);
 });
 for(const item of f.record.attachments){assert.equal(digest(await f.workspace.readFile(path.join(f.workspace.root,'.observanda/media',item.id,'original'))),digest(f.files[item.kind].bytes));await f.media.get(item.id);}
 await assert.rejects(f.values.read(f.target(randomUUID())),{code:'MISSING'});
 for(const value of [null,{...a,id:randomUUID()},{...a,kind:'audio'},{...a,share:'true'},{...a,caption:'bad\u0000text'}])await assert.rejects(f.save(await f.values.read(f.target(f.record.attachments[0].id)),value),{code:'INVALID'});
 await assert.rejects(f.values.read({...f.target(f.record.attachments[0].id),workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
});

test('media detail checkpoints survive fresh-key recovery on a heavy record and cannot change identity, type or unrelated content',async t=>{
 const f=await mediaValueFixture({large:true});t.after(f.close);assert.ok(Buffer.byteLength(JSON.stringify(f.record))>2*1024*1024);forbidRecord(t,f.record.id);
 const last=f.record.attachments.at(-1),base=await f.values.read(f.target(last.id)),value={caption:'',alt:'',transcript:'Unfinished transcript\ncontinued later',share:false},command=checkpoint(f,base,value),drafts=new RecordValueDrafts(f.workspace);
 const receipt=await drafts.write(command);assert.deepEqual(await drafts.write(command),receipt);const lookup={id:command.id,workspaceId:f.book.id,expectedRevision:receipt.revision};assert.deepEqual((await drafts.read(lookup)).value,command.value);
 const retained=await new ResearchDrafts(f.workspace).read(command.id,{header:true});
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>withDraftDocument(store,retained.draft,async document=>{
  for(const [path,value] of [[['attachments','8','kind'],'image'],[['attachments','0','caption'],'Unselected caption'],[['sections','0','body'],'Unselected text']]){
   const changed=await new RecordDocument(document.blocks,document.root,{mutable:true}).replace(path,value);await changed.blocks.flush();await assert.rejects(verifyRecordValueDraft(store,{...retained.draft,document:{...retained.draft.document,root:changed.root}}),{code:'CATALOGUE_DAMAGED'});
  }
 })));
 const access=await createAccess('','synthetic media recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const root=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'recovered')),access,vault,f.vault),workspace=new Workspace(root,vault),recovered=await new RecordValueDrafts(workspace).read(lookup);
 assert.deepEqual(recovered.value,command.value);assert.equal(recovered.definition.mediaKind,'video');await new RecordValues(workspace).save({...f.target(last.id),expectedRevision:base.revision,value:recovered.value});
 await workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),f.record.id);await withRecordDocument(store,row.id,row.revision,async document=>{
  assert.equal(document.blocks.scopeId,f.record.notebookId);assert.equal((await document.field(['body'])).value,f.record.body);
  for(let i=0;i<f.record.sections.length;i++)assert.deepEqual((await document.field(['sections',String(i)])).value,f.record.sections[i]);
  for(let i=0;i<f.record.attachments.length;i++)assert.deepEqual((await document.field(['attachments',String(i)])).value,{...f.record.attachments[i],...(i===8?value:{})});
 });});
 for(const item of f.record.attachments){assert.equal(digest(await workspace.readFile(path.join(root,'.observanda/media',item.id,'original'))),digest(f.files[item.kind].bytes));await new MediaStore(root,vault).get(item.id);}
});

test('failed media detail commits roll back record, history and publication indexes together',async t=>{
 const f=await mediaValueFixture();t.after(f.close);forbidRecord(t,f.record.id);const base=await f.values.read(f.target(f.record.attachments[0].id)),before=await f.workspace.outline();
 const finish=ResearchCatalogue.prototype.finishRecordChanges;t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){await finish.apply(this,args);throw Error('Interrupted media commit');});
 await assert.rejects(f.save(base,{...base.value.value,caption:'Not committed',share:true}),/Interrupted media commit/);ResearchCatalogue.prototype.finishRecordChanges.mock.restore();
 assert.equal((await f.workspace.outline()).etag,before.etag);assert.deepEqual((await f.values.read(f.target(f.record.attachments[0].id))).value,base.value);
 await f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
 await f.save(base,{...base.value.value,caption:'Retry committed',share:true});
});
