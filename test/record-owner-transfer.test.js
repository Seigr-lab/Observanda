import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {projectTreeFixture} from './project-tree-fixture.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {RecordOwnerTransfer} from '../src/record-owner-transfer.js';
import {RetainedRecordDocuments} from '../src/retained-record-documents.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {EvidenceCorrections} from '../src/evidence-corrections.js';
import {referenceOriginKey,referenceNamespaceMatches} from '../src/research-reference-namespace.js';
import {RunReceiptStore} from '../src/run-receipt-store.js';
import {verifyRecordOwnerTransfers} from '../src/record-owner-transfer-verification.js';
import {copyLabBookLocation} from '../src/lab-book-transfer.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {clearVault} from '../src/encryption.js';
import {atomicWrite,workspaceFile,serialize,privateDirectory} from '../src/storage.js';
import {rekeyCatalogue,verifyCatalogueArchive} from '../src/research-catalogue.js';
import {workspaceFiles} from '../src/workspace-inventory.js';
import {FileContent,describeContent,contentBuffer} from '../src/file-content.js';
import {readRecordOwnerTransfer,writeRecordOwnerTransfer} from '../src/record-owner-transfer-state.js';
const media={get:async()=>{throw Error('Unexpected media');}};
const column=name=>({name,representation:'text',radix:10,unit:'',missing:[{value:'',meaning:'Not acquired'}],time:{kind:'none',reference:'',resolution:'',uncertainty:''}});
async function upload(materials,recordId,name,bytes){const session=await materials.startImport({recordId,name,size:bytes.length,provenance:'Synthetic acquisition'});for(let offset=0,index=0;offset<bytes.length;offset+=session.chunkSize,index++)await materials.appendImport(session.id,index,[bytes.subarray(offset,offset+session.chunkSize)]);return materials.finishImport(session.id);}

