// A selected record crosses authenticated owners through durable checkpoints.
// Destination verification precedes publication and source retirement. Immutable
// staging survives interruption; a command ID never changes its destination.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {privateDirectory} from './storage.js';
import {withWriterLease,writerLeaseHeld} from './writer-lease.js';
import {digest,serialize} from './storage-format.js';
import {requireRecordOwnerTransfers} from './catalogue-format.js';
import {researchId} from './web/research-reference.js';
import {readRecordOwnerTransfer,writeRecordOwnerTransfer,readRecordOwnerFence,setRecordOwnerFence,withRecordOwnerTransferWrite,recordOwnerTransferStatus,recordOwnerTransferFingerprint,validRecordOwner,validRecordOwnerTransferCommand} from './record-owner-transfer-state.js';
import {copyRecordOwnerDocument,withRecordOwnerDocument} from './record-owner-document.js';
import {withRecordDocument} from './record-document.js';
import {retainStoredDocument,verifyStoredRecord} from './record-storage.js';
import {copyRecordOwnerHistoryMetadata,retainRecordOwnerHistory} from './record-owner-history.js';
import {retainRecordOrigin,recordOrigins,recordOrigin,registerRecordOwnerReference} from './record-owner-provenance.js';
import {validateRecordDocument} from './record-document-validation.js';
import {RecordQueryDocuments} from './record-query-documents.js';
import {recordOwnerEvidenceAdmission,checkRecordOwnerEvidenceAdmission} from './record-owner-evidence.js';
import {RecordMemberCollections,memberCollectionFields} from './record-member-collections.js';
import {recordDocumentSummary} from './record-document-summary.js';
import {stageRecordOwnerRevision} from './record-owner-read-visibility.js';
import {withScratch} from './scratch-work.js';
import {ResearchMaterials} from './research-materials.js';
import {withMetadataBatch} from './metadata-batch.js';
import {reconcileWebsiteMembership} from './website-membership.js';
const same=(a,b)=>serialize(a)===serialize(b),now=()=>new Date().toISOString();
const terminal=value=>value.phase==='complete'||value.phase==='cancelled'&&value.progress.reclamation?.state!=='pending';
const historyMap=(id,snapshotId,revision)=>'record-owner-history-map:'+id+':'+snapshotId+':'+revision;
const emptyReferences=()=>({format:1,kind:'references',root:null,count:0,chunkSize:64});
export class RecordOwnerTransfer{
 constructor(source,target,{registry,sourceOwner,targetOwner}={}){
  if(!source||!target||!registry||!validRecordOwner(sourceOwner)||!validRecordOwner(targetOwner)||sourceOwner.workspaceId===targetOwner.workspaceId||source.root===target.root)throw new AppError('INVALID');
  this.source=source;this.target=target;this.registry=registry;this.sourceOwner=structuredClone(sourceOwner);this.targetOwner=structuredClone(targetOwner);
 }
 static async pending(source,{workspaceId,recordId,id}={}){
  if(!researchId(workspaceId)||!researchId(recordId)||id!==undefined&&!researchId(id))throw new AppError('INVALID');
  return source.catalogue(async store=>{
   if((await store.snapshot()).metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const fence=id?null:await readRecordOwnerFence(store,recordId);if(fence?.direction==='incoming')return null;
   const value=id?await readRecordOwnerTransfer(store,id):fence?.transfer;
   if(value&&(value.command.recordId!==recordId||value.command.workspaceId!==workspaceId))throw new AppError('CONFLICT');return recordOwnerTransferStatus(value??null);
  });
 }
 status(command){return RecordOwnerTransfer.pending(this.source,command);}
 async read(id){const value=await this.source.catalogue(store=>readRecordOwnerTransfer(store,id));if(!value)throw new AppError('NOT_FOUND');if(!same(value.sourceOwner,this.sourceOwner)||!same(value.targetOwner,this.targetOwner))throw new AppError('CONFLICT');return value;}
 async start(command,options={}){
  if(!validRecordOwnerTransferCommand(command)||command.workspaceId!==this.sourceOwner.workspaceId||command.targetWorkspaceId!==this.targetOwner.workspaceId||this.targetOwner.labBookId&&command.targetNotebookId!==this.targetOwner.labBookId)throw new AppError('INVALID');
  await options.check?.();options.signal?.throwIfAborted();
  if(await this.source.storageKind()!=='catalogue'||await this.target.storageKind()!=='catalogue')throw new AppError('FORMAT');
  await this.target.catalogue(async store=>{const snapshot=await store.snapshot();if(snapshot.metadata.id!==command.targetWorkspaceId||!snapshot.metadata.notebooks.some(value=>value.id===command.targetNotebookId))throw new AppError('WORKSPACE_CHANGED');});
  const fingerprint=recordOwnerTransferFingerprint(command,this.sourceOwner,this.targetOwner);
  const existing=await this.source.catalogue(store=>readRecordOwnerTransfer(store,command.id));
  if(existing){if(existing.fingerprint!==fingerprint)throw new AppError('CONFLICT');return this.resume({workspaceId:command.workspaceId,recordId:command.recordId,id:command.id},options);}
  const evidenceProof=await recordOwnerEvidenceAdmission(this.source,command.recordId,{signal:options.signal});
  await this.source.withLock(()=>this.source.catalogue(async store=>{
   const prior=await readRecordOwnerTransfer(store,command.id);if(prior){if(prior.fingerprint!==fingerprint)throw new AppError('CONFLICT');return;}
   const snapshotId=await store.head(),snapshot=await store.snapshot(snapshotId),row=await store.member(snapshot,command.recordId);
   if(snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(!row||row.revision!==command.expectedStorageRevision||row.notebookId!==command.sourceNotebookId)throw new AppError('RECORD_CHANGED');
   const fence=await readRecordOwnerFence(store,command.recordId);if(fence&&!terminal(fence.transfer))throw new AppError('RECORD_TRANSFER_BUSY');
   await checkRecordOwnerEvidenceAdmission(store,evidenceProof);await requireRecordOwnerTransfers(store.db);const time=now(),value={version:1,id:command.id,fingerprint,command:structuredClone(command),sourceOwner:this.sourceOwner,targetOwner:this.targetOwner,phase:'copying',sourceSnapshotId:snapshotId,createdAt:time,updatedAt:time,progress:{history:0,historyAfter:null,segmentId:randomUUID(),sequences:Object.fromEntries(['all','artifact','dataset','analysis','collection'].map(kind=>[kind,emptyReferences()]))},result:null};
   await writeRecordOwnerTransfer(store,value);await setRecordOwnerFence(store,value,'outgoing');
  }));
  return this.resume({workspaceId:command.workspaceId,recordId:command.recordId,id:command.id},options);
 }
 async resume(command,options={}){
  const status=await this.status(command);if(!status)throw new AppError('NOT_FOUND');if(status.phase==='complete')return status;if(status.phase==='cancelled')return this.finishCancellation(await this.read(command.id),options);
  const directory=await privateDirectory(this.source.root,'.observanda/record-owner-transfers');
  try{return await withWriterLease(path.join(directory,command.recordId+'.lock'),()=>this.perform(command.id,options));}catch(error){const latest=await this.read(command.id);if(latest.phase==='cancelled')return this.finishCancellation(latest,options);throw error;}
 }
 async cancel(command,{signal,check,checkpoint}={}){
  await check?.();signal?.throwIfAborted();const pending=await this.status(command);if(!pending)throw new AppError('NOT_FOUND');if(pending.phase==='complete')return pending;if(pending.phase==='cancelled')return this.finishCancellation(await this.read(command.id),{signal,check,checkpoint});
  const value=await this.source.withLock(()=>this.source.catalogue(async store=>{
   const current=await readRecordOwnerTransfer(store,command.id);if(!current||current.command.recordId!==command.recordId)throw new AppError('CONFLICT');
   if(!['copying','verified','cancelled'].includes(current.phase))throw new AppError('RECORD_TRANSFER_ACTIVATING');
   current.phase='cancelled';current.progress={...current.progress,reclamation:{version:1,state:'pending'}};current.updatedAt=now();await writeRecordOwnerTransfer(store,current);return current;
  }));
  return this.finishCancellation(value,{signal,check,checkpoint});
 }
 async finishCancellation(value,{signal,check,checkpoint=async()=>{}}={}){
  // Stop target writes before waiting for the copier. The source intent stays
  // durable independently of destination access and reclamation acknowledgement.
  await check?.();signal?.throwIfAborted();
  if(value.phase!=='cancelled'||!same(value.sourceOwner,this.sourceOwner)||!same(value.targetOwner,this.targetOwner))throw new AppError('CONFLICT');
  await this.target.withLock(()=>this.target.catalogue(async store=>{
   if((await store.snapshot()).metadata.id!==value.targetOwner.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const target=await readRecordOwnerTransfer(store,value.id);if(!target)return;
   if(target.fingerprint!==value.fingerprint||!['copying','verified','cancelled'].includes(target.phase))throw new AppError('CONFLICT');
   if(target.phase!=='cancelled'||target.progress.reclamation?.state!=='complete')await writeRecordOwnerTransfer(store,{...target,phase:'cancelled',progress:{...target.progress,reclamation:{version:1,state:'pending'}},updatedAt:now()});
  }));
  const directory=await privateDirectory(this.source.root,'.observanda/record-owner-transfers'),lease=path.join(directory,value.command.recordId+'.lock');
  const finish=async()=>{
   const write=async operation=>{await check?.();signal?.throwIfAborted();return this.target.withLock(()=>this.target.catalogue(async store=>{
    const saved=await readRecordOwnerTransfer(store,value.id);if(!saved||saved.fingerprint!==value.fingerprint||saved.phase!=='cancelled')throw new AppError('CONFLICT');
    return withRecordOwnerTransferWrite(store,saved,()=>operation(store));
   }));};
   const target=await this.target.catalogue(store=>readRecordOwnerTransfer(store,value.id));
   if(target){
    const {reclaimRecordOwnerResources}=await import('./record-owner-resources.js');
    const result=await reclaimRecordOwnerResources(this.target,target,{signal,write,checkpoint});
    if(result.version!==1||result.id!==value.id||result.recordId!==value.command.recordId||result.namespaceId!==value.targetOwner.workspaceId||result.state!=='complete')throw new AppError('CATALOGUE_DAMAGED');
    await write(async store=>{const saved=await readRecordOwnerTransfer(store,value.id);await writeRecordOwnerTransfer(store,{...saved,progress:{...saved.progress,reclamation:{version:1,state:'complete'}},updatedAt:now()});});
   }
   await check?.();signal?.throwIfAborted();
   value=await this.source.withLock(()=>this.source.catalogue(async store=>{
    const saved=await readRecordOwnerTransfer(store,value.id);if(!saved||saved.fingerprint!==value.fingerprint||saved.phase!=='cancelled')throw new AppError('CONFLICT');
    const completed={...saved,progress:{...saved.progress,reclamation:{version:1,state:'complete'}},updatedAt:now()};await writeRecordOwnerTransfer(store,completed);return completed;
   }));
   return recordOwnerTransferStatus(value);
  };
  return writerLeaseHeld(lease)?finish():withWriterLease(lease,finish);
 }
 async perform(id,options={}){
  await options.check?.();options.signal?.throwIfAborted();
  // Initialize the evidence index before pinning the source snapshot.
  await new ResearchMaterials(this.source).index.ensure();
  // Selected originals are fenced against edits. Read their immutable content
  // through one consistent snapshot, while cancellation and checkpoints use a
  // separate live connection so a long copy never hides a stop request.
  const db=await this.source.openCatalogue();
  try{const control=this.source.catalogueStore(db);return await this.target.withCatalogueConnections(()=>this.source.catalogue(()=>this.performWithSourceReader(id,options,()=>readRecordOwnerTransfer(control,id))));}
  finally{await db.close();}
 }
 async performWithSourceReader(id,{signal,check=async()=>{},progress=async()=>{},checkpoint=async()=>{}}={},read){
  let value=await read();if(value.phase==='complete')return recordOwnerTransferStatus(value);if(value.phase==='cancelled')return this.finishCancellation(value,{signal,check,checkpoint});
  const checked=async()=>{signal?.throwIfAborted();await check();const live=await read();if(live.phase==='cancelled')throw new AppError('RECORD_TRANSFER_CANCELLED');return live;};
  const save=async patch=>{
   value=await this.source.withLock(()=>this.source.catalogue(async store=>{const current=await readRecordOwnerTransfer(store,id);if(!current||current.fingerprint!==value.fingerprint||current.phase==='cancelled')throw new AppError('CONFLICT');const next={...current,...patch,updatedAt:now()};await writeRecordOwnerTransfer(store,next);return next;}));
   await progress({stage:'record-transfer-'+value.phase,completed:value.progress.history,done:value.progress.history,unit:'revisions'});return value;
  };
  const write=async operation=>{
   await checked();return this.target.withLock(()=>this.target.catalogue(async store=>{
    const saved=await readRecordOwnerTransfer(store,id);if(!saved||saved.fingerprint!==value.fingerprint||saved.phase==='cancelled')throw new AppError('CONFLICT');
    return withRecordOwnerTransferWrite(store,saved,()=>withMetadataBatch(store,()=>operation(store)));
   }));
  };
  await checked();
  if(!await this.target.catalogue(store=>readRecordOwnerTransfer(store,id))){
   const pending=await this.target.catalogue(store=>readRecordOwnerFence(store,value.command.recordId));
   if(pending?.direction==='incoming'&&pending.id!==id&&!terminal(pending.transfer)&&same(pending.transfer.sourceOwner,this.sourceOwner)&&same(pending.transfer.targetOwner,this.targetOwner)){
    const cancelled=await this.source.catalogue(store=>readRecordOwnerTransfer(store,pending.id));
    if(cancelled?.phase==='cancelled'&&cancelled.fingerprint===pending.transfer.fingerprint)await this.finishCancellation(cancelled,{signal,check,checkpoint});
   }
   const former=await this.target.catalogue(async store=>{
    const fence=await readRecordOwnerFence(store,value.command.recordId);if(!fence)return null;
    if(fence.direction==='outgoing'&&fence.transfer.phase==='complete')return fence.transfer;
    if(fence.transfer.phase==='cancelled'&&fence.transfer.progress.previousOwnerTransfer)return readRecordOwnerTransfer(store,fence.transfer.progress.previousOwnerTransfer);
    return null;
   });
   if(former){
    if(former.phase!=='complete'||!same(former.sourceOwner,value.targetOwner)||former.command.recordId!==value.command.recordId)throw new AppError('RECORD_TRANSFER_EXISTS');
    await this.source.catalogue(async store=>{if(!await recordOrigin(store,{kind:'record',id:value.command.recordId,workspaceId:value.targetOwner.workspaceId})||!await store.db.get('SELECT 1 FROM records WHERE id=$1 AND revision=$2',value.command.recordId,former.command.expectedStorageRevision))throw new AppError('RECORD_TRANSFER_EXISTS');await verifyStoredRecord(store,value.command.recordId,former.command.expectedStorageRevision,{signal});});
    await save({progress:{...value.progress,previousOwnerTransfer:former.id}});
   }
  }
  await this.target.withLock(()=>this.target.catalogue(async store=>{
   const snapshot=await store.snapshot();if(snapshot.metadata.id!==value.targetOwner.workspaceId||!snapshot.metadata.notebooks.some(book=>book.id===value.command.targetNotebookId))throw new AppError('WORKSPACE_CHANGED');
   const previous=await readRecordOwnerTransfer(store,id);if(previous){if(previous.fingerprint!==value.fingerprint)throw new AppError('CONFLICT');return;}
   if(await store.member(snapshot,value.command.recordId))throw new AppError('RECORD_TRANSFER_EXISTS');
   await requireRecordOwnerTransfers(store.db);await writeRecordOwnerTransfer(store,value);await setRecordOwnerFence(store,value,'incoming');
   const {initializeRecordOwnerReclamation}=await import('./record-owner-resources.js');await withRecordOwnerTransferWrite(store,value,()=>initializeRecordOwnerReclamation(store,value));
  }));
  if(value.phase==='copying'){
   await this.copyHistory(value,{write,signal,checkpoint,save});value=await read();
   const {prepareRecordOwnerEvidence}=await import('./record-owner-evidence.js');
   const evidence=await prepareRecordOwnerEvidence(this.source,this.target,value,{write,signal,check:checked,checkpoint,saveProgress:async evidence=>{await save({progress:{...value.progress,evidence}});value=await read();}});
   await save({progress:{...value.progress,evidence}});
   const {prepareRecordOwnerDrafts}=await import('./record-owner-drafts.js');
   const drafts=await prepareRecordOwnerDrafts(this.source,this.target,value,{write,signal,checkpoint});await save({progress:{...value.progress,drafts}});
   const prepared=await this.prepareCurrent(value,{write,signal});await save({progress:{...value.progress,prepared}});
   await this.target.catalogue(store=>store.verifyRecordHistory(value.command.recordId));
   const {verifyRecordOwnerEvidence}=await import('./record-owner-evidence.js');await verifyRecordOwnerEvidence(this.target,value,evidence,{signal,check:checked});
   await checked();await save({phase:'verified'});await checkpoint('verified',recordOwnerTransferStatus(value));
  }
  if(value.phase==='verified'){await checked();await save({phase:'activating'});await checkpoint('activating',recordOwnerTransferStatus(value));}
  if(value.phase==='activating'){
   const {retainRecordOwnerSourceDrafts}=await import('./record-owner-drafts.js');await retainRecordOwnerSourceDrafts(this.source,this.target,value,{signal,check:checked});
   const targetReceipt=await this.target.catalogue(store=>readRecordOwnerTransfer(store,id));
   if(targetReceipt.phase!=='complete')await write(store=>this.activate(store,value,{signal}));
   const published=await this.target.catalogue(store=>readRecordOwnerTransfer(store,id));if(published.phase!=='complete'||!published.result)throw new AppError('CATALOGUE_DAMAGED');
   await save({phase:'retiring',result:published.result,progress:{...value.progress,activatedSnapshotId:published.progress.activatedSnapshotId}});await checkpoint('destination-published',recordOwnerTransferStatus(value));
  }
  if(value.phase==='retiring'){
   await checked();await this.registerReferences(value,{signal});
   const {compactRecordOwnerResources}=await import('./record-owner-resources.js'),published=await this.target.catalogue(store=>readRecordOwnerTransfer(store,id));
   if(published?.phase!=='complete'||published.fingerprint!==value.fingerprint)throw new AppError('CATALOGUE_DAMAGED');
   await compactRecordOwnerResources(this.target,published,{signal,write,checkpoint});
   await this.retire(value);await save({phase:'complete'});await checkpoint('complete',recordOwnerTransferStatus(value));
  }
  return recordOwnerTransferStatus(value);
 }
 async copyHistory(value,{write,signal,checkpoint,save}){
  const recordId=value.command.recordId;
  const head=await this.source.catalogue(async from=>{const history=from.historyIndex(recordId),head=await history.head();await history.check(head);return head;});
  const copy=async(item,revision=item.revision)=>{
   signal?.throwIfAborted();if(await this.target.catalogue(store=>store.object(historyMap(value.id,item.snapshotId,revision))))return;
   await this.source.catalogue(async from=>{
    const source=await from.recordSnapshot(item.snapshotId,recordId),row=await from.member(source,recordId);if(!row||row.revision!==item.revision)throw new AppError('CATALOGUE_DAMAGED');
    const view=await from.historyIndex(recordId).display(item);
    await withRecordDocument(from,recordId,revision,async document=>{
     const descriptor=await copyRecordOwnerDocument(document,this.target,{write,signal});if(descriptor.encoding.revision!==revision)throw new AppError('CATALOGUE_DAMAGED');
     const metadata=await copyRecordOwnerHistoryMetadata(from,this.target,source.metadata,descriptor.notebookId,value.targetOwner.workspaceId,{write,signal});
     await write(async store=>withRecordOwnerDocument(store,descriptor,async copied=>{
      const {collections:sourceCollections,queryRevision,summaryRevision,...sourceMember}=row;void sourceCollections;void queryRevision;void summaryRevision;
      let member={...sourceMember,revision,notebookId:descriptor.notebookId,sections:[],cardItems:{contributors:[],relations:[],figures:[],attachments:[]},bytes:descriptor.encoding.memberBytes};
      const collections=new RecordMemberCollections(store);for(const field of memberCollectionFields)if(await copied.tree.select(copied.root,[field]))member=await collections.changed(member,field,copied);
      await stageRecordOwnerRevision(store,value,view.revision);await retainStoredDocument(store,copied,descriptor.encoding);
      const snapshotId=await retainRecordOwnerHistory(store,{recordId,sourceOwner:value.sourceOwner,sourceSnapshotId:item.snapshotId,metadata,member});
      await store.historyIndex(recordId).append({revision,snapshotId,view},{initialize:true,fresh:true});
      await retainRecordOrigin(store,{kind:'record',id:recordId,sourceOwner:value.sourceOwner,transferId:value.id});
      for await(const origin of recordOrigins(from,'record',recordId))await retainRecordOrigin(store,{kind:'record',id:recordId,sourceOwner:origin.sourceOwner,transferId:value.id});
      await store.putObject(historyMap(value.id,item.snapshotId,revision),{snapshotId,revision});
     }));
    });
   });
  };
  for(let ordinal=value.progress.history;ordinal<head.count;){
   const rows=await this.source.catalogue(from=>from.historyIndex(recordId).rows(head,Array.from({length:Math.min(32,head.count-ordinal)},(_,i)=>ordinal+i)));
   for(const item of rows){await copy(item);value=await save({progress:{...value.progress,history:++ordinal}});await checkpoint('history',recordOwnerTransferStatus(value));}
  }
  for(;;){
   const rows=await this.source.catalogue(from=>from.db.all('SELECT revision FROM records WHERE id=$1 AND revision COLLATE "C">$2 ORDER BY revision COLLATE "C" LIMIT 32',recordId,value.progress.historyAfter??''));if(!rows.length)break;
   for(const raw of rows){signal?.throwIfAborted();const found=await this.source.catalogue(from=>from.historyIndex(recordId).lookup(head,'version',raw.revision));await copy(found.item,raw.revision);value=await save({progress:{...value.progress,historyAfter:raw.revision}});}
  }
 } async prepareCurrent(value,{write,signal}){
  if(value.progress.prepared)return value.progress.prepared;
  const descriptor=await this.source.catalogue(from=>withRecordDocument(from,value.command.recordId,value.command.expectedStorageRevision,document=>copyRecordOwnerDocument(document,this.target,{write,signal,notebookId:value.command.targetNotebookId,transform:async copied=>{copied=await copied.replace(['notebookId'],value.command.targetNotebookId,{signal});copied=await copied.replace(['share'],false,{signal});return copied.replace(['updatedAt'],value.createdAt,{signal});}})));
  // Build selected derivations using encrypted temporary scratch. Durable nodes
  // use the same short writer batches as copying; this reader holds no shared
  // resource locks while traversing a large record.
  const db=await this.target.openCatalogue();
  try{
   await db.run('BEGIN ISOLATION LEVEL READ COMMITTED');const store=this.target.catalogueStore(db);
   const result=await db.scope(()=>this.target.inspectCatalogue(store,()=>withRecordOwnerDocument(store,descriptor,async document=>{
    const metadata=(await store.snapshot()).metadata,header=await validateRecordDocument(document,metadata,{signal});
    let membership={sections:[],cardItems:{contributors:[],relations:[],figures:[],attachments:[]}};
    const collections=new RecordMemberCollections(store,{write});for(const field of memberCollectionFields)membership=await collections.changed(membership,field,document);
    // Preserve the established summary serialization for compact members, and
    // its counted collection representation for larger selected originals.
    const summary=await recordDocumentSummary(document,header,descriptor.encoding,{signal,collections:membership.collections});
    const member={...summary,...await new RecordQueryDocuments(store,{write}).retainDocument(document,descriptor.encoding.contentRevision,{signal})};await document.blocks.flush();return {descriptor,member,view:{revision:descriptor.encoding.contentRevision,title:header.title,status:header.status,updatedAt:header.updatedAt}};
   },{write,signal})));
   await db.run('COMMIT');return result;
  }finally{await db.close();}
 }
 async activate(store,value,{signal}){
  signal?.throwIfAborted();const currentId=await store.head(),current=await store.indexed(await store.snapshot(currentId)),prepared=value.progress.prepared;
  if(current.metadata.id!==value.targetOwner.workspaceId||await store.member(current,value.command.recordId)||!prepared)throw new AppError('CONFLICT');
  await withRecordOwnerDocument(store,prepared.descriptor,document=>retainStoredDocument(store,document,prepared.descriptor.encoding));
  const etag=digest('Observanda/catalogue-snapshot/'+randomUUID()),ordinal=(await store.db.get('SELECT MAX(ordinal)+1 AS n FROM snapshots')).n,metadata={...current.metadata,revision:current.metadata.revision+1,updatedAt:now()},member={...prepared.member,position:current.nextPosition};
  await store.historyIndex(member.id).append({revision:member.revision,snapshotId:etag,view:prepared.view},{fresh:true});
  await writeRecordOwnerTransfer(store,{...value,phase:'activating'});
  const {activateRecordOwnerEvidence}=await import('./record-owner-evidence.js');await activateRecordOwnerEvidence(this.target,value,value.progress.evidence,{store,signal});
  const {activateRecordOwnerDrafts}=await import('./record-owner-drafts.js');await activateRecordOwnerDrafts(this.target,value,value.progress.drafts,{store});
  await store.finishRecordChanges(currentId,current,metadata,[],[member],{etag,ordinal,nextPosition:current.nextPosition+1});
  const result={recordId:member.id,notebookId:member.notebookId,workspaceId:value.targetOwner.workspaceId,projectId:value.targetOwner.projectId,labBookId:value.targetOwner.labBookId,storageRevision:member.revision};
  await writeRecordOwnerTransfer(store,{...value,phase:'complete',progress:{...value.progress,activatedSnapshotId:etag},result,updatedAt:now()});
  const {commitRecordOwnerResources}=await import('./record-owner-resources.js');await commitRecordOwnerResources(store,value);
 }
 async registerReferences(value,{signal}){
  await withScratch(async seen=>{
   const register=async ref=>{
    if(!await seen.add(ref.kind+':'+ref.id))return;signal?.throwIfAborted();
    await registerRecordOwnerReference(this.registry,value,ref,value.sourceOwner);
    for(const workspace of [this.source,this.target]){let after=null;do{const page=await workspace.catalogue(store=>store.objectIdPage('record:reference-origin:'+ref.kind+':'+ref.id+':',{after,signal}));for(const key of page.items){const origin=await workspace.catalogue(store=>store.object(key));await registerRecordOwnerReference(this.registry,value,ref,origin.sourceOwner);}after=page.next;}while(after);}
   };
   await register({kind:'record',id:value.command.recordId});
   for await(const ref of new ResearchMaterials(this.target).sequences.items(value.progress.evidence.revisions))await register(ref);
  },{signal});
 } async retire(value){
  await this.source.withLock(()=>this.source.catalogue(async store=>withRecordOwnerTransferWrite(store,value,async()=>{
   const currentId=await store.head(),current=await store.indexed(await store.snapshot(currentId)),row=await store.member(current,value.command.recordId);
   if(row){
    if(row.revision!==value.command.expectedStorageRevision||row.notebookId!==value.command.sourceNotebookId)throw new AppError('RECORD_CHANGED');
    const target='entry:'+row.id,metadata={...current.metadata,branding:current.metadata.branding.filter(item=>item.target!==target),website:{...current.metadata.website,layouts:current.metadata.website.layouts.filter(item=>item.target!==target)}};
    await reconcileWebsiteMembership(metadata,id=>id===row.id?null:store.member(current,id));await store.validateMetadata(current,metadata,{removed:[row.id]});await store.commitChanges(currentId,current,metadata,[],{removed:[row.id]});
   }
   await writeRecordOwnerTransfer(store,{...value,phase:'complete',updatedAt:now()});
  })));
 }
}
