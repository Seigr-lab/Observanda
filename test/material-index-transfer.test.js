import {stageRecordOwnerMaterialIdentity} from '../src/material-visibility.js';
import {executeMaterialRequest,materialRequest} from '../src/material-requests.js';
import {EvidenceCorrections} from '../src/evidence-corrections.js';
import {intakeHash} from '../src/intake/contract.js';
import {fileFingerprint} from '../src/web/evidence-fingerprint.js';
import {readRecordOwnerAuditMetadata,readRecordOwnerMetadata,recordOwnerAuditPathKey,recordOwnerAuditPartKey,classifyRecordOwnerAuditMetadata,verifyRecordOwnerEvidenceReceipts} from '../src/record-owner-audit-metadata.js';
import {test} from 'node:test';
import {AppError} from '../src/errors.js';
import {retainRecordOwnerExternalReference,recordOwnerExternalReference} from '../src/record-owner-provenance.js';
import {analysisDependencyState} from '../src/analysis-dependencies.js';
import {createComparisonInputReader} from '../src/comparison-input-reader.js';
import {LiveMaterialReading} from '../src/collaboration/live-material-reading.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {intakeFixture} from './fixtures/local-intake.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {digest} from '../src/storage-format.js';
import {revisionText} from '../src/web/revision-model.js';
import {recordOwnerTransferFingerprint,writeRecordOwnerTransfer} from '../src/record-owner-transfer-state.js';
import {runEvidenceRevision} from '../src/run-receipts.js';
import {RunReadiness} from '../src/run-readiness.js';
const kinds=['artifact','dataset','analysis','collection'];
const empty=()=>({format:1,kind:'references',root:null,count:0,chunkSize:64});
async function incoming(f,{selectedKinds=kinds,sourceInput=null}={}){
 const materials=new ResearchMaterials(f.ws),sourceOwner={projectId:null,labBookId:null,workspaceId:randomUUID()},targetOwner={projectId:null,labBookId:null,workspaceId:f.book.id},id=randomUUID(),createdAt='2026-01-01T00:00:00.000Z';
 const receipt=await f.ws.withLock(()=>f.ws.catalogue(async store=>{
  const sourceSnapshotId=await store.head(),snapshot=await store.snapshot(sourceSnapshotId),member=await store.member(snapshot,f.record.id),command={id,workspaceId:sourceOwner.workspaceId,recordId:f.record.id,sourceNotebookId:f.record.notebookId,expectedStorageRevision:member.revision,targetWorkspaceId:f.book.id,targetNotebookId:f.record.notebookId};
  const receipt={version:1,id,fingerprint:recordOwnerTransferFingerprint(command,sourceOwner,targetOwner),command,sourceOwner,targetOwner,phase:'copying',sourceSnapshotId,createdAt,updatedAt:createdAt,progress:{segmentId:randomUUID()},result:null};await writeRecordOwnerTransfer(store,receipt);await materials.index.ensureLocked();return receipt;
 }));
 const heads=[],docs=[],sequences=Object.fromEntries(['all',...kinds].map(kind=>[kind,empty()]));
 // The fixture exercises authenticated index visibility; byte/dataset admission
 // remains the transfer engine's domain validation before this staging API.
 for(const kind of selectedKinds)for(let i=0;i<2;i++){
  const doc={format:1,kind,id:randomUUID(),recordId:f.record.id,title:kind+' '+i,createdAt:'2025-12-01T00:00:00.000Z',previous:null,content:{inputs:sourceInput?[sourceInput]:[],...(kind==='analysis'?{tool:'Synthetic source analysis',version:'1',parameters:'',outputs:[]}:{})}},ref={kind,id:doc.id,revision:digest(revisionText(doc))};
  docs.push(doc);heads.push({...ref,recordId:doc.recordId,title:doc.title,createdAt:doc.createdAt,inputs:doc.content.inputs,figureHash:null,figureId:null,ownerTransfer:receipt.id});
 }
 for(let offset=0;offset<heads.length;offset+=4)await f.ws.withLock(async()=>{
  for(let i=offset;i<Math.min(offset+4,heads.length);i++){
   await materials.index.stageTransferHead(heads[i],docs[i],{transferId:receipt.id});const ref={kind:heads[i].kind,id:heads[i].id,revision:heads[i].revision};sequences.all=await materials.sequences.append(sequences.all,[ref]);sequences[ref.kind]=await materials.sequences.append(sequences[ref.kind],[ref]);
  }
 });
 receipt.progress.evidence={version:1,segmentId:receipt.progress.segmentId,recordId:f.record.id,createdAt:receipt.createdAt,sequences};await f.ws.withLock(()=>f.ws.catalogue(store=>writeRecordOwnerTransfer(store,receipt)));
 const publish=()=>materials.index.publishTransfer({id:receipt.id,...receipt.progress.evidence}),activate=()=>f.ws.withLock(()=>f.ws.catalogue(async store=>{await publish();receipt.phase='complete';await writeRecordOwnerTransfer(store,receipt);}));
 return {materials,receipt,heads,docs,publish,activate};
}
async function all(materials,recordId,kind=null){let cursor=null,items=[];do{const page=await materials.list({recordId,kind,limit:2,cursor});items.push(...page.items);cursor=page.next;}while(cursor);return items;}