test('selected owner move retains exact evidence, unavailable sibling provenance, completed receipts and portable recovery',{timeout:360000},async t=>{
 const f=await projectTreeFixture(t),[from,to]=f.books,source=new LabBookStorage(from.root,from.labBookId,from.key),target=new LabBookStorage(to.root,to.labBookId,to.key),materials=new ResearchMaterials(source),incoming=new ResearchMaterials(target),record=from.before.book.entries[0];
 const directory=new LabBookDirectory(f.registry);for(const book of [from,to])await directory.register(book.projectId,book);
 const sibling={...structuredClone(record),id:randomUUID(),title:'Unmoved evidence owner',body:'Sibling original is never copied'};await new ResearchRecords(source,media).save({workspaceId:from.namespaceId,changes:[{id:sibling.id,expectedRevision:null,record:sibling}]});
 const sourceOwner={projectId:from.projectId,labBookId:from.labBookId,workspaceId:from.namespaceId},targetOwner={projectId:to.projectId,labBookId:to.labBookId,workspaceId:to.namespaceId},engine=new RecordOwnerTransfer(source,target,{registry:f.registry,sourceOwner,targetOwner});
 const base=await source.catalogue(async store=>store.member(await store.snapshot(),record.id)),command={id:randomUUID(),workspaceId:from.namespaceId,recordId:record.id,sourceNotebookId:from.labBookId,expectedStorageRevision:base.revision,targetWorkspaceId:to.namespaceId,targetNotebookId:to.labBookId};
 const bytes=Buffer.from('Time,Observation\n0,first\n1,second\n'),pending=await materials.startImport({recordId:record.id,name:'observations.csv',size:bytes.length});
 await assert.rejects(engine.start(command),{code:'RECORD_TRANSFER_PENDING'});assert.equal(await engine.status({workspaceId:from.namespaceId,recordId:record.id}),null);
 await materials.appendImport(pending.id,0,[bytes]);const artifact=await materials.finishImport(pending.id),dataset=await materials.dataset({recordId:record.id,title:'Exact observations',artifact,columns:[column('Time'),column('Observation')]});
 const siblingArtifact=await upload(materials,sibling.id,'sibling.txt',Buffer.from('Unmoved sibling evidence'));
 const analysis=await materials.analysis({recordId:record.id,title:'Retained analysis',tool:'Synthetic',version:'1',parameters:'',inputs:[dataset,siblingArtifact],outputs:[]}),collection=await materials.collection({recordId:record.id,title:'Collected evidence',inputs:[artifact,dataset,analysis]});
 const retired=await upload(materials,record.id,'retired.txt',Buffer.from('Retired original remains readable')),corrections=new EvidenceCorrections(materials),retire={recordId:record.id,ref:retired,action:'retire',reason:'Synthetic retirement',metadata:null,replacementRecordId:null},review=await corrections.preview(retire),event=await corrections.apply({command:retire,review:review.review});
 const legacyRecord={...structuredClone(record),title:'Standalone retained original',body:'An older retained original outside saved history'},legacyRef=await source.withLock(()=>materials.retainRecord(legacyRecord));
 const largeBytes=Buffer.alloc(3*1024*1024+17,42),large=await upload(materials,record.id,'large.bin',largeBytes);
 const receipt={id:randomUUID(),kind:'validation',recordRevision:recordRevision(record),recordedAt:'2026-01-01T00:00:00.000Z'};await source.withLock(()=>new RunReceiptStore(source,record.id).appendLocked(receipt));
 const expected=new Map();for(const ref of [artifact,dataset,analysis,collection,retired,large])expected.set(ref.id,await materials.read(ref));let interrupted=false;
 const savedRef={kind:'record',id:record.id,revision:recordRevision(record),workspaceId:from.namespaceId};
 const cancelledCommand={...command,id:randomUUID()},cancelRequest={workspaceId:from.namespaceId,recordId:record.id,id:cancelledCommand.id};
 await assert.rejects(engine.start(cancelledCommand,{checkpoint:async stage=>{if(stage==='history'){await assert.rejects(new RetainedRecordDocuments(target).read({ref:savedRef}),{code:'MATERIAL_INCOMPLETE'});throw Error('Synthetic cancellation checkpoint');}}}),/Synthetic cancellation checkpoint/);
 const targetLock=target.withLock;target.withLock=async()=>{throw Error('Synthetic destination cancellation refusal');};
 try{await assert.rejects(engine.cancel(cancelRequest),/Synthetic destination cancellation refusal/);}finally{target.withLock=targetLock;}
 assert.equal((await engine.status(cancelRequest)).phase,'cancelled');assert.equal((await target.catalogue(store=>readRecordOwnerTransfer(store,cancelledCommand.id))).phase,'copying');
 const cancelled=await engine.resume(cancelRequest);assert.equal(cancelled.phase,'cancelled');assert.equal((await target.catalogue(store=>readRecordOwnerTransfer(store,cancelledCommand.id))).phase,'cancelled');assert.deepEqual(await engine.cancel(cancelRequest),cancelled);assert.deepEqual(await engine.start(cancelledCommand),cancelled);
 await assert.rejects(new RetainedRecordDocuments(target).read({ref:savedRef}),{code:'WORKSPACE_CHANGED'});
 assert.equal(Number((await target.catalogue(store=>store.db.get('SELECT COUNT(*) AS n FROM records WHERE id=$1',record.id))).n),0);
 t.diagnostic('Cancelled source reconciles an interrupted destination update on exact retry; a new command follows.');
 const originalCopy=FileContent.prototype.copyTo;let copying=false,copiedBytes=0,lifeChecks=0;
 FileContent.prototype.copyTo=async function(owner,file,options){if(owner!==target||this.sha256!==expected.get(large.id).content.sha256)return originalCopy.call(this,owner,file,options);copying=true;try{return await originalCopy.call(this,owner,file,{...options,onProgress:async done=>{copiedBytes=done;}});}finally{copying=false;}};
 try{await assert.rejects(engine.start(command,{check:async()=>{if(copying&&copiedBytes){lifeChecks++;throw Error('Synthetic lifecycle interruption');}}}),/Synthetic lifecycle interruption/);}finally{FileContent.prototype.copyTo=originalCopy;}
 assert.ok(lifeChecks);assert.ok(copiedBytes>0&&copiedBytes<largeBytes.length);assert.equal((await engine.status({workspaceId:from.namespaceId,recordId:record.id})).phase,'copying');
 await assert.rejects(engine.start(command,{checkpoint:async stage=>{
  if(stage!=='evidence'||interrupted)return;interrupted=true;
  await assert.rejects(incoming.read(artifact),{code:'MATERIAL_INCOMPLETE'});await assert.rejects(incoming.read(retired),{code:'MATERIAL_INCOMPLETE'});
  const other=(await source.read()).book.entries.find(value=>value.id===sibling.id);await new ResearchRecords(source,media).save({workspaceId:from.namespaceId,changes:[{id:sibling.id,expectedRevision:recordRevision(other),record:{...other,title:'Foreground authoring stayed available'}}]});
  await assert.rejects(new ResearchRecords(source,media).save({workspaceId:from.namespaceId,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Fenced edit'}}]}),{code:'RECORD_TRANSFER_BUSY'});throw Error('Synthetic checkpoint interruption');
 }}),/Synthetic checkpoint interruption/);assert.ok(interrupted);
 const resumed=await new RecordOwnerTransfer(source,target,{registry:f.registry,sourceOwner,targetOwner}).resume({workspaceId:from.namespaceId,recordId:record.id,id:command.id});assert.equal(resumed.phase,'complete');assert.deepEqual(await engine.start(command),resumed);
 async function check(owner){
  const selected=new ResearchMaterials(owner);assert.deepEqual(await selected.read(legacyRef),legacyRecord);for(const ref of [artifact,dataset,analysis,collection,retired,large])assert.deepEqual(await selected.read(ref),expected.get(ref.id));
  assert.deepEqual(await contentBuffer((await selected.artifact(artifact)).content),bytes);assert.deepEqual(await contentBuffer((await selected.artifact(large)).content),largeBytes);assert.deepEqual((await selected.datasetPage(dataset)).rows.map(row=>row.cells),[['0','first'],['1','second']]);
  assert.equal(await selected.current(retired.id),null);assert.deepEqual((await new EvidenceCorrections(selected).history({recordId:record.id})).items.map(value=>value.id),[event.id]);assert.deepEqual((await new RunReceiptStore(owner,record.id).page({})).items,[receipt]);
  assert.deepEqual(await selected.referenceAddress(siblingArtifact),{...siblingArtifact,workspaceId:from.namespaceId});await assert.rejects(selected.read(siblingArtifact),{code:'MATERIAL_MISSING'});
  await owner.catalogue(async store=>{assert.equal((await store.db.get('SELECT COUNT(*)::text AS n FROM records WHERE id=$1',sibling.id)).n,'0');await verifyRecordOwnerTransfers(store);});await selected.verify();
 }
 await check(target);t.diagnostic('Completed move: exact originals, receipts, provenance, interruption/replay and verifier passed.');assert.equal((await source.read()).book.entries.some(value=>value.id===record.id),false);assert.equal((await source.read()).book.entries.find(value=>value.id===sibling.id).title,'Foreground authoring stayed available');
 const redirected=await f.registry.reference({workspaceId:from.namespaceId,kind:'record',id:record.id});assert.equal(redirected.labBookId,to.labBookId);
 for(const portable of [false,true]){const parent=path.join(f.directory,portable?'Portable copies':'Ordinary copies');await mkdir(parent);const copied=await copyLabBookLocation(target,path.join(parent,path.basename(target.root)),{id:randomUUID(),portable});await check(copied);t.diagnostic((portable?'Portable':'Ordinary')+' owner copy passed.');}
 const parent=path.join(f.directory,'Fresh key copies');await mkdir(parent);const root=path.join(parent,path.basename(target.root)),access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(f.directory,'fresh-device')})),key=takeCreatedVault(access);t.after(()=>clearVault(key));const fresh=new LabBookStorage(root,to.labBookId,key);await mkdir(path.join(root,'.observanda'),{recursive:true});await atomicWrite(path.join(root,'.observanda/access.json'),serialize(access));
 const descriptorText=await target.readFile(await workspaceFile(target.root),'utf8');await fresh.writeFile(await workspaceFile(root,{secure:true}),descriptorText);
 for await(const file of workspaceFiles(target.root,{includeDatabase:false}))if(/^\.observanda\/(?:materials\/originals|media)\//.test(file.path)){await privateDirectory(root,path.posix.dirname(file.path));await (await describeContent(target,path.join(target.root,file.path))).copyTo(fresh,path.join(root,file.path));}
 await rekeyCatalogue(target,fresh,JSON.parse(descriptorText));await check(fresh);await verifyCatalogueArchive(fresh,JSON.parse(descriptorText));t.diagnostic('Fresh-key recovery and archive verification passed.');
 const restore={...retire,action:'restore',reason:'Restore in destination'},plan=await new EvidenceCorrections(incoming).preview(restore);await new EvidenceCorrections(incoming).apply({command:restore,review:plan.review});assert.equal((await incoming.current(retired.id)).revision,retired.revision);await incoming.verify();await target.catalogue(store=>verifyRecordOwnerTransfers(store));
 const returning=new RecordOwnerTransfer(target,source,{registry:f.registry,sourceOwner:targetOwner,targetOwner:sourceOwner}),returnMember=await target.catalogue(async store=>store.member(await store.snapshot(),record.id)),returnCommand={id:randomUUID(),workspaceId:to.namespaceId,recordId:record.id,sourceNotebookId:to.labBookId,expectedStorageRevision:returnMember.revision,targetWorkspaceId:from.namespaceId,targetNotebookId:from.labBookId};
 const returned=await returning.start(returnCommand);assert.equal(returned.phase,'complete');t.diagnostic('Actual return move completed.');assert.deepEqual(await returning.start(returnCommand),returned);
 assert.equal((await source.read()).book.entries.some(value=>value.id===record.id),true);assert.equal((await target.read()).book.entries.some(value=>value.id===record.id),false);assert.equal((await materials.current(retired.id)).revision,retired.revision);
 for(const ref of [artifact,dataset,analysis,collection,retired,large])assert.deepEqual(await materials.read(ref),expected.get(ref.id));assert.deepEqual(await contentBuffer((await materials.artifact(large)).content),largeBytes);
 assert.deepEqual(await materials.referenceAddress(siblingArtifact),siblingArtifact);assert.deepEqual(await materials.read(siblingArtifact),await materials.readStored(siblingArtifact));
 assert.equal((await f.registry.reference({workspaceId:from.namespaceId,kind:'record',id:record.id})).labBookId,from.labBookId);assert.equal((await f.registry.reference({workspaceId:to.namespaceId,kind:'record',id:record.id})).labBookId,from.labBookId);
 await materials.verify();await source.catalogue(store=>verifyRecordOwnerTransfers(store));await target.catalogue(store=>verifyRecordOwnerTransfers(store));
 const completed=await source.catalogue(store=>readRecordOwnerTransfer(store,returnCommand.id));assert.equal(completed.progress.previousOwnerTransfer,command.id);
 await source.withLock(()=>source.catalogue(store=>writeRecordOwnerTransfer(store,{...completed,progress:{...completed.progress,previousOwnerTransfer:randomUUID()}})));await assert.rejects(source.catalogue(store=>verifyRecordOwnerTransfers(store)),{code:'CATALOGUE_DAMAGED'});await source.withLock(()=>source.catalogue(store=>writeRecordOwnerTransfer(store,completed)));
 await verifyCatalogueArchive(source,JSON.parse(await source.readFile(await workspaceFile(source.root),'utf8')));

});

test('project record move preserves authenticated former namespaces for external evidence',{timeout:180000},async t=>{
 const f=await projectTreeFixture(t),project=f.projects[0],[original,to]=f.books,source=new ProjectStorage(project.root,project.projectId,project.key),target=new LabBookStorage(to.root,to.labBookId,to.key),materials=new ResearchMaterials(source);
 await new LabBookDirectory(f.registry).register(to.projectId,to);
 const record={...structuredClone(original.before.book.entries[0]),id:randomUUID()},sibling={...structuredClone(record),id:randomUUID(),title:'Retained sibling'};
 await source.update(book=>{book.notebooks=[structuredClone(original.before.book.notebooks[0])];book.entries=[record,sibling];return book;});
 const savedRecord=(await source.read()).book.entries.find(item=>item.id===record.id);
 const namespace=(await source.outline()).metadata.id,artifact=await upload(materials,sibling.id,'sibling.txt',Buffer.from('Original sibling evidence')),owned=await upload(materials,record.id,'owned.txt',Buffer.from('Original owned evidence')),priorNamespace=randomUUID(),qualified={...artifact,workspaceId:priorNamespace},qualifiedOwned={...owned,workspaceId:priorNamespace},qualifiedRecord={kind:'record',id:record.id,revision:recordRevision(savedRecord),workspaceId:priorNamespace};
 await source.withLock(()=>source.catalogue(async store=>{
  await store.putObject('project:research-migration',{version:1,projectId:project.projectId,namespaceId:namespace,sourceNamespace:priorNamespace});
  for(const ref of [qualified,qualifiedOwned,qualifiedRecord])await store.putObject(referenceOriginKey(ref),{version:1,projectId:project.projectId,namespaceId:namespace,sourceNamespace:priorNamespace,kind:ref.kind,id:ref.id});
  assert.equal(await referenceNamespaceMatches(store,qualified),true);
  assert.equal(await referenceNamespaceMatches(store,{...qualified,id:randomUUID()}),false);
 }));
 const analysis=await materials.analysis({recordId:record.id,title:'References retain their addresses',tool:'Synthetic',version:'1',parameters:'',inputs:[artifact,qualified,qualifiedOwned,qualifiedRecord],outputs:[]}),expected=await materials.read(analysis);
 const sourceOwner={projectId:project.projectId,labBookId:null,workspaceId:namespace},targetOwner={projectId:to.projectId,labBookId:to.labBookId,workspaceId:to.namespaceId};
 const member=await source.catalogue(async store=>store.member(await store.snapshot(),record.id)),engine=new RecordOwnerTransfer(source,target,{registry:f.registry,sourceOwner,targetOwner});
 const command={id:randomUUID(),workspaceId:namespace,recordId:record.id,sourceNotebookId:record.notebookId,expectedStorageRevision:member.revision,targetWorkspaceId:to.namespaceId,targetNotebookId:to.labBookId};
 // Resume an already-prepared transfer whose former identity witnesses were
 // not retained by the writer that prepared it.
 const prepare=engine.prepareCurrent;engine.prepareCurrent=async function(...args){const result=await prepare.apply(this,args);await target.withLock(()=>target.catalogue(async store=>{for(const ref of [qualifiedOwned,qualifiedRecord])await store.deleteObject('record:reference-origin:'+ref.kind+':'+ref.id+':'+priorNamespace);}));throw Error('Interrupted prepared transfer');};
 await assert.rejects(engine.start(command),/Interrupted prepared transfer/);engine.prepareCurrent=prepare;
 const result=await engine.start(command);assert.equal(result.phase,'complete');
 const incoming=new ResearchMaterials(target);assert.deepEqual(await incoming.read(analysis),expected);
 assert.deepEqual(await incoming.read(qualifiedOwned),await materials.read(owned));assert.deepEqual(await incoming.read(qualifiedRecord),savedRecord);
 const redirect=await f.registry.reference({workspaceId:priorNamespace,kind:'record',id:record.id});assert.equal(redirect.labBookId,to.labBookId);
 assert.deepEqual(await incoming.referenceAddress(artifact),{...artifact,workspaceId:namespace});
 assert.deepEqual(await incoming.referenceAddress(qualified),qualified);await assert.rejects(incoming.read(qualified),{code:'MATERIAL_INVALID'});
 assert.deepEqual(await materials.read(qualified),await materials.read(artifact));
 assert.equal((await source.read()).book.entries.some(item=>item.id===sibling.id),true);
 assert.equal((await source.read()).book.entries.some(item=>item.id===record.id),false);
 await target.catalogue(store=>verifyRecordOwnerTransfers(store));await incoming.verify();
});
