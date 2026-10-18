import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {lstat} from 'node:fs/promises';
import path from 'node:path';
import {intakeFixture} from './fixtures/local-intake.js';
import {digest,serialize} from '../src/storage-format.js';
import {privateDirectory,Workspace} from '../src/storage.js';
import {withMetadataBatch,withFlushedMetadataBatch} from '../src/metadata-batch.js';
import {FileContent} from '../src/file-content.js';
import {checkpointedFileName} from '../src/checkpointed-file-copy.js';
import {recordOwnerTransferFingerprint,writeRecordOwnerTransfer,setRecordOwnerFence,withRecordOwnerTransferWrite} from '../src/record-owner-transfer-state.js';
import {initializeRecordOwnerReclamation,retainRecordOwnerResource,adoptRecordOwnerResource,reclaimRecordOwnerResources,readRecordOwnerReclamation,verifyRecordOwnerResources,commitRecordOwnerResources,compactRecordOwnerResources,recordOwnerResourcesTracking} from '../src/record-owner-resources.js';
const exists=file=>lstat(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
const state=value=>({kind:'state',key:'resource-test:'+digest(serialize(value)),revision:digest(serialize(value))});

test('cancellation reclaims interrupted original copies, preserves preexisting and adopted dependencies, and compacts completed claims',{timeout:90000},async t=>{
 const f=await intakeFixture(t),ws=f.ws,sourceOwner={projectId:null,labBookId:null,workspaceId:randomUUID()},targetOwner={projectId:null,labBookId:null,workspaceId:f.book.id},snapshotId=await ws.catalogue(store=>store.head()),timestamp='2026-01-01T00:00:00.000Z';
 const receipt=()=>{const id=randomUUID(),command={id,workspaceId:sourceOwner.workspaceId,recordId:f.record.id,sourceNotebookId:randomUUID(),expectedStorageRevision:digest('synthetic original'),targetWorkspaceId:f.book.id,targetNotebookId:f.record.notebookId};return {version:1,id,command,sourceOwner,targetOwner,fingerprint:recordOwnerTransferFingerprint(command,sourceOwner,targetOwner),phase:'copying',sourceSnapshotId:snapshotId,createdAt:timestamp,updatedAt:timestamp,progress:{},result:null};};
 const active=receipt(),write=value=>operation=>ws.withLock(()=>ws.catalogue(store=>withRecordOwnerTransferWrite(store,value,()=>operation(store)))),install=value=>write(value)(async store=>{await writeRecordOwnerTransfer(store,value);await setRecordOwnerFence(store,value,'incoming');await initializeRecordOwnerReclamation(store,value);});
 const phantom=randomUUID(),resourceKey=digest('unowned resource'),address={kind:'state',key:'resource-test:unowned'},chain=digest(serialize({address,transferId:phantom})),chainSlot='record-owner-resource-chain:'+chain;
 const orphans=[
  ['record-owner-resource-claim:'+resourceKey+':'+phantom,{version:1,transferId:phantom,recordId:f.record.id,resourceKey}],
  ['record-owner-reclaim:'+phantom+':resource:0000000000000000',{version:1,transferId:phantom,recordId:f.record.id,resourceKey}],
  ['record-owner-reclaim:'+phantom+':mutation:0000000000000000',{version:1,transferId:phantom,recordId:f.record.id,chain,changes:[{address,before:null,after:resourceKey}],dependencies:[]}],
  ['record-owner-reclaim:'+phantom+':pending:'+resourceKey,{version:1,resourceKey}],
  ['record-owner-reclaim:'+phantom+':proof:'+digest(serialize(chainSlot)),{version:1,slot:chainSlot,transferId:phantom}],
  [chainSlot,{version:1,address,transferId:phantom,retained:false,after:resourceKey}],
  ['record-owner-resource-address:'+digest(serialize(address)),{version:1,transferId:phantom,chain,after:resourceKey}]
 ];
 const rejectOrphan=async([slot,value])=>{
  await ws.withLock(()=>ws.catalogue(store=>store.db.run('INSERT INTO state VALUES ($1,$2)',slot,store.encode('state',slot,value))));
  try{await assert.rejects(ws.catalogue(store=>verifyRecordOwnerResources(store)),{code:'CATALOGUE_DAMAGED'},slot);}
  finally{await ws.withLock(()=>ws.catalogue(store=>store.db.run('DELETE FROM state WHERE slot=$1',slot)));}
 };
 // These rows used to bypass the no-pending-journal early return.
 for(const orphan of orphans)await rejectOrphan(orphan);await ws.catalogue(store=>verifyRecordOwnerResources(store));
 await install(active);
 // A valid pending journal must not confer ownership on an unrelated row.
 for(const orphan of orphans.slice(1))await rejectOrphan(orphan);await ws.catalogue(store=>verifyRecordOwnerResources(store));
 const bytes=Buffer.alloc(3*1024*1024,83),sha256=digest(bytes),sourceName='.observanda/materials/originals/'+randomUUID()+'/original';await privateDirectory(ws.root,path.posix.dirname(sourceName));const sourceFile=ws.metadataPath(sourceName);await ws.writeFile(sourceFile,bytes);const content=new FileContent(ws,sourceFile,bytes.length,sha256);
 const fileResource=()=>({kind:'file',relative:'.observanda/materials/originals/'+randomUUID()+'/original',bytes:bytes.length,sha256}),partial=fileResource(),completed=fileResource(),prior={kind:'file',relative:sourceName,bytes:bytes.length,sha256};
 for(const resource of [partial,completed]){await privateDirectory(ws.root,path.posix.dirname(resource.relative));await write(active)(store=>retainRecordOwnerResource(store,resource,{present:false}));}
 await write(active)(store=>retainRecordOwnerResource(store,prior,{present:true}));
 await assert.rejects(content.copyTo(ws,ws.metadataPath(partial.relative),{resume:true,onProgress:done=>{if(done>0)throw new DOMException('Injected copy interruption','AbortError');}}),{name:'AbortError'});
 const partialFile=checkpointedFileName(content,ws,ws.metadataPath(partial.relative));assert.equal(await exists(partialFile),true);assert.equal(await exists(ws.metadataPath(partial.relative)),false);
 await content.copyTo(ws,ws.metadataPath(completed.relative),{resume:true});assert.equal(await exists(ws.metadataPath(completed.relative)),true);
 const childValue={data:'retained only through an adopted parent'},parentValue={root:state(childValue).revision},orphanValue={data:'unadopted'},child=state(childValue),parent=state(parentValue),orphan=state(orphanValue);
 await write(active)(async store=>{for(const [resource,value,dependencies] of [[child,childValue,[]],[parent,parentValue,[child]],[orphan,orphanValue,[]]]){await retainRecordOwnerResource(store,resource,{present:false,dependencies});await store.db.run('INSERT INTO state VALUES ($1,$2)',resource.key,store.encode('state',resource.key,value));}});
 await ws.withLock(()=>ws.catalogue(store=>adoptRecordOwnerResource(store,parent)));await ws.catalogue(store=>verifyRecordOwnerResources(store));
 active.phase='cancelled';active.progress.reclamation={version:1,state:'pending'};await write(active)(store=>writeRecordOwnerTransfer(store,active));
 let interrupted=false;await assert.rejects(reclaimRecordOwnerResources(ws,active,{write:write(active),checkpoint:stage=>{if(stage==='resources'&&!interrupted){interrupted=true;throw Error('Injected cleanup interruption');}}}),/Injected cleanup interruption/);
 assert.equal((await ws.catalogue(store=>readRecordOwnerReclamation(store,active.id))).state,'cleaning');await ws.catalogue(store=>verifyRecordOwnerResources(store));
 const result=await reclaimRecordOwnerResources(ws,active,{write:write(active)});assert.equal(result.state,'complete');assert.equal(await exists(partialFile),false);assert.equal(await exists(ws.metadataPath(completed.relative)),false);assert.equal(await exists(sourceFile),true);await content.verify();
 await ws.catalogue(async store=>{assert.ok(await store.db.get('SELECT 1 FROM state WHERE slot=$1',child.key));assert.ok(await store.db.get('SELECT 1 FROM state WHERE slot=$1',parent.key));assert.equal(!!await store.db.get('SELECT 1 FROM state WHERE slot=$1',orphan.key),false);assert.equal(!!await store.db.get("SELECT 1 FROM state WHERE slot='record-owner-resources:active'"),false);await verifyRecordOwnerResources(store);});
 active.progress.reclamation.state='complete';await write(active)(store=>writeRecordOwnerTransfer(store,active));
 // Two selected transfers may share an immutable allocation. Cancelling
 // either claimant cannot remove bytes still owned by the other checkpoint.
 const left=receipt(),right=receipt();right.command.recordId=f.book.entries[1].id;right.fingerprint=recordOwnerTransferFingerprint(right.command,right.sourceOwner,right.targetOwner);await install(left);await install(right);
 const sharedValue={data:'shared between two unfinished transfers'},shared=state(sharedValue);
 await write(left)(async store=>{await retainRecordOwnerResource(store,shared,{present:false});await store.db.run('INSERT INTO state VALUES ($1,$2)',shared.key,store.encode('state',shared.key,sharedValue));});
 await write(right)(store=>retainRecordOwnerResource(store,shared,{present:true}));
 for(const [index,value] of [left,right].entries()){value.phase='cancelled';value.progress.reclamation={version:1,state:'pending'};await write(value)(store=>writeRecordOwnerTransfer(store,value));await reclaimRecordOwnerResources(ws,value,{write:write(value)});value.progress.reclamation.state='complete';await write(value)(store=>writeRecordOwnerTransfer(store,value));await ws.catalogue(async store=>{assert.equal(!!await store.db.get('SELECT 1 FROM state WHERE slot=$1',shared.key),index===0);await verifyRecordOwnerResources(store);});}
 const held=receipt();held.command.recordId=f.book.entries[1].id;held.fingerprint=recordOwnerTransferFingerprint(held.command,held.sourceOwner,held.targetOwner);await install(held);
 const children=Array.from({length:384},(_,i)=>{const value={data:'dependency '+i};return {resource:state(value),value};});
 await write(held)(async store=>{for(const {resource,value} of children){await retainRecordOwnerResource(store,resource,{present:false});await store.db.run('INSERT INTO state VALUES ($1,$2)',resource.key,store.encode('state',resource.key,value));}});
 const published=receipt();await install(published);const branches=Array.from({length:3},(_,i)=>{const dependencies=children.slice(i*128,(i+1)*128).map(item=>item.resource),value={data:'dependency branch '+i,children:dependencies.map(item=>item.revision)};return {resource:state(value),value,dependencies};});
 const keptValue={data:'completed allocation',children:branches.map(item=>item.resource.revision)},kept=state(keptValue);
 await write(published)(async store=>{for(const {resource,value,dependencies} of branches){await retainRecordOwnerResource(store,resource,{present:false,dependencies});await store.db.run('INSERT INTO state VALUES ($1,$2)',resource.key,store.encode('state',resource.key,value));}await retainRecordOwnerResource(store,kept,{present:false,dependencies:branches.map(item=>item.resource)});await store.db.run('INSERT INTO state VALUES ($1,$2)',kept.key,store.encode('state',kept.key,keptValue));});
 held.phase='cancelled';held.progress.reclamation={version:1,state:'pending'};await write(held)(store=>writeRecordOwnerTransfer(store,held));await reclaimRecordOwnerResources(ws,held,{write:write(held)});held.progress.reclamation.state='complete';await write(held)(store=>writeRecordOwnerTransfer(store,held));
 await write(published)(async store=>{published.phase='complete';await writeRecordOwnerTransfer(store,published);await commitRecordOwnerResources(store,published);});
 let checkpoints=0;
 await assert.rejects(compactRecordOwnerResources(ws,published,{write:write(published),checkpoint:()=>{if(++checkpoints===2)throw Error('Interrupted dependency compaction');}}),/Interrupted dependency compaction/);
 await ws.catalogue(store=>verifyRecordOwnerResources(store));
 assert.equal((await compactRecordOwnerResources(ws,published,{write:write(published),checkpoint:()=>{checkpoints++;}})).state,'retained');
 assert.ok(checkpoints<16,'Dependency compaction must use bounded batches instead of one commit per child');
 await ws.catalogue(async store=>{for(const {resource} of [...children,...branches])assert.ok(await store.db.get('SELECT 1 FROM state WHERE slot=$1',resource.key));assert.ok(await store.db.get('SELECT 1 FROM state WHERE slot=$1',kept.key));assert.equal((await store.db.get("SELECT COUNT(*)::text AS count FROM state WHERE starts_with(slot,'record-owner-resource:') OR starts_with(slot,'record-owner-resource-claim:') OR starts_with(slot,'record-owner-resource-chain:') OR starts_with(slot,'record-owner-resource-address:')")).count,'0');await verifyRecordOwnerResources(store);});
});


test('resource adoption follows transactions on reused connections and explicit commit boundaries',{timeout:90000},async t=>{
 const f=await intakeFixture(t),ws=f.ws,other=new Workspace(ws.root,ws.vault),sourceOwner={projectId:null,labBookId:null,workspaceId:randomUUID()},targetOwner={projectId:null,labBookId:null,workspaceId:f.book.id},sourceSnapshotId=await ws.catalogue(store=>store.head()),createdAt='2026-01-01T00:00:00.000Z';
 const receipt=()=>{const id=randomUUID(),command={id,workspaceId:sourceOwner.workspaceId,recordId:f.record.id,sourceNotebookId:randomUUID(),expectedStorageRevision:digest('synthetic retained source'),targetWorkspaceId:f.book.id,targetNotebookId:f.record.notebookId};return {version:1,id,command,sourceOwner,targetOwner,fingerprint:recordOwnerTransferFingerprint(command,sourceOwner,targetOwner),phase:'copying',sourceSnapshotId,createdAt,updatedAt:createdAt,progress:{},result:null};};
 const write=value=>operation=>other.withLock(()=>other.catalogue(store=>withRecordOwnerTransferWrite(store,value,()=>operation(store))));
 const install=(active,value)=>write(active)(async store=>{
  await writeRecordOwnerTransfer(store,active);await setRecordOwnerFence(store,active,'incoming');await initializeRecordOwnerReclamation(store,active);
  const resource=state(value);await retainRecordOwnerResource(store,resource,{present:false});await store.db.run('INSERT INTO state VALUES ($1,$2)',resource.key,store.encode('state',resource.key,value));
 });
 const cancel=async active=>{
  active.phase='cancelled';active.progress.reclamation={version:1,state:'pending'};await write(active)(store=>writeRecordOwnerTransfer(store,active));
  assert.equal((await reclaimRecordOwnerResources(other,active,{write:write(active)})).state,'complete');
  active.progress.reclamation.state='complete';await write(active)(store=>writeRecordOwnerTransfer(store,active));
 };
 const assertRetained=value=>ws.catalogue(async store=>{
  const resource=state(value),row=await store.db.get('SELECT payload FROM state WHERE slot=$1',resource.key);
  assert.ok(row,'Cancellation removed an allocation adopted by an ordinary writer');assert.deepEqual(store.decode('state',resource.key,row.payload),value);
  assert.equal(await recordOwnerResourcesTracking(store),false);await verifyRecordOwnerResources(store);
 });
 await ws.withCatalogueConnections(async()=>{
  let readDb,writeDb;
  await ws.withLock(()=>ws.catalogue(async store=>{writeDb=store.db;assert.equal(await recordOwnerResourcesTracking(store),false);}));
  const active=receipt(),value={data:'adopted after another connection commits'},pinned=Promise.withResolvers(),changed=Promise.withResolvers();
  const reading=ws.catalogue(async store=>{
   readDb=store.db;assert.equal(await recordOwnerResourcesTracking(store),false);pinned.resolve();await changed.promise;
   assert.equal(await recordOwnerResourcesTracking(store),false,'A fixed reader must retain its original snapshot');
  });
  await pinned.promise;
  try{await install(active,value);}finally{changed.resolve();}
  await reading;
  await ws.catalogue(async store=>{assert.equal(store.db,readDb);assert.equal(await recordOwnerResourcesTracking(store),true,'The next read transaction must see committed allocations');});
  await ws.withLock(()=>ws.catalogue(async store=>{assert.equal(store.db,writeDb);assert.equal(await adoptRecordOwnerResource(store,state(value)),true,'The next writer must protect adopted allocations');}));
  await cancel(active);await assertRetained(value);
  await ws.withLock(()=>ws.catalogue(async store=>{assert.equal(store.db,writeDb);assert.equal(await recordOwnerResourcesTracking(store),false);}));

  // Durable batch owners may explicitly commit inside the same writer context.
  // A failed boundary callback must invalidate both its former and inner proofs,
  // including the path with no metadata buffer to flush.
  for(const buffered of [false,true]){
   const next=receipt(),kept={data:'adopted after explicit commit '+buffered},requested=Promise.withResolvers(),installed=Promise.withResolvers();
   // Schedule the independent writer outside the held writer's async context.
   const staging=requested.promise.then(()=>install(next,kept));staging.then(installed.resolve,installed.reject);
   try{
    await ws.withLock(()=>ws.catalogue(async store=>{
     assert.equal(await recordOwnerResourcesTracking(store),false);
     const operation=async()=>{
      await assert.rejects(withFlushedMetadataBatch(store,async()=>{
       await store.db.run('COMMIT');requested.resolve();await installed.promise;
       await store.db.run('BEGIN');await store.db.lock();
       assert.equal(await recordOwnerResourcesTracking(store),true,'A committed boundary must not reuse its prior inactive proof');
       throw Error('Injected boundary callback failure');
      }),/Injected boundary callback failure/);
      assert.equal(await recordOwnerResourcesTracking(store),true,'A failed callback must not restore the former proof');
      assert.equal(await adoptRecordOwnerResource(store,state(kept)),true);
     };
     if(buffered)await withMetadataBatch(store,operation);else await operation();
    }));
   }catch(error){requested.reject(error);throw error;}
   finally{await staging;}
   await cancel(next);await assertRetained(kept);
  }
 });
});
