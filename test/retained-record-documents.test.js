import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {RetainedRecordDocuments} from '../src/retained-record-documents.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordValues} from '../src/record-values.js';
import {RecordSectionCommands} from '../src/record-section-commands.js';
import {RecordContent} from '../src/record-content.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {catalogueFormat} from '../src/catalogue-format.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {admitParts} from '../src/collaboration/research-package.js';

const file=ref=>'.observanda/materials/records/'+ref.id+'/'+ref.revision+'.json';
async function fixture(t){const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-retained-doc-')),book=sampleNotebook();book.entries=[book.entries[0]];const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return {...f,directory,book,record:book.entries[0],materials:new ResearchMaterials(f.workspace),reader:new RetainedRecordDocuments(f.workspace)};}
async function revision(workspace,id){return workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),id),index=store.historyIndex(id),found=await index.lookup(await index.head(),'version',row.revision);return (await index.display(found.item)).revision;});}
function noReconstruction(t){t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Retaining a reference reconstructed a whole record');});const read=RecordValueTree.prototype.read;t.mock.method(RecordValueTree.prototype,'read',async function(ref){const result=await read.call(this,ref);if(result&&typeof result==='object'&&'notebookId'in result&&'sections'in result)throw Error('Reading a reference reconstructed its root');return result;});}

test('large references pin original blocks and read late sections, figures and fixed comparisons',async t=>{
 const f=await figureValueFixture({large:true});t.after(f.close);const canonical=await revision(f.workspace,f.record.id),reader=new RetainedRecordDocuments(f.workspace);noReconstruction(t);
 const ref=await f.materials.pinRecord(f.record.id,canonical),raw=await f.workspace.readMetadata(file(ref),4096);assert.ok(Buffer.byteLength(raw)<1024);assert.equal(JSON.parse(raw).format,'observanda-retained-record');assert.deepEqual(await f.materials.pinRecord(f.record.id,canonical),ref);await f.materials.checkReference(ref);
 let result=await reader.read({ref,offset:69,windows:{figures:8}});assert.equal(result.previous.sections.total,73);assert.equal(result.previous.sections.values[3].id,f.record.sections[72].id);assert.equal(result.previous.record.figures[0].id,f.record.figures[8].id);assert.equal(result.previous.collections.figures.total,9);
 const anchor='record-section-'+f.record.sections[72].id;result=await reader.read({ref,anchor});assert.ok(result.search.nextCursor);result=await reader.read({ref,anchor,cursor:result.search.nextCursor});assert.equal(result.found,72);assert.equal(result.previous.sections.values[0].id,f.record.sections[72].id);
 const values=new RecordValues(f.workspace),target={workspaceId:f.book.id,recordId:f.record.id,field:'title'},value=await values.read(target);await values.save({...target,expectedRevision:value.revision,value:{value:'Changed after retention'}});
 result=await reader.read({ref,compare:true});assert.equal(result.previous.header.title,f.record.title);assert.equal(result.current.header.title,'Changed after retention');const snapshot=result.currentSnapshotId;
 const next=await values.read(target);await values.save({...target,expectedRevision:next.revision,value:{value:'Later concurrent title'}});assert.equal((await reader.read({ref,compare:true,currentSnapshotId:snapshot})).current.header.title,'Changed after retention');assert.equal((await reader.read({ref,compare:true})).current.header.title,'Later concurrent title');
 await assert.rejects(f.materials.pinRecord(f.record.id,canonical),{code:'RECORD_CHANGED'});await assert.rejects(reader.read({ref:{...ref,workspaceId:randomUUID()}}),{code:'WORKSPACE_CHANGED'});
 await new ResearchRecords(f.workspace,{}).remove({workspaceId:f.book.id,recordId:f.record.id,expectedRevision:await revision(f.workspace,f.record.id)});result=await reader.read({ref,compare:true,offset:72});assert.equal(result.current,null);assert.equal(result.previous.sections.values[0].id,f.record.sections[72].id);await f.materials.checkReference(ref);
});

test('comparison can navigate beyond the retained length and late header collections',async t=>{
 const f=await fixture(t),ref=await f.materials.pinRecord(f.record.id,await revision(f.workspace,f.record.id)),sections=new RecordSectionCommands(f.workspace);noReconstruction(t);
 for(let i=0;i<7;i++){const base=await new RecordContent(f.workspace).read({workspaceId:f.book.id,recordId:f.record.id,pagedHeader:true});await sections.run({workspaceId:f.book.id,recordId:f.record.id,sectionId:randomUUID(),action:'insert',beforeId:null,expectedStructureRevision:base.structureRevision,value:{title:'New section '+i,body:'Later observation'}});}
 const result=await f.reader.read({ref,compare:true,offset:5});assert.equal(result.offset,5);assert.equal(result.current.sections.offset,5);assert.equal(result.current.sections.values[0].title,'New section 5');assert.equal(result.previous.sections.total,0);
});

test('retained pointers roll back failed admission and survive fresh-key backup',async t=>{
 const f=await fixture(t),canonical=await revision(f.workspace,f.record.id),before=await f.workspace.catalogue(store=>catalogueFormat(store.db)),write=f.workspace.writeMetadata.bind(f.workspace);
 t.mock.method(f.workspace,'writeMetadata',async(...args)=>{await write(...args);throw Error('Injected pointer write failure');});await assert.rejects(f.materials.pinRecord(f.record.id,canonical),/Injected/);f.workspace.writeMetadata.mock.restore();assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),before);assert.equal(await f.workspace.readMetadata(file({id:f.record.id,revision:canonical}),4096),null);
 const ref=await f.materials.pinRecord(f.record.id,canonical);assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),8);
 const access=await createAccess('','retained reference recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));const copied=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'backup')),access,vault,f.vault),restored=new Workspace(copied,vault),materials=new ResearchMaterials(restored);await materials.verify();assert.equal((await new RetainedRecordDocuments(restored).read({ref})).previous.header.title,f.record.title);
 const original=await restored.readMetadata(file(ref),4096),pointer=JSON.parse(original);pointer.revision='a'.repeat(64);await restored.withLock(()=>restored.writeMetadata(file(ref),JSON.stringify(pointer)));await assert.rejects(materials.checkReference(ref),{code:'MATERIAL_MISSING'});
});

