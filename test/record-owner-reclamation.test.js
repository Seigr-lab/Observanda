import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {RecordOwnerTransfer} from '../src/record-owner-transfer.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {RecordWriting} from '../src/record-writing.js';
import {RecordWritingDrafts} from '../src/record-writing-drafts.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {recordEncoding} from '../src/record-encoding.js';
import {withRecordDocument} from '../src/record-document.js';
import {digest} from '../src/storage-format.js';
import {copyWorkspaceTo} from '../src/locations.js';
import {retainedHistoryGeneration} from '../src/retained-record-history.js';
import {verifyRecordOwnerResources} from '../src/record-owner-resources.js';
const media={get:async()=>{throw Error('Unexpected synthetic media');}};
const missing=file=>stat(file).then(()=>false,error=>{if(error.code==='ENOENT')return true;throw error;});

// Two native owners exercise the real allocation hooks; no project tree,
// release workflow, or unrelated owner transport is needed for reclamation.
test('cancelled record allocations restore native and legacy history, drafts and shared children',{timeout:240000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-reclaim-')),book=sampleNotebook();
 for(const record of book.entries){record.attachments=[];record.figures=[];record.share=false;}
 const sourceFixture=await encryptedFixture(path.join(directory,'source'),book),targetBook={...structuredClone(book),id:randomUUID()},targetFixture=await encryptedFixture(path.join(directory,'target'),targetBook);
 const source=sourceFixture.workspace,target=targetFixture.workspace;
 t.after(async()=>{clearVault(sourceFixture.vault);clearVault(targetFixture.vault);assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-record-reclaim-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const initial=(await source.read()).book.entries[0],sibling=(await target.read()).book.entries[1],records=new ResearchRecords(source,media),targetRecords=new ResearchRecords(target,media);
 await targetRecords.remove({workspaceId:targetBook.id,recordId:initial.id,expectedRevision:recordRevision(initial)});
 const originalState=await target.catalogue(async store=>{const history=store.historyIndex(initial.id),head=await history.head();return {head,raw:await history.get(history.root),rows:await Array.fromAsync(history.items(head)),revision:recordEncoding(initial).revision,generation:await retainedHistoryGeneration(store,initial.id)};});
 const body=('Selected transferred observation '+randomUUID()+' ').repeat(700),companion='Companion selected observation. '.repeat(900),section={id:randomUUID(),title:'Selected companion',body:companion};
 await records.save({workspaceId:book.id,changes:[{id:initial.id,expectedRevision:recordRevision(initial),record:{...initial,title:'New selected transfer original',body,sections:[...initial.sections,section,...Array.from({length:64},(_,i)=>({id:randomUUID(),title:'Selected detail '+i,body:'Recorded detail '+i}))]}}]});
 const current=(await source.read()).book.entries.find(value=>value.id===initial.id),drafts=new ResearchDrafts(source),draftId=randomUUID(),sourceSibling=(await source.read()).book.entries[1];
 await drafts.write({id:draftId,workspaceId:book.id,expectedRevision:null,changes:[{base:current,record:{...current,title:'Unfinished selected title'},expectedRevision:recordRevision(current)},{base:sourceSibling,record:{...sourceSibling,title:'Sibling checkpoint stays local'},expectedRevision:recordRevision(sourceSibling)}]});
 const originalDraft=await source.readMetadata('.observanda/drafts/'+draftId+'.json',16*1024*1024),writing=await new RecordWriting(source).read({workspaceId:book.id,recordId:current.id,sectionId:null}),writingId=randomUUID();
 await new RecordWritingDrafts(source).write({id:writingId,workspaceId:book.id,recordId:current.id,expectedRevision:null,writing:{sectionId:null,revision:writing.revision,storageRevision:writing.storageRevision},value:{body:'Unfinished native writing '+body}});
 const materials=new ResearchMaterials(source),standalone=await source.withLock(()=>materials.retainRecord({...current,title:'Exact standalone retained original'}));
 const sourceOwner={projectId:null,labBookId:null,workspaceId:book.id},targetOwner={projectId:null,labBookId:null,workspaceId:targetBook.id},engine=new RecordOwnerTransfer(source,target,{registry:{},sourceOwner,targetOwner}),command={id:randomUUID(),workspaceId:book.id,recordId:current.id,sourceNotebookId:current.notebookId,expectedStorageRevision:recordEncoding(current).revision,targetWorkspaceId:targetBook.id,targetNotebookId:current.notebookId},request=id=>({workspaceId:book.id,recordId:current.id,id});
 let interleaved=false,derivationFinished=false;const prepare=engine.prepareCurrent.bind(engine);
 engine.prepareCurrent=async(value,options)=>{
  const result=await prepare(value,{...options,write:async operation=>{
   let memberBatch=false;
   const result=await options.write(async store=>{
    const all=store.db.all;store.db.all=async function(sql,...args){if(sql==='SELECT slot,payload FROM state WHERE slot=ANY($1::text[])'&&args[0]?.some(value=>value.startsWith('record-member-item:')))memberBatch=true;return all.call(this,sql,...args);};
    try{return await operation(store);}finally{store.db.all=all;}
   });
   if(memberBatch&&!interleaved){
    assert.equal(derivationFinished,false);interleaved=true;
    // Reuse staged prose inside the same notebook while selected derivation is
    // paused between durable batches, not merely after transfer preparation.
    await targetRecords.save({workspaceId:targetBook.id,changes:[{id:sibling.id,expectedRevision:recordRevision(sibling),record:{...sibling,body,sections:[...sibling.sections,{...section,id:randomUUID()}],title:'Continued independent authoring'}}]});
   }
   return result;
  }});derivationFinished=true;return result;
 };
 await assert.rejects(engine.start(command,{checkpoint:async stage=>{if(stage==='verified')throw Error('Pause after verified staging');}}),/Pause after verified staging/);
 assert.equal(interleaved,true);assert.equal(derivationFinished,true);
 assert.equal(await source.catalogue(store=>store.object('record-owner-draft-original:'+digest(originalDraft))),null);
 const staged=await target.catalogue(async store=>({records:Number((await store.db.get('SELECT COUNT(*)::text AS n FROM records WHERE id=$1',current.id)).n),root:await withRecordDocument(store,current.id,command.expectedStorageRevision,document=>document.root),blocks:Number((await store.db.get("SELECT COUNT(*)::text AS n FROM state WHERE starts_with(slot,'record-block:')")).n)}));
 assert.ok(staged.records>1);assert.ok(staged.blocks>0);assert.notEqual(await target.readMetadata('.observanda/drafts/'+writingId+'.json',16*1024*1024),null);
 let interrupted=false;await assert.rejects(engine.cancel(request(command.id),{checkpoint:async stage=>{if(stage==='mutations'&&!interrupted){interrupted=true;throw Error('Pause reclamation checkpoint');}}}),/Pause reclamation checkpoint/);
 const pending=await engine.status(request(command.id));assert.equal(pending.phase,'cancelled');assert.equal(pending.progress.reclamation.state,'pending');assert.equal(pending.canResume,true);
 const copyParent=path.join(directory,'copy');await mkdir(copyParent);const destination=path.join(copyParent,path.basename(target.root));
 await assert.rejects(copyWorkspaceTo(target.root,destination,{vault:targetFixture.vault}),{code:'RECORD_TRANSFER_CLEANUP_PENDING'});assert.equal(await missing(destination),true);
 const siblingNow=(await target.read()).book.entries.find(value=>value.id===sibling.id);await targetRecords.save({workspaceId:targetBook.id,changes:[{id:sibling.id,expectedRevision:recordRevision(siblingNow),record:{...siblingNow,outcome:'Unrelated writing remains available during cleanup'}}]});
 const finished=await new RecordOwnerTransfer(source,target,{registry:{},sourceOwner,targetOwner}).resume(request(command.id));assert.equal(finished.progress.reclamation.state,'complete');assert.deepEqual(await engine.cancel(request(command.id)),finished);
 await target.catalogue(async store=>{
  const history=store.historyIndex(current.id);assert.deepEqual(await history.get(history.root),originalState.raw);await history.check(await history.head());
  assert.equal((await store.db.get('SELECT COUNT(*)::text AS n FROM records WHERE id=$1',current.id)).n,'1');assert.deepEqual(await store.record(current.id,originalState.revision),initial);
  assert.equal(await store.db.get('SELECT 1 FROM records WHERE id=$1 AND revision=$2',current.id,command.expectedStorageRevision),undefined);
  assert.equal(await store.db.get('SELECT 1 FROM state WHERE slot=$1','record-block:'+current.notebookId+':1:value:'+staged.root),undefined);
  assert.equal(await retainedHistoryGeneration(store,current.id),originalState.generation);await verifyRecordOwnerResources(store);
 });
 for(const id of [draftId,writingId])assert.equal(await target.readMetadata('.observanda/drafts/'+id+'.json',16*1024*1024),null);
 assert.equal(await target.readMetadata('.observanda/materials/records/'+current.id+'/'+standalone.revision+'.json',16*1024*1024),null);
 assert.equal((await new ResearchDrafts(target).list({workspaceId:targetBook.id})).drafts.length,0);
 assert.equal(await source.readMetadata('.observanda/drafts/'+draftId+'.json',16*1024*1024),originalDraft);
 assert.equal((await target.read()).book.entries.find(value=>value.id===sibling.id).body,body);
 assert.equal(await copyWorkspaceTo(target.root,destination,{vault:targetFixture.vault}),destination);
 // A real legacy head must be restored before its converted lookup slots are
 // pruned; the existing original remains readable after every cleanup group.
 const legacy={recordId:current.id,versions:originalState.rows};
 await target.withLock(()=>target.catalogue(async store=>{const history=store.historyIndex(current.id);await store.db.run('DELETE FROM state WHERE starts_with(slot,$1)',history.prefix);await history.saveHead(legacy);}));
 const next={...command,id:randomUUID()};await assert.rejects(engine.start(next,{checkpoint:async stage=>{if(stage==='history')throw Error('Pause legacy conversion');}}),/Pause legacy conversion/);
 assert.equal((await target.catalogue(store=>store.historyIndex(current.id).head())).formatVersion,2);
 let groups=0;await engine.cancel(request(next.id),{checkpoint:async stage=>{if(stage!=='mutations')return;groups++;await target.catalogue(async store=>{const history=store.historyIndex(current.id),head=await history.head();await history.check(head);assert.ok((await history.lookup(head,'version',originalState.revision)).item);});}});
 assert.ok(groups>0);await target.catalogue(async store=>{const history=store.historyIndex(current.id);assert.deepEqual(await history.get(history.root),legacy);assert.equal((await store.db.get('SELECT COUNT(*)::text AS n FROM state WHERE starts_with(slot,$1)',history.prefix)).n,'0');assert.deepEqual(await store.record(current.id,originalState.revision),initial);await verifyRecordOwnerResources(store);});
});