test('transfer segments atomically expose all four kinds with bounded pages and exact retirement, restore and later amendment',async t=>{
 const f=await intakeFixture(t),state=await incoming(f),{materials,receipt,heads}=state,generation=(await materials.index.state()).generation;
 for(const head of heads){assert.equal(await materials.current(head.id),null);await assert.rejects(materials.read(head),{code:'MATERIAL_INCOMPLETE'});await assert.rejects(materials.index.inputSet(head),{code:'MATERIAL_INCOMPLETE'});}assert.deepEqual(await all(materials,f.record.id),[]);
 await assert.rejects(f.ws.withLock(()=>f.ws.catalogue(async store=>{await state.publish();await writeRecordOwnerTransfer(store,{...receipt,phase:'complete'});throw new Error('activation interruption');})),/activation interruption/);assert.equal((await materials.index.state()).generation,generation);assert.deepEqual(await all(materials,f.record.id),[]);
 await state.activate();assert.equal((await materials.index.state()).generation,generation+1);assert.deepEqual((await all(materials,f.record.id)).map(row=>row.id),heads.map(row=>row.id));
 for(const kind of kinds)assert.deepEqual((await all(materials,f.record.id,kind)).map(row=>row.id),heads.filter(row=>row.kind===kind).map(row=>row.id));await f.ws.catalogue(()=>materials.index.verify({initialize:false}));
 const retired=heads.find(row=>row.kind==='dataset');await f.ws.withLock(async()=>{await materials.index.removeHead(retired);await f.ws.removeMetadata(materials.relative(materials.metadataFile('objects/'+retired.id+'/head.json')));});assert.equal((await all(materials,f.record.id,'dataset')).length,1);await f.ws.catalogue(()=>materials.index.verify({initialize:false}));
 await f.ws.withLock(async()=>{await materials.put(materials.metadataFile('objects/'+retired.id+'/head.json'),retired);await materials.index.changed(retired,state.docs.find(doc=>doc.id===retired.id));});assert.equal((await all(materials,f.record.id,'dataset')).length,2);await f.ws.catalogue(()=>materials.index.verify({initialize:false}));
 // LocalIntake can amend a transferred analysis without changing its segment's
 // order; its precomputed run digest must use that proposed current revision.
 const previous=heads.find(head=>head.kind==='analysis'),source=await materials.pinRecord(f.record.id,f.manifest.expectedRevision);f.manifest.files=[];f.manifest.analyses[0]={...f.manifest.analyses[0],id:previous.id,expectedRevision:previous.revision,inputs:[source]};await f.write();const preview=await f.service.preview(f.command),command={...f.command,expectedPin:preview.pin};await f.service.stage(command);await f.worker.runOnce();await f.service.apply(command);await f.worker.runOnce();const status=await f.service.status(command);assert.equal(status.state,'completed',JSON.stringify(status));
 const current=await materials.current(previous.id);assert.equal(current.ownerTransfer,receipt.id);assert.notEqual(current.revision,previous.revision);assert.equal((await all(materials,f.record.id,'analysis')).find(item=>item.id===previous.id).revision,current.revision);const ready=(await new RunReadiness(f.ws).receiptPage(f.record.id)).items[0];assert.equal(ready.evidenceRevision,await runEvidenceRevision(f.ws,f.record.id));await f.ws.catalogue(()=>materials.index.verify({initialize:false}));
});