test('legacy reference outside history stays readable and portable record admission preserves a local pointer',async t=>{
 const f=await fixture(t),original=(await f.workspace.read()).book.entries[0],ref=await f.materials.pinRecord(f.record.id,recordRevision(original)),legacy={...structuredClone(original),title:'Old reference outside recorded history'},legacyRef={kind:'record',id:legacy.id,revision:recordRevision(legacy)},name=file(ref);
 await f.workspace.withLock(()=>f.workspace.writeMetadata(file(legacyRef),JSON.stringify(legacy)));const before=(await f.workspace.outline()).etag;noReconstruction(t);assert.equal((await f.reader.read({ref:legacyRef})).previous.header.title,legacy.title);await f.materials.checkReference(legacyRef);assert.equal((await f.workspace.outline()).etag,before);
 const part={kind:'metadata',name},parts=value=>({async *items(){yield part;},content(){return Buffer.from(JSON.stringify(value));}});await f.workspace.withLock(()=>admitParts(f.workspace,parts(original)));assert.equal(JSON.parse(await f.workspace.readMetadata(name,4096)).format,'observanda-retained-record');await assert.rejects(f.workspace.withLock(()=>admitParts(f.workspace,parts(legacy))),{code:'COLLABORATION_PACKAGE'});
});


test('opening an indexed revision pages its original blocks without retaining another material',async t=>{
 const f=await figureValueFixture({large:true});t.after(f.close);const ref={kind:'record',workspaceId:f.book.id,id:f.record.id,revision:await revision(f.workspace,f.record.id)},reader=new RetainedRecordDocuments(f.workspace);
 const before=(await f.workspace.outline()).etag;assert.equal(await f.workspace.readMetadata(file(ref),4096),null);noReconstruction(t);
 const result=await reader.read({ref,offset:69});assert.equal(result.previous.sections.values[3].id,f.record.sections[72].id);
 assert.equal(await f.workspace.readMetadata(file(ref),4096),null);assert.equal((await f.workspace.outline()).etag,before);
 await assert.rejects(reader.check(ref),{code:'MATERIAL_MISSING'});
 await assert.rejects(reader.read({ref:{...ref,revision:'0'.repeat(64)}}),{code:'MATERIAL_MISSING'});
 await assert.rejects(reader.read({ref:{...ref,workspaceId:randomUUID()}}),{code:'WORKSPACE_CHANGED'});
 await new ResearchRecords(f.workspace,{}).remove({workspaceId:f.book.id,recordId:f.record.id,expectedRevision:ref.revision});
 const deleted=await reader.read({ref,offset:72,compare:true});assert.equal(deleted.current,null);assert.equal(deleted.previous.sections.values[0].id,f.record.sections[72].id);
});
