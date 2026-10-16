import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordValues} from '../src/record-values.js';
import {RecordValueDrafts,verifyRecordValueDraft} from '../src/record-value-drafts.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {RecordContent} from '../src/record-content.js';
import {withRecordDocument,RecordDocument} from '../src/record-document.js';
import {documentRevision} from '../src/record-document-revision.js';
import {recordRevision} from '../src/research.js';
import {withDraftDocument} from '../src/record-draft-document.js';
import {RunReadiness} from '../src/run-readiness.js';
import {runEvidenceRevision} from '../src/run-receipts.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {RecordQueryDocuments} from '../src/record-query-documents.js';
import {RecordValueTree} from '../src/record-value-tree.js';
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-values-')),book=sampleNotebook(),record=book.entries[2];book.entries=[record];
 record.status='draft';record.sections=Array.from({length:70},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Saved observation '+i}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const values=new RecordValues(f.workspace),target=field=>({workspaceId:book.id,recordId:record.id,field});
 return {...f,directory,book,record,values,target,save:(base,value)=>values.save({...target(base.field),expectedRevision:base.revision,value:{value}})};
}
test('selected record details compose independently, retain old values and update authenticated indexes',async t=>{
 const f=await fixture(t),old=(await f.workspace.outline()).etag;
 await f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),f.record.id);await withRecordDocument(store,row.id,row.revision,async document=>{
  assert.equal(await documentRevision(document),recordRevision(f.record));const {status,updatedAt,...rest}=f.record;void status;void updatedAt;assert.equal(await documentRevision(document,{omit:['status','updatedAt']}),recordRevision(rest));
 });});
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Selected detail reconstructed a whole record');});
 const title=await f.values.read(f.target('title')),date=await f.values.read(f.target('occurredOn'));
 const changed=await f.save(title,'Selected title');assert.equal((await f.save(title,'Selected title')).etag,changed.etag);
 await f.save(date,{kind:'range',from:'2025-01-01',to:'2025-03-01',estimated:true});
 await assert.rejects(f.save(title,'Conflicting title'),{code:'RECORD_CHANGED'});
 await assert.rejects(f.save(await f.values.read(f.target('title')),''),{code:'INVALID'});
 await f.save(await f.values.read(f.target('outcome')),'Retained result');await f.save(await f.values.read(f.target('outcome')),null);
 await f.save(await f.values.read(f.target('share')),true);
 const current=await f.values.read(f.target('title'));assert.equal(current.value.value,'Selected title');
 await f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),f.record.id);assert.equal(row.share,true);assert.deepEqual(row.occurredOn,(await f.values.read(f.target('occurredOn'))).value.value);await store.verifySnapshot(undefined,f.book.id);});
 const original=await new RecordContent(f.workspace).read({workspaceId:f.book.id,recordId:f.record.id,snapshotId:old});assert.equal(original.header.title,f.record.title);
 await assert.rejects(f.values.save({...f.target('notebookId'),expectedRevision:current.revision,value:{value:randomUUID()}}),{code:'INVALID'});
});