test('transfer segments reject wrong owner receipts, forged heads and changed sequence bindings',async t=>{
 const f=await intakeFixture(t),state=await incoming(f),{materials,receipt,heads,docs}=state;
 await assert.rejects(f.ws.withLock(()=>materials.index.stageTransferHead({...heads[0],title:'forged title'},docs[0],{transferId:receipt.id})),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(f.ws.withLock(()=>materials.index.stageTransferHead({...heads[0],stagedBatch:randomUUID()},docs[0],{transferId:receipt.id})),{code:'CATALOGUE_DAMAGED'});
 const altered={...receipt,targetOwner:{...receipt.targetOwner,workspaceId:randomUUID()},command:{...receipt.command,targetWorkspaceId:randomUUID()}};altered.command.targetWorkspaceId=altered.targetOwner.workspaceId;altered.fingerprint=recordOwnerTransferFingerprint(altered.command,altered.sourceOwner,altered.targetOwner);await f.ws.withLock(()=>f.ws.catalogue(store=>writeRecordOwnerTransfer(store,altered)));await assert.rejects(materials.current(heads[0].id),{code:'CATALOGUE_DAMAGED'});
 await f.ws.withLock(()=>f.ws.catalogue(store=>writeRecordOwnerTransfer(store,receipt)));await state.activate();const file=materials.index.segments.file(receipt.id),original=await f.ws.readMetadata(file,8192),value=JSON.parse(original);value.createdAt='2026-01-02T00:00:00.000Z';await f.ws.withLock(()=>f.ws.writeMetadata(file,JSON.stringify(value)));await assert.rejects(materials.index.segments.read(receipt.id),{code:'CATALOGUE_DAMAGED'});await f.ws.withLock(()=>f.ws.writeMetadata(file,original));
 const evidence={...receipt.progress.evidence,sequences:{...receipt.progress.evidence.sequences,analysis:receipt.progress.evidence.sequences.dataset}};await assert.rejects(f.ws.withLock(()=>materials.index.publishTransfer({id:receipt.id,...evidence})),{code:'CATALOGUE_DAMAGED'});assert.equal((await all(materials,f.record.id)).length,8);
});


test('exact external-origin witnesses preserve unavailable sibling dependencies without foreign reads or namespace loss',async t=>{
 const f=await intakeFixture(t),external={kind:'artifact',id:randomUUID(),revision:digest('unavailable sibling original')},state=await incoming(f,{selectedKinds:['analysis'],sourceInput:external}),{materials,receipt,heads}=state;
 await f.ws.withLock(()=>f.ws.catalogue(store=>retainRecordOwnerExternalReference(store,receipt,external)));await state.activate();
 const qualified={...external,workspaceId:receipt.sourceOwner.workspaceId};assert.deepEqual(await recordOwnerExternalReference(f.ws,external),qualified);assert.deepEqual(await recordOwnerExternalReference(f.ws,qualified),qualified);assert.equal(await recordOwnerExternalReference(f.ws,{...external,workspaceId:randomUUID()}),null);
 await assert.rejects(materials.read(qualified),{code:'MATERIAL_INVALID'});
 const read=materials.read.bind(materials);t.mock.method(materials,'read',async ref=>{assert.notEqual(ref.id,external.id,'No implicit foreign evidence read');return read(ref);});
 const addressed=materialRequest('/api/research/materials/reference-addresses');assert.equal(addressed.write,false);assert.deepEqual(await executeMaterialRequest(f.ws,addressed,{ref:heads[0],items:[external]}),{items:[qualified]});await assert.rejects(executeMaterialRequest(f.ws,addressed,{ref:heads[0],items:Array(33).fill(external)}),{code:'MATERIAL_INVALID'});
 const page=await materials.referencePage(heads[0]);assert.deepEqual(page.items,[{...qualified,title:external.id,unavailable:true}]);assert.deepEqual(await Array.fromAsync(materials.index.iterInputs(heads[0])),[qualified]);
 const review=await analysisDependencyState(materials,[{recordId:f.record.id,analysis:{kind:heads[0].kind,id:heads[0].id,revision:heads[0].revision}}]);assert.equal(review.items.length,1);assert.equal(review.items[0].changed,1);assert.equal(review.items[0].sample[0].workspaceId,qualified.workspaceId);assert.equal(review.items[0].sample[0].current,null);
 const overview=await materials.overview(f.record.id);assert.ok(overview.items.every(item=>item.changedCount===1&&item.changed[0].workspaceId===qualified.workspaceId));
 const access={verify:async()=>{},close:async()=>{},use:async(ref,consume)=>{if(ref.workspaceId!==f.book.id)throw new AppError('ACCESS_LOCKED');return consume(f.ws,ref);}},reader=createComparisonInputReader(materials,{workspaceId:f.book.id,access});try{assert.deepEqual(await Array.fromAsync(reader.inputs(heads[0])),[qualified]);await assert.rejects(reader.current(qualified),{code:'ACCESS_LOCKED'});}finally{await reader.close();}
 const live=new LiveMaterialReading(f.ws,async()=>{}),peer={notebookIds:[f.record.notebookId]};await f.ws.catalogue(async store=>{const page=await live.page(store,peer,null,{ref:heads[0],slot:'inputs'});assert.deepEqual(page.items,[{withheld:true}]);await assert.rejects(live.read(store,peer,null,heads[0],[{slot:'inputs',index:0}]),{code:'COLLABORATION_DENIED'});});
 const verified=await f.ws.catalogue(()=>materials.verifySnapshot({readOnly:true}));assert.equal(verified.externalReferences,1);
 const saved=await f.ws.catalogue(async store=>{const keys=await Array.fromAsync(store.objectIdEntries('record-owner-external:'));assert.equal(keys.length,1);return {key:keys[0],value:await store.object(keys[0])};});await f.ws.withLock(()=>f.ws.catalogue(store=>store.putObject(saved.key,{...saved.value,namespaceId:randomUUID()})));await assert.rejects(recordOwnerExternalReference(f.ws,external),{code:'CATALOGUE_DAMAGED'});await f.ws.withLock(()=>f.ws.catalogue(store=>store.putObject(saved.key,saved.value)));assert.deepEqual(await recordOwnerExternalReference(f.ws,external),qualified);
});


test('completed receipt aliases preserve domain readers, retired originals and exact hashes across transfer activation',async t=>{
 const f=await intakeFixture(t),materials=new ResearchMaterials(f.ws),file={name:'empty.bin',size:0,fingerprint:await fileFingerprint(0,[],digest)},batch=await materials.intakes.start({recordId:f.record.id,title:'Completed acquisition',count:1,bytes:0});
 const release=f.queue.release.bind(f.queue);t.mock.method(f.queue,'release',async(...args)=>{if(args[2]?.error)t.diagnostic(args[2].error.stack);return release(...args);});
 await materials.intakes.append({id:batch.id,offset:0,items:[file]});await materials.intakes.enqueue(batch.id,f.queue);await f.worker.runOnce();const completed=await f.queue.read(batch.id);assert.equal(completed.state,'completed',JSON.stringify(completed));
 const intakePage=await materials.intakes.page({id:batch.id}),artifact=intakePage.items[0].completed,corrections=new EvidenceCorrections(materials);
 const choice=await materials.choices.change({recordId:f.record.id,kind:'artifact',ref:artifact,checked:true}),association=await materials.associations.start({recordId:f.record.id,selection:choice.selection,count:1});await materials.associations.step(association.id);
 const command={recordId:f.record.id,ref:artifact,action:'retire',reason:'Synthetic correction',metadata:null,replacementRecordId:null},plan=await corrections.preview(command),event=await corrections.apply({command,review:plan.review});
 const state=await incoming(f,{selectedKinds:[]}),{receipt}=state;
 const associationFile=materials.associations.file(association.id),savedAssociation=await materials.associations.read(association.id);savedAssociation.selection.scope=JSON.stringify({...JSON.parse(savedAssociation.selection.scope),workspaceId:receipt.sourceOwner.workspaceId});await f.ws.withLock(()=>f.ws.writeMetadata(associationFile,JSON.stringify(savedAssociation)));
 await assert.rejects(materials.choices.pagePinned(savedAssociation.selection),{code:'MATERIAL_INVALID'});
 // A synthetic completed LocalIntake receipt proves exact old manifest scope
 // resolution independently of external folders or an active source owner.
 const manifest={...structuredClone(f.manifest),workspaceId:receipt.sourceOwner.workspaceId},pin=intakeHash(manifest),proposal={version:1,id:manifest.id,manifest,pin,state:'completed',createdAt:receipt.createdAt,prepared:[],receipt:{pin,files:[],analyses:[]},stageJob:randomUUID(),applyJob:randomUUID()};
 const job={format:1,id:proposal.applyJob,type:'intake.apply',scope:f.record.id,state:'completed',attempt:1,progress:{stage:'completed',done:0,total:0},result:proposal.receipt,error:null,cancelRequested:false,createdAt:receipt.createdAt,updatedAt:receipt.createdAt,input:{id:proposal.id},lease:null};
 await f.ws.withLock(async()=>{await f.ws.writeMetadata(f.service.file(proposal.id),JSON.stringify(proposal));await f.ws.writeMetadata('.observanda/jobs/'+job.id+'.json',JSON.stringify(job));});
 const rows=await f.ws.catalogue(async store=>{const rows=[];for await(const key of store.objectIdEntries('metadata:')){const relative=key.slice(9),owner=await classifyRecordOwnerAuditMetadata(f.ws,relative);if(owner?.recordId===f.record.id&&!owner.direct)rows.push({relative,text:await f.ws.readMetadata(relative,16*1024*1024)});}return rows;});assert.ok(rows.length>6);
 await f.ws.withLock(()=>f.ws.catalogue(async store=>{
  let audit={format:1,kind:'files',root:null,count:0,chunkSize:64};
  for(const row of rows){const sha256=digest(row.text),bytes=Buffer.byteLength(row.text),alias={version:1,relative:row.relative,recordId:f.record.id,transferId:receipt.id,sha256,bytes};await store.putObject(recordOwnerAuditPathKey(row.relative),alias);await store.putObject(recordOwnerAuditPartKey(receipt.id,row.relative),{version:1,transferId:receipt.id,recordId:f.record.id,relative:row.relative,text:row.text});audit=await materials.sequences.append(audit,[{name:row.relative,sha256,bytes}]);await f.ws.removeMetadata(row.relative);}
  receipt.progress.evidence.audit=audit;receipt.progress.evidence.revisions=await materials.sequences.append(empty(),[artifact]);await writeRecordOwnerTransfer(store,receipt);await store.putObject('record-owner-evidence-identity:artifact:'+artifact.id,{version:1,kind:'artifact',id:artifact.id,recordId:f.record.id,transferId:receipt.id});
 }));
 assert.equal(await readRecordOwnerAuditMetadata(f.ws,f.service.file(proposal.id)),null);await assert.rejects(materials.read(artifact),{code:'MATERIAL_INCOMPLETE'});await assert.rejects(materials.index.inputSet(artifact),{code:'MATERIAL_INCOMPLETE'});
 await f.ws.catalogue(store=>verifyRecordOwnerEvidenceReceipts(store));await state.activate();
 assert.deepEqual(await materials.intakes.page({id:batch.id}),intakePage);assert.equal((await materials.associations.read(association.id)).state,'completed');assert.equal((await materials.associations.selection(await materials.associations.read(association.id))).items[0].id,artifact.id);
 assert.equal((await corrections.history({recordId:f.record.id})).items[0].id,event.id);assert.equal((await corrections.status(artifact)).lastEvent,event.id);assert.equal((await materials.read(artifact)).id,artifact.id);
 const status=await f.service.status({workspaceId:f.book.id,recordId:f.record.id,id:proposal.id});assert.equal(status.state,'completed');assert.equal(status.workspaceId,receipt.sourceOwner.workspaceId);assert.equal(status.pin,pin);assert.equal(status.job.state,'completed');assert.equal((await f.service.executionManifest(manifest)).workspaceId,f.book.id);
 for(const row of rows)assert.equal(await readRecordOwnerMetadata(f.ws,row.relative,16*1024*1024),row.text);
 const restore={...command,action:'restore'},review=await corrections.preview(restore);await corrections.apply({command:restore,review:review.review});const restored=await materials.current(artifact.id);assert.equal(restored.revision,artifact.revision);assert.equal(restored.stagedBatch,undefined);assert.equal(restored.ownerTransfer,undefined);
 await f.ws.catalogue(store=>verifyRecordOwnerEvidenceReceipts(store));
 const relative=f.service.file(proposal.id),key=recordOwnerAuditPartKey(receipt.id,relative),saved=await f.ws.catalogue(store=>store.object(key));await f.ws.withLock(()=>f.ws.catalogue(store=>store.putObject(key,{...saved,text:saved.text+' '})));await assert.rejects(readRecordOwnerAuditMetadata(f.ws,relative),{code:'CATALOGUE_DAMAGED'});await assert.rejects(f.ws.catalogue(store=>verifyRecordOwnerEvidenceReceipts(store)),{code:'CATALOGUE_DAMAGED'});await f.ws.withLock(()=>f.ws.catalogue(store=>store.putObject(key,saved)));
 await assert.rejects(readRecordOwnerAuditMetadata(f.ws,relative,{recordId:randomUUID()}),{code:'CATALOGUE_DAMAGED'});
 const retained=receipt.progress.evidence.revisions;receipt.progress.evidence.revisions=empty();await f.ws.withLock(()=>f.ws.catalogue(store=>writeRecordOwnerTransfer(store,receipt)));await assert.rejects(f.ws.catalogue(store=>verifyRecordOwnerEvidenceReceipts(store)),{code:'CATALOGUE_DAMAGED'});receipt.progress.evidence.revisions=retained;await f.ws.withLock(()=>f.ws.catalogue(store=>writeRecordOwnerTransfer(store,receipt)));await f.ws.catalogue(store=>verifyRecordOwnerEvidenceReceipts(store));
});


test('return staging preserves unvisited old exact revisions while new copied revisions stay hidden',async t=>{
 const f=await intakeFixture(t),materials=new ResearchMaterials(f.ws),first=await materials.collection({recordId:f.record.id,title:'Earlier collection',inputs:[]}),second=await materials.collection({recordId:f.record.id,id:first.id,expectedRevision:first.revision,title:'Former current collection',inputs:[]}),state=await incoming(f,{selectedKinds:[]}),{receipt}=state;
 const id=randomUUID(),sourceOwner=receipt.targetOwner,targetOwner=receipt.sourceOwner,command={...receipt.command,id,workspaceId:sourceOwner.workspaceId,targetWorkspaceId:targetOwner.workspaceId},previous={...receipt,id,sourceOwner,targetOwner,command,fingerprint:recordOwnerTransferFingerprint(command,sourceOwner,targetOwner),phase:'complete',progress:{},result:null};receipt.progress.previousOwnerTransfer=id;
 await f.ws.withLock(()=>f.ws.catalogue(async store=>{await writeRecordOwnerTransfer(store,previous);await writeRecordOwnerTransfer(store,receipt);}));
 const old=await materials.readStored(second),doc={...old,title:'Returned collection',previous:second.revision,createdAt:'2026-02-01T00:00:00.000Z'},next={kind:doc.kind,id:doc.id,revision:digest(revisionText(doc))};
 await f.ws.withLock(()=>f.ws.catalogue(async store=>{await stageRecordOwnerMaterialIdentity(f.ws,receipt,next,doc,{store});await materials.put(materials.metadataFile('objects/'+next.id+'/'+next.revision+'.json'),doc);}));
 assert.equal((await materials.read(first)).title,'Earlier collection');assert.equal((await materials.read(second)).title,'Former current collection');await assert.rejects(materials.read(next),{code:'MATERIAL_INCOMPLETE'});await assert.rejects(materials.index.inputSet(next),{code:'MATERIAL_INCOMPLETE'});
 await f.ws.withLock(()=>f.ws.catalogue(async store=>{await stageRecordOwnerMaterialIdentity(f.ws,receipt,next,doc,{store});await stageRecordOwnerMaterialIdentity(f.ws,receipt,first,await materials.readStored(first),{store});}));
 assert.equal((await materials.read(first)).title,'Earlier collection');await assert.rejects(materials.read(next),{code:'MATERIAL_INCOMPLETE'});
 // A false checkpoint still has to authenticate the exact retained identity.
 const checkpointKey='record-owner-evidence-prior:'+receipt.id+':'+next.kind+':'+next.id+':'+next.revision,checkpoint=await f.ws.catalogue(store=>store.object(checkpointKey));
 await f.ws.withLock(()=>f.ws.catalogue(store=>store.putObject(checkpointKey,{...checkpoint,recordId:randomUUID()})));
 await assert.rejects(materials.read(next),{code:'CATALOGUE_DAMAGED'});await assert.rejects(materials.index.inputSet(next),{code:'CATALOGUE_DAMAGED'});await assert.rejects(f.ws.withLock(()=>f.ws.catalogue(store=>stageRecordOwnerMaterialIdentity(f.ws,receipt,next,doc,{store}))),{code:'CATALOGUE_DAMAGED'});
 await f.ws.withLock(()=>f.ws.catalogue(store=>store.putObject(checkpointKey,checkpoint)));
 // A new command after cancellation cannot treat leftover copied bytes as old.
 receipt.phase='cancelled';await f.ws.withLock(()=>f.ws.catalogue(store=>writeRecordOwnerTransfer(store,receipt)));
 const retry={...structuredClone(receipt),id:randomUUID(),phase:'copying'};retry.command.id=retry.id;retry.fingerprint=recordOwnerTransferFingerprint(retry.command,retry.sourceOwner,retry.targetOwner);
 await f.ws.withLock(()=>f.ws.catalogue(async store=>{await writeRecordOwnerTransfer(store,retry);await stageRecordOwnerMaterialIdentity(f.ws,retry,second,await materials.readStored(second),{store});}));
 assert.equal((await materials.read(first)).title,'Earlier collection');await assert.rejects(materials.read(next),{code:'MATERIAL_INCOMPLETE'});
 await f.ws.withLock(()=>f.ws.catalogue(store=>stageRecordOwnerMaterialIdentity(f.ws,retry,next,doc,{store})));await assert.rejects(materials.read(next),{code:'MATERIAL_INCOMPLETE'});
 receipt.phase='copying';await f.ws.withLock(()=>f.ws.catalogue(async store=>{await writeRecordOwnerTransfer(store,receipt);await stageRecordOwnerMaterialIdentity(f.ws,receipt,next,doc,{store});}));
 await state.activate();assert.equal((await materials.read(next)).title,'Returned collection');assert.equal((await materials.read(first)).title,'Earlier collection');
});
