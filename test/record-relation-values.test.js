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
import {SnapshotIndex} from '../src/snapshot-index.js';
import {withRecordDocument,RecordDocument} from '../src/record-document.js';
import {withDraftDocument} from '../src/record-draft-document.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {recordRevision} from '../src/research.js';
import {researchReference} from '../src/web/research-reference.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';

async function fixture(t,{large=false,parentType='experiment'}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-relation-values-')),book=sampleNotebook(),record=book.entries[2],method=book.entries[0],parent=book.entries[1];book.entries=[record,method,parent];record.type='run';parent.type=parentType;
 record.relations=Array.from({length:73},(_,i)=>({id:randomUUID(),type:'Related to',label:'Reference '+i,target:{workspaceId:randomUUID(),kind:'record',id:randomUUID()}}));
 record.sections=Array.from({length:large?73:2},(_,i)=>({id:randomUUID(),title:'Section '+i,body:large?'exact'.repeat(5600):'Original '+i}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 if(large){const writing=new RecordWriting(f.workspace),target={workspaceId:book.id,recordId:record.id,sectionId:null},base=await writing.read(target);record.body='Extended observations '.repeat(2500);await writing.save({...target,expectedRevision:base.revision,value:{body:record.body}});assert.ok(Buffer.byteLength(JSON.stringify(record))>2*1024*1024);}
 const values=new RecordValues(f.workspace),drafts=new RecordValueDrafts(f.workspace),target=id=>({workspaceId:book.id,recordId:record.id,field:'relation:'+id});
 const original=ResearchCatalogue.prototype.record;t.mock.method(ResearchCatalogue.prototype,'record',function(id,...args){if(id===record.id)throw Error('Research links reconstructed the source record');return original.call(this,id,...args);});
 return {...f,directory,book,record,method,parent,values,drafts,target,save:(base,value)=>values.save({...target(base.field.slice(9)),expectedRevision:base.revision,value:{value}})};
}
const link=(f,target,role)=>({type:role??'Related to',label:'Chosen target',reference:researchReference({workspaceId:f.book.id,kind:'record',id:target.id,...(target.revision?{revision:target.revision}:{})}),...(role?{role}:{})});
const checkpoint=(f,base,value)=>({id:randomUUID(),workspaceId:f.book.id,recordId:f.record.id,expectedRevision:null,selection:{field:base.field,revision:base.revision,storageRevision:base.storageRevision},value:{value}});

test('selected research links compose, preserve exact methods and maintain paged membership and run-parent indexes',async t=>{
 const f=await fixture(t),before=(await f.workspace.outline()).etag;
 const items=RecordDocument.prototype.items;t.mock.method(RecordDocument.prototype,'items',function(path,...rest){if(path[0]==='relations')throw Error('Selected read scanned all links');return items.call(this,path,...rest);});
 const first=await f.values.read(f.target(f.record.relations[0].id)),last=await f.values.read(f.target(f.record.relations.at(-1).id));RecordDocument.prototype.items.mock.restore();
 await f.save(first,{...first.value.value,label:'Corrected first'});await f.save(last,{...last.value.value,label:'Corrected last'});await assert.rejects(f.save(first,null),{code:'RECORD_CHANGED'});
 const materials=new ResearchMaterials(f.workspace),pinned=await materials.pinRecord(f.method.id,recordRevision(f.method)),base=await f.values.read(f.target(randomUUID())),value=link(f,pinned,'uses-method');
 const saved=await f.save(base,value);assert.deepEqual(await f.save(base,value),saved);
 const reordered=Object.fromEntries(Object.entries(value).reverse());assert.deepEqual(await f.save(base,reordered),saved);assert.equal((await f.values.read(f.target(base.field.slice(9)))).revision,saved.revision);await assert.rejects(f.save(base,{...reordered,label:'A different method description'}),{code:'RECORD_CHANGED'});
 const titleTarget={workspaceId:f.book.id,recordId:f.method.id,field:'title'},title=await f.values.read(titleTarget);await f.values.save({...titleTarget,expectedRevision:title.revision,value:{value:'Later method'}});
 assert.equal((await materials.read(pinned)).title,f.method.title);assert.equal((await f.values.read(f.target(base.field.slice(9)))).value.value.reference,value.reference);
 const parent=await f.values.read(f.target(randomUUID())),parentValue=link(f,f.parent,'run-of');await f.save(parent,parentValue);
 await f.workspace.catalogue(async store=>{const snapshot=await store.snapshot(),row=await store.member(snapshot,f.record.id);assert.deepEqual(row.runOf,[{workspaceId:f.book.id,kind:'record',id:f.parent.id}]);assert.equal((await Array.fromAsync(new SnapshotIndex(store).entries({root:snapshot.membership},'run:'+f.parent.id+':'))).length,1);await store.verifySnapshot(undefined,f.book.id);});
 const another=await f.values.read(f.target(randomUUID()));await assert.rejects(f.save(another,link(f,f.method,'run-of')),{code:'INVALID'});
 await assert.rejects(f.save(another,{...value,reference:researchReference({workspaceId:f.book.id,kind:'record',id:f.method.id})}),{code:'INVALID'});
 await assert.rejects(f.save(another,link(f,f.record)),{code:'INVALID'});await assert.rejects(f.save(another,value),{code:'INVALID'});
 const currentParent=await f.values.read(f.target(parent.field.slice(9)));await f.save(currentParent,null);await f.save(currentParent,null);
 await f.workspace.catalogue(async store=>{const snapshot=await store.snapshot(),row=await store.member(snapshot,f.record.id);assert.deepEqual(row.runOf,[]);assert.equal((await Array.fromAsync(new SnapshotIndex(store).entries({root:snapshot.membership},'run:'+f.parent.id+':'))).length,0);assert.equal(memberCollectionCount(row,'relations'),74);assert.equal(await new RecordMemberCollections(store).position(row,'relations',base.field.slice(9)),73);await store.verifySnapshot(undefined,f.book.id);});
 const old=await new RecordContent(f.workspace).read({workspaceId:f.book.id,recordId:f.record.id,snapshotId:before,pagedHeader:true});assert.deepEqual(old.header.relations,f.record.relations.slice(0,4));
});

test('heavy-record link drafts preserve incomplete references and removals through fresh-key recovery and reject unrelated edits',async t=>{
 const f=await fixture(t,{large:true}),base=await f.values.read(f.target(f.record.relations.at(-1).id)),addition=await f.values.read(f.target(randomUUID()));
 const commands=[checkpoint(f,base,null),checkpoint(f,addition,{type:'',label:'Work in progress',reference:'observanda://unfinished'})],lookups=[];
 for(const command of commands){const receipt=await f.drafts.write(command);assert.deepEqual(await f.drafts.write(command),receipt);const lookup={id:command.id,workspaceId:f.book.id,expectedRevision:receipt.revision};assert.deepEqual((await f.drafts.read(lookup)).value,command.value);lookups.push(lookup);}
 await assert.rejects(f.save(addition,commands[1].value.value),{code:'INVALID'});
 const retained=await new ResearchDrafts(f.workspace).read(commands[0].id,{header:true});await f.workspace.withLock(()=>f.workspace.catalogue(store=>withDraftDocument(store,retained.draft,async document=>{
  const tampered=await new RecordDocument(document.blocks,document.root,{mutable:true}).replace(['relations','0','label'],'Unselected edit');await tampered.blocks.flush();await assert.rejects(verifyRecordValueDraft(store,{...retained.draft,document:{...retained.draft.document,root:tampered.root}}),{code:'CATALOGUE_DAMAGED'});
 })));
 const access=await createAccess('','synthetic link recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));const root=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'recovered')),access,vault,f.vault),workspace=new Workspace(root,vault),drafts=new RecordValueDrafts(workspace),values=new RecordValues(workspace);
 for(let i=0;i<lookups.length;i++)assert.deepEqual((await drafts.read(lookups[i])).value,commands[i].value);
 await values.save({...f.target(base.field.slice(9)),expectedRevision:base.revision,value:{value:null}});await values.save({...f.target(addition.field.slice(9)),expectedRevision:addition.revision,value:{value:link(f,f.parent,'run-of')}});
 await workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),f.record.id);await withRecordDocument(store,row.id,row.revision,async document=>{
  assert.equal(document.blocks.scopeId,f.record.notebookId);assert.equal((await document.field(['body'])).value,f.record.body);for(let i=0;i<f.record.sections.length;i++)assert.deepEqual((await document.field(['sections',String(i)])).value,f.record.sections[i]);for(let i=0;i<f.record.relations.length-1;i++)assert.deepEqual((await document.field(['relations',String(i)])).value,f.record.relations[i]);
 });});
});

test('failed relationship commits and incompatible run parents leave both graph and record unchanged',async t=>{
 const f=await fixture(t,{parentType:'run'}),base=await f.values.read(f.target(randomUUID())),before=(await f.workspace.outline()).etag;
 const target={workspaceId:f.book.id,recordId:f.method.id,field:'title'},title=await f.values.read(target);assert.ok(title.value.value);
 // A run cannot become the parent investigation of another run.
 await assert.rejects(f.save(base,link(f,f.parent,'run-of')),{code:'INVALID'});
 const finish=ResearchCatalogue.prototype.finishRecordChanges;t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){await finish.apply(this,args);throw Error('Interrupted link commit');});
 await assert.rejects(f.save(base,link(f,f.method,'run-of')),/Interrupted link commit/);ResearchCatalogue.prototype.finishRecordChanges.mock.restore();
 assert.equal((await f.workspace.outline()).etag,before);assert.equal((await f.values.read(f.target(base.field.slice(9)))).value.value,null);
 await f.save(base,link(f,f.method,'run-of'));await f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
});