test('ordinary detail saves reuse immutable query owners and still verify against complete source projections',async t=>{
 const f=await fixture(t);await f.save(await f.values.read(f.target('title')),'Retained projection base');const before=(await f.workspace.outline()).etag;
 const retain=RecordQueryDocuments.prototype.retainDocument;let reuses=0;
 t.mock.method(RecordQueryDocuments.prototype,'retainDocument',async function(document,revision,options){
  assert.ok(options.previous?.queryRevision,'Ordinary save omitted its pinned prior query');reuses++;
  const items=document.items;document.items=async function*(){throw Error('An ordinary metadata edit reprojected unchanged collections');};
  try{return await retain.call(this,document,revision,options);}finally{document.items=items;}
 });
 const page=RecordValueTree.prototype.page;
 t.mock.method(RecordDocument.prototype,'items',async function*(){throw Error('An ordinary detail edit traversed an unchanged collection');});
 t.mock.method(RecordValueTree.prototype,'text',()=>{throw Error('An ordinary detail edit retokenized unchanged search text');});
 t.mock.method(RecordValueTree.prototype,'page',function(root,path,...args){assert.notEqual(path[0],'referenceTargets','An ordinary detail edit reindexed unchanged references');return page.call(this,root,path,...args);});
 for(const [field,value] of [['status','in progress'],['occurredOn',{kind:'day',value:'2026-10-11',estimated:false}],['share',true]])await f.save(await f.values.read(f.target(field)),value);
 assert.equal(reuses,3);t.mock.restoreAll();
 await f.workspace.catalogue(async store=>{await store.verifySnapshot(undefined,f.book.id);await store.verifySnapshot(before,f.book.id);});
 assert.equal((await f.values.read(f.target('status'))).value.value,'in progress');assert.equal((await f.values.read(f.target('share'))).value.value,true);
});
test('selected details retain incomplete drafts, reject scope tampering and survive encrypted and fresh-key copying',async t=>{
 const f=await fixture(t),base=await f.values.read(f.target('title')),drafts=new RecordValueDrafts(f.workspace);
 const command={id:randomUUID(),workspaceId:f.book.id,recordId:f.record.id,expectedRevision:null,selection:{field:'title',revision:base.revision,storageRevision:base.storageRevision},value:{value:''}};
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Checkpoint copied a whole record');});
 const receipt=await drafts.write(command);assert.deepEqual(await drafts.write(command),receipt);
 const lookup={id:command.id,workspaceId:f.book.id,expectedRevision:receipt.revision};assert.deepEqual((await drafts.read(lookup)).value,command.value);
 await assert.rejects(drafts.write({...command,value:{value:'Stale checkpoint'}}),{code:'DRAFT_CHANGED'});
 const retained=await new ResearchDrafts(f.workspace).read(command.id,{header:true});
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>withDraftDocument(store,retained.draft,async document=>{
  const tampered=await new RecordDocument(document.blocks,document.root,{mutable:true}).replace(['sections','0','body'],'Unselected edit');await tampered.blocks.flush();
  await assert.rejects(verifyRecordValueDraft(store,{...retained.draft,document:{...retained.draft.document,root:tampered.root}}),{code:'CATALOGUE_DAMAGED'});
 })));
 const copied=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'copy')),{vault:f.vault});
 const access=await createAccess('','synthetic selected-value copy'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'fresh')),access,vault,f.vault);
 for(const workspace of [new Workspace(copied,f.vault),new Workspace(fresh,vault)])assert.deepEqual((await new RecordValueDrafts(workspace).read(lookup)).value,command.value);
});
test('selected completion verifies required receipts and never permits another detail change to bypass them',async t=>{
 const f=await fixture(t),readiness=new RunReadiness(f.workspace),projectId=f.book.notebooks[0].projectId;
 await f.workspace.withLock(()=>f.workspace.writeMetadata('.observanda/run-readiness/projects/'+projectId+'.json',JSON.stringify({version:1,required:['validation']})));
 const initial=await f.values.read(f.target('status'));await assert.rejects(f.save(initial,'completed'),{code:'INTAKE_COMPLETION'});
 assert.equal(await readiness.receiptStore(f.record.id).metadata(),null,'Rejected completion rolls back receipt initialization');
 // A receipt for the exact previous record and current evidence is the existing
 // readiness contract. Its authoring UI is tested by the readiness owner.
 await readiness.materials.index.ensure();const evidenceRevision=await runEvidenceRevision(f.workspace,f.record.id);
 const receipt={id:randomUUID(),kind:'validation',recordRevision:recordRevision(f.record),evidenceRevision,recordedAt:new Date().toISOString()},legacy='.observanda/run-readiness/records/'+f.record.id+'.json';
 await f.workspace.withLock(()=>f.workspace.writeMetadata(legacy,JSON.stringify([receipt])));
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Completion reconstructed a whole record');});
 const write=f.workspace.writeMetadata;t.mock.method(f.workspace,'writeMetadata',async function(name,...args){await write.call(this,name,...args);if(name==='.observanda/run-readiness/completed/'+f.record.id+'.json')throw Error('Interrupted completion');});
 await assert.rejects(f.save(initial,'completed'),/Interrupted completion/);f.workspace.writeMetadata.mock.restore();
 assert.deepEqual(JSON.parse(await f.workspace.readMetadata(legacy,1024*1024)),[receipt]);assert.equal(await readiness.receiptStore(f.record.id).metadata(),null);assert.equal((await f.values.read(f.target('status'))).revision,initial.revision);
 await f.save(initial,'completed');assert.equal((await f.values.read(f.target('status'))).value.value,'completed');
 assert.equal(await f.workspace.readMetadata(legacy,1024*1024),null);assert.deepEqual(await readiness.receiptStore(f.record.id).get(receipt.id),receipt);
 const json=RecordValueTree.prototype.json;t.mock.method(RecordValueTree.prototype,'json',async function*(ref,...options){const node=await this.node(ref);assert.ok(node.type==='inline'&&[f.record.title,'Unreviewed content'].includes(node.value),'Completion comparison hashed unchanged research');yield* json.call(this,ref,...options);});
 await assert.rejects(f.save(await f.values.read(f.target('title')),'Unreviewed content'),{code:'INTAKE_COMPLETION'});
 RecordValueTree.prototype.json.mock.restore();
 const completion=await readiness.json('completed/'+f.record.id,null);assert.equal(completion.basis,recordRevision(f.record));
 await f.save(await f.values.read(f.target('status')),'in progress');await f.save(await f.values.read(f.target('title')),'Reopened work');
});
