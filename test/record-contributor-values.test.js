import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {RecordValues} from '../src/record-values.js';
import {RecordValueDrafts,verifyRecordValueDraft} from '../src/record-value-drafts.js';
import {RecordWriting} from '../src/record-writing.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordContent} from '../src/record-content.js';
import {RecordMemberCollections,memberCollectionCount} from '../src/record-member-collections.js';
import {withRecordDocument,RecordDocument} from '../src/record-document.js';
import {withDraftDocument} from '../src/record-draft-document.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';

async function fixture(t,{large=false,count=73}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-contributor-values-')),book=sampleNotebook(),record=book.entries[2];book.entries=[record];
 record.contributors=Array.from({length:count},(_,i)=>({id:randomUUID(),name:'Contributor '+i,role:'Role '+i}));
 record.sections=Array.from({length:large?73:2},(_,i)=>({id:randomUUID(),title:'Section '+i,body:large?'exact'.repeat(5600):'Original observation '+i}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 if(large){const writing=new RecordWriting(f.workspace),target={workspaceId:book.id,recordId:record.id,sectionId:null},base=await writing.read(target);record.body='Extended observations '.repeat(2500);await writing.save({...target,expectedRevision:base.revision,value:{body:record.body}});assert.ok(Buffer.byteLength(JSON.stringify(record))>2*1024*1024);}
 const values=new RecordValues(f.workspace),drafts=new RecordValueDrafts(f.workspace),target=id=>({workspaceId:book.id,recordId:record.id,field:'contributor:'+id});
 return {...f,directory,book,record,values,drafts,target,save:(base,value)=>values.save({...target(base.field.slice(12)),expectedRevision:base.revision,value:{value}})};
}
const checkpoint=(f,base,value)=>({id:randomUUID(),workspaceId:f.book.id,recordId:f.record.id,expectedRevision:null,selection:{field:base.field,revision:base.revision,storageRevision:base.storageRevision},value:{value}});

test('contributor additions, corrections and removals merge by identity and retain paged membership and old attributions',async t=>{
 const f=await fixture(t),old=(await f.workspace.outline()).etag;
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Contributor operation reconstructed a whole record');});
 const items=RecordDocument.prototype.items;t.mock.method(RecordDocument.prototype,'items',function(path,...rest){if(path[0]==='contributors')throw Error('Selected read scanned the entire contributor collection');return items.call(this,path,...rest);});
 const first=await f.values.read(f.target(f.record.contributors[0].id)),last=await f.values.read(f.target(f.record.contributors.at(-1).id));
 RecordDocument.prototype.items.mock.restore();
 await f.save(first,{name:'Corrected name',role:'Analysis'});await f.save(last,{name:'Late contributor',role:'Review'});
 await assert.rejects(f.save(first,null),{code:'RECORD_CHANGED'});
 const added=await f.values.read(f.target(randomUUID()));assert.equal(added.value.value,null);
 const saved=await f.save(added,{name:'New contributor',role:'Field work'});assert.deepEqual(await f.save(added,{name:'New contributor',role:'Field work'}),saved);
 const current=await f.values.read(f.target(f.record.contributors[0].id));await f.save(current,null);await f.save(current,null);
 // Deletion shifts positions; the untouched identity, not its earlier offset,
 // must still be selected after a prior contributor disappears.
 assert.deepEqual((await f.values.read(f.target(f.record.contributors[1].id))).value.value,{name:'Contributor 1',role:'Role 1'});
 await assert.rejects(f.save(current,{name:'Old edit',role:''}),{code:'RECORD_CHANGED'});
 const content=new RecordContent(f.workspace),prior=await content.read({workspaceId:f.book.id,recordId:f.record.id,snapshotId:old,pagedHeader:true});assert.deepEqual(prior.header.contributors,f.record.contributors.slice(0,4));
 const tail=await content.read({workspaceId:f.book.id,recordId:f.record.id,pagedHeader:true,windows:{contributors:71}});
 assert.equal(tail.collections.contributors.total,73);assert.equal(tail.header.contributors[0].name,'Late contributor');assert.equal(tail.header.contributors[1].name,'New contributor');
 await f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),f.record.id),members=new RecordMemberCollections(store);assert.equal(memberCollectionCount(row,'contributors'),73);assert.equal(await members.position(row,'contributors',f.record.contributors[0].id),-1);assert.equal(await members.position(row,'contributors',added.field.slice(12)),72);await store.verifySnapshot(undefined,f.book.id);});
 await assert.rejects(f.values.read({...f.target(randomUUID()),workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 await assert.rejects(f.save(added,{id:randomUUID(),name:'Injected identity',role:''}),{code:'INVALID'});
});

test('contributor checkpoints retain incomplete additions and deletions on a heavy record through fresh-key recovery',async t=>{
 const f=await fixture(t,{large:true});t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Heavy contributor editing or recovery reconstructed a whole record');});
 const last=f.record.contributors.at(-1),base=await f.values.read(f.target(last.id));
 await f.save(base,{name:last.name,role:'Exact retained measurements'});
 const removal=checkpoint(f,await f.values.read(f.target(last.id)),null),addition=checkpoint(f,await f.values.read(f.target(randomUUID())),{name:'',role:'Unfinished credit'}),lookups=[];
 for(const command of [removal,addition]){const receipt=await f.drafts.write(command);assert.deepEqual(await f.drafts.write(command),receipt);const lookup={id:command.id,workspaceId:f.book.id,expectedRevision:receipt.revision};assert.deepEqual((await f.drafts.read(lookup)).value,command.value);lookups.push(lookup);}
 await assert.rejects(f.save(await f.values.read(f.target(addition.selection.field.slice(12))),addition.value.value),{code:'INVALID'});
 const retained=await new ResearchDrafts(f.workspace).read(removal.id,{header:true});
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>withDraftDocument(store,retained.draft,async document=>{
  const tampered=await new RecordDocument(document.blocks,document.root,{mutable:true}).replace(['contributors','0','role'],'Unselected change');await tampered.blocks.flush();
  await assert.rejects(verifyRecordValueDraft(store,{...retained.draft,document:{...retained.draft.document,root:tampered.root}}),{code:'CATALOGUE_DAMAGED'});
 })));
 const access=await createAccess('','synthetic contributor recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const root=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'recovered')),access,vault,f.vault),workspace=new Workspace(root,vault),drafts=new RecordValueDrafts(workspace),values=new RecordValues(workspace);
 for(let i=0;i<lookups.length;i++)assert.deepEqual((await drafts.read(lookups[i])).value,[removal,addition][i].value);
 const recovered=await drafts.read(lookups[0]);assert.deepEqual(recovered.definition.original,{name:last.name,role:'Exact retained measurements'});
 await values.save({...f.target(last.id),expectedRevision:removal.selection.revision,value:removal.value});
 await values.save({...f.target(addition.selection.field.slice(12)),expectedRevision:addition.selection.revision,value:{value:{name:'Recovered contributor',role:addition.value.value.role}}});
 await workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),f.record.id);await withRecordDocument(store,row.id,row.revision,async document=>{
  assert.equal(document.blocks.scopeId,f.record.notebookId);assert.equal((await document.field(['body'])).value,f.record.body);
  for(let i=0;i<f.record.sections.length;i++)assert.deepEqual((await document.field(['sections',String(i)])).value,f.record.sections[i]);
  for(let i=0;i<f.record.contributors.length-1;i++)assert.deepEqual((await document.field(['contributors',String(i)])).value,f.record.contributors[i]);
 });});
 assert.equal((await values.read(f.target(last.id))).value.value,null);
});

test('invalid and interrupted contributor membership changes leave the committed record and indexes intact',async t=>{
 const f=await fixture(t,{count:0}),base=await f.values.read(f.target(randomUUID())),before=await f.workspace.outline();
 await assert.rejects(f.save(base,{name:'   ',role:''}),{code:'INVALID'});assert.equal((await f.workspace.outline()).etag,before.etag);
 const finish=ResearchCatalogue.prototype.finishRecordChanges;t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){await finish.apply(this,args);throw Error('Interrupted contributor commit');});
 await assert.rejects(f.save(base,{name:'New attribution',role:'Author'}),/Interrupted contributor commit/);ResearchCatalogue.prototype.finishRecordChanges.mock.restore();
 assert.equal((await f.workspace.outline()).etag,before.etag);assert.equal((await f.values.read(f.target(base.field.slice(12)))).value.value,null);
 await f.save(base,{name:'New attribution',role:'Author'});const changed=await f.values.read(f.target(base.field.slice(12)));await f.save(changed,null);
 await f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),f.record.id);assert.equal(memberCollectionCount(row,'contributors'),0);await store.verifySnapshot(undefined,f.book.id);});
});
