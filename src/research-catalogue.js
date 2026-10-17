import {workspaceSettingsRegistry,verifyWorkspaceSettings} from './workspace-settings.js';
import {readProjectDomainRegistry} from './project-domain-registry.js';
import {retiredMetadataSourceLocation,resolveMetadataValue} from './project-retired-metadata.js';
import {withRetiredRecordCopy} from './project-retired-records.js';
import {assertProjectHierarchyChange} from './project-hierarchy-authority.js';
import {ProjectSourceAuthority} from './project-source-authority.js';
import {rekeyProjectDomains} from './project-domain-rekey.js';
// Transactional research storage. PostgreSQL sees encrypted payloads and opaque IDs,
// never titles, prose or file paths. Workspace owns locking and key custody.
import {AsyncLocalStorage} from 'node:async_hooks';
import {reconcileWebsiteMembership} from './website-membership.js';
import {withCatalogueVerification,verificationContext} from './catalogue-verification.js';
import {verifiedCatalogueObjects} from './catalogue-object-verification.js';
import {randomUUID,randomBytes} from 'node:crypto';
import {validateRecordChanges,MAX_BYTES,MAX_WORKSPACE_RECORDS} from './model.js';
import {validateAttemptChange} from './attempts.js';
import {validateResultSources} from './result-statements.js';
import {validateFigureSources} from './figure-provenance.js';
import {recordRevision,historicalBook,historicalRecordValue} from './research.js';
import {recordQueryDocument} from './web/record-query.js';
import {RecordQueryDocuments,browseDocument} from './record-query-documents.js';
import {publicationDescriptor} from './publication-record-descriptor.js';
import {ReviewScopeIndex} from './review-scope-index.js';
import {RecordHistoryIndex} from './record-history-index.js';
import {retainedRecordDisplay} from './record-history-display.js';
import {changedRetainedHistory} from './retained-record-history.js';
import {ObjectIndex} from './object-index.js';
import {metadataBatchIndex} from './metadata-batch.js';
import {cataloguePayloadRows} from './catalogue-payload-rows.js';
import {writeCatalogueRows} from './catalogue-writes.js';
import {ModuleCatalogue} from './modules/catalogue.js';
import {SnapshotIndex,validMember} from './snapshot-index.js';
import {catalogueOutline} from './catalogue-outline.js';
import {recordPublicationSummary} from './web/record-publication-summary.js';
import {recordEditionInventory} from './web/publication-inventory.js';
import {publicationCard} from './web/publication-card.js';
import {RecordSearchIndex} from './record-search-index.js';
import {verifySearchChange} from './record-search-verification.js';
import {verifyMembershipChange,verifyDerivedRecordChange,changedVerificationMembers,verifyIndexedDelta} from './record-index-verification.js';
import {RecordTypeIndex} from './record-type-index.js';
import {RecordRecentIndex} from './record-recent-index.js';
import {RecordReadingIndex} from './record-reading-index.js';
import {RecordPublicationIndex} from './record-publication-index.js';
import {recordUpdate,UPDATE_RECORDS,UPDATE_BYTES} from './record-updates.js';
import {admitResearchBytes} from './research-capacity.js';
import {validateIndexedMetadata} from './catalogue-metadata.js';
import {validRecordSelection} from './web/record-scope.js';
import {AppError} from './errors.js';
import {seal,unseal} from './encryption.js';
import {digest,serialize} from './storage.js';
import {openCatalogue,backupCatalogue} from './postgres.js';
import {retainStoredRecord,readStoredRecord,withStoredRecord,withRecordEnvelope,verifyStoredRecord} from './record-storage.js';
import {RECORD_BLOCK_PREFIX,rekeyRecordBlock} from './record-block-store.js';
import {catalogueFormat,requireRecordBlocks,requireRecordQueryBlocks,requireMemberCollections,requireSelectedValueDrafts,requireRetainedRecordDocuments,requireRunReceiptStore,requireDraftEdits,requireAttemptIndexes,requireCurrentAttemptIndexes,requireRecordTypeDrafts,requireRecordMethodIndexes,requireFigureCopyDrafts,requireSearchVocabulary,requireJoinedQueryText,requireKeyedQueryArrays,requireReferenceQueries,requireAttemptQueries,requireStarterDocuments,requireProjectDomains,requireRetiredProjectRecords,requireWorkspaceDomains,requireWorkspaceSettings,requireRecordResultIndexes} from './catalogue-format.js';
import {catalogueObjectPrefixCount} from './postgres-indexes.js';
import {recordEncoding} from './record-encoding.js';
import {withRecordWriteEncoding,recordWriteEncoding} from './record-write-encoding.js';
import {sameJSONData} from './web/json-data-equality.js';
import {verifyRecordDocument,verifyRecordVocabulary} from './record-document-verification.js';
import {RecordMemberCollections} from './record-member-collections.js';
import {recordReplacementBase,validateReplacementAttempt,replacementCompletion} from './record-replacement-bases.js';
export {CATALOGUE_FILE,CATALOGUE_ARCHIVE,openCatalogue,hasCatalogue} from './postgres.js';

export const catalogueContext=new AsyncLocalStorage();
export const catalogueDescriptor=book=>({format:'observanda-research-catalogue',version:2,workspaceId:book.id});
export const isCatalogue=value=>value?.format==='observanda-research-catalogue';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const hash=value=>digest(serialize(value));
const identifier=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const summary=(record,encoded=recordEncoding(record))=>({id:record.id,revision:encoded.revision,type:record.type,notebookId:record.notebookId,share:record.share,occurredOn:record.occurredOn,updatedAt:record.updatedAt,...(record.attempt?{hasAttempt:true}:{}),template:record.template?{id:record.template.id,label:record.template.label}:null,cardItems:Object.fromEntries(['contributors','relations','figures','attachments'].map(field=>[field,(record[field]??[]).map(item=>item.id)])),sections:(record.sections??[]).map(v=>v.id),runOf:(record.relations??[]).filter(r=>r.role==='run-of').map(r=>r.target),bytes:encoded.memberBytes});
const assembledBytes=(metadata,count,bytes)=>Buffer.byteLength(serialize(metadata))+(count?2+bytes+2*(count-1)+2:0);
const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

import {operationStage,operationSequence,operationAdvance,operationItem,operationWork} from './operation-progress.js';
export class ResearchCatalogue{
 constructor(workspace,db,{readCache=null}={}){this.workspace=workspace;this.db=db;this.readCache=readCache;}
 objectIndex(options){return metadataBatchIndex(this)??new ObjectIndex(this,options);}
 aad(table,id){return 'Observanda/research-catalogue/v1/'+this.workspace.vault.id+'/'+table+'/'+id;}
 encode(table,id,value){
  if(!this.workspace.vault?.key)throw new AppError('ACCESS_LOCKED');
  return seal(Buffer.from(serialize(value)),((metadataBatchIndex(this)?.objectReads??this.readCache)?.encryptionKey(this.workspace.vault.key)??this.workspace.vault.key),this.aad(table,id));
 }
 decode(table,id,bytes){
  if(!this.workspace.vault?.key)throw new AppError('ACCESS_LOCKED');
  if(!bytes)fail();
  try{const value=JSON.parse(unseal(Buffer.from(bytes),((metadataBatchIndex(this)?.objectReads??this.readCache)?.encryptionKey(this.workspace.vault.key)??this.workspace.vault.key),this.aad(table,id)).toString('utf8'));operationWork({objects:1,bytes:bytes.length});return value;}
  catch(error){if(error instanceof AppError)throw error;fail();}
 }
 async head(){
  const value=this.decode('state','head',(await this.db.get("SELECT payload FROM state WHERE slot='head'"))?.payload);
  if(!revision(value.id))fail();
  return value.id;
 }
 async snapshot(id){
  id??=await this.head();
  if(!revision(id))throw new AppError('INVALID');
  const row=await this.db.get('SELECT payload FROM snapshots WHERE id=$1',id);
  if(!row)throw new AppError('RECORD_HISTORY_MISSING');
  const value=this.decode('snapshot',id,row.payload);
  if(!value||!identifier(value.metadata?.id)||!Array.isArray(value.metadata.entries)||value.metadata.entries.length)fail();
  if(value.indexVersion===undefined){
   if(!Array.isArray(value.records)||!value.records.every(validMember)||new Set(value.records.map(r=>r.id)).size!==value.records.length)fail();
  }else if(value.indexVersion!==1||!SnapshotIndex.valid(value.membership)||!Number.isSafeInteger(value.count)||value.count<0||
   !Number.isSafeInteger(value.bytes)||value.bytes<0||!Number.isSafeInteger(value.nextPosition)||value.nextPosition<value.count||
   value.count===0&&value.membership!==null||value.count>0&&!value.membership||
   value.delta&&(!revision(value.delta.parent)||!Array.isArray(value.delta.changed)||!value.delta.changed.every(identifier)||new Set(value.delta.changed).size!==value.delta.changed.length||
    value.delta.removed!==undefined&&(!Array.isArray(value.delta.removed)||!value.delta.removed.every(identifier)||new Set(value.delta.removed).size!==value.delta.removed.length||value.delta.removed.some(id=>value.delta.changed.includes(id)))))fail();
  if(value.searchIndex!==undefined&&(!value.indexVersion||!RecordSearchIndex.valid(value.searchIndex)||Boolean(value.searchIndex.root)!==Boolean(value.count)))fail();
  if(value.typeIndex!==undefined&&(!value.indexVersion||!RecordTypeIndex.valid(value.typeIndex)||(value.typeIndex.root?.count??0)>value.count))fail();
  if(value.recentIndex!==undefined&&(!value.indexVersion||!RecordRecentIndex.valid(value.recentIndex)||(value.recentIndex.root?.count??0)!==value.count))fail();
  if(value.readingIndex!==undefined&&(!value.indexVersion||!RecordReadingIndex.valid(value.readingIndex)||(value.readingIndex.root?.count??0)!==value.count*2))fail();
  if(value.publicationIndex!==undefined&&(!value.indexVersion||!RecordPublicationIndex.valid(value.publicationIndex)||value.publicationIndex.version===3&&value.publicationIndex.workspaceId!==value.metadata.id||(value.publicationIndex.root?.count??0)!==value.count*RecordPublicationIndex.entriesPerRecord(value.publicationIndex.version)))fail();
  return value;
 }
 async member(snapshot,id){
  if(!identifier(id))throw new AppError('INVALID');
  return snapshot.indexVersion?new SnapshotIndex(this).get(snapshot.membership,id):snapshot.records.find(row=>row.id===id)??null;
 }
 async manifest(id){
  const value=await this.snapshot(id);
  if(!value.indexVersion)return value;
  const records=(await new SnapshotIndex(this).rows(value)).sort((a,b)=>a.position-b.position).map(({position,...row})=>row);
  return {metadata:value.metadata,records};
 }
 async indexed(snapshot){
  if(snapshot.indexVersion)return snapshot;
  const rows=snapshot.records.map((row,position)=>({...row,position}));
  return {indexVersion:1,metadata:snapshot.metadata,membership:await new SnapshotIndex(this).build(rows),
   count:rows.length,bytes:rows.reduce((total,row)=>total+row.bytes,0),nextPosition:rows.length};
 }
 async scopeKey(scopeId,generation=1,{create=false}={}){
  if(!identifier(scopeId)||!Number.isSafeInteger(generation)||generation<1)throw new AppError('INVALID');
  const row=(await this.db.get('SELECT payload FROM scope_keys WHERE scope_id=$1 AND generation=$2',scopeId,generation));
  if(!row){
   if(!create)fail();
   const key=randomBytes(32);
   try{
    const payload=this.encode('scope-key',scopeId+'/'+generation,{scopeId,generation,key:key.toString('base64')});
    (await this.db.run('INSERT INTO scope_keys VALUES ($1,$2,$3)',scopeId,generation,payload));
    return Buffer.from(key);
   }finally{key.fill(0);}
  }
  const value=this.decode('scope-key',scopeId+'/'+generation,row.payload);
  if(value.scopeId!==scopeId||value.generation!==generation||typeof value.key!=='string'||Buffer.from(value.key,'base64').length!==32||Buffer.from(value.key,'base64').toString('base64')!==value.key)fail();
  return Buffer.from(value.key,'base64');
 }
 recordAAD(id,version,scopeId,generation){return this.aad('record',id+'/'+version+'/'+scopeId+'/'+generation);}
 async putRecord(record){
  const version=(recordWriteEncoding(this,record)?.encoding??recordEncoding(record)).revision;
  if((await this.db.get('SELECT 1 FROM records WHERE id=$1 AND revision=$2',record.id,version)))return false;
  await retainStoredRecord(this,record,version);return true;
 }
 async record(id,version){
  if(!identifier(id)||!revision(version))throw new AppError('INVALID');
  return readStoredRecord(this,id,version);
 }
 putQuery(record,metadata){return new RecordQueryDocuments(this).retain(record,metadata);}
 queryDocuments(rows,metadata,options){return new RecordQueryDocuments(this).read(rows,metadata,options);}
 async *searchMembers(snapshot,notebookIds,search,{signal,relatedTo=null}={}){
  const needle=search.trim().toLocaleLowerCase();
  if(snapshot.searchIndex&&(needle||relatedTo&&snapshot.searchIndex.version===2)){yield* new RecordSearchIndex(this).candidates(snapshot.searchIndex,notebookIds,needle,{signal,relatedTo:snapshot.searchIndex.version===2?relatedTo:null});return;}
  // Retained snapshots made before search indexing keep their original identity.
  // Their next write builds an index in the same transaction, never on a read.
  yield* this.members(snapshot,{signal,notebookIds});
 }
 async *members(snapshot,{signal,notebookIds=null}={}){
  if(snapshot.indexVersion&&notebookIds&&notebookIds.size<snapshot.metadata.notebooks.length&&await new SnapshotIndex(this).scopedCount(snapshot.membership)===snapshot.count){
   const index=new SnapshotIndex(this);
   for(const notebookId of notebookIds)for await(const row of index.members(snapshot.membership,{notebookId})){signal?.throwIfAborted();yield row;}
   return;
  }
  const rows=snapshot.indexVersion?new SnapshotIndex(this).members(snapshot.membership):snapshot.records;
  let count=0,bytes=0;
  for await(const stored of rows){
   signal?.throwIfAborted();const row=snapshot.indexVersion?stored:{...stored,position:count};count++;bytes+=row.bytes;
   if(!notebookIds||!row.notebookId||notebookIds.has(row.notebookId))yield row;
  }
  if(snapshot.indexVersion&&(count!==snapshot.count||bytes!==snapshot.bytes))fail();
 }
 async read(id){
  id??=await this.head();
  const snapshot=await this.snapshot(id),count=snapshot.count??snapshot.records.length,bytes=snapshot.bytes??snapshot.records.reduce((sum,row)=>sum+row.bytes,0);
  // This compatibility response intentionally promises a complete document.
  // Reject it before original reads; ordinary app views use outline/selection
  // and bounded query owners instead of silently assembling a large corpus.
  if(count>MAX_WORKSPACE_RECORDS||assembledBytes(snapshot.metadata,count,bytes)>MAX_BYTES)throw new AppError('WORKSPACE_READ_LIMIT');
  const manifest=await this.manifest(id),book={...manifest.metadata,entries:await Promise.all(manifest.records.map(r=>this.record(r.id,r.revision)))};
  return {book,etag:id};
 }
 // Call within the caller's PostgreSQL transaction. Unchanged records are retained
 // byte for byte; one head update atomically makes metadata and revisions visible.
 async put(book,{etag=hash(book)}={}){
  const metadata={...book,entries:[]},records=[],history=[],ordinal=(await this.db.get('SELECT COALESCE(MAX(ordinal),-1)+1 AS n FROM snapshots')).n;
  if((await this.db.get('SELECT id FROM snapshots WHERE id=$1',etag)))throw new AppError('CONFLICT');
  const beforeHead=await this.db.get("SELECT payload FROM state WHERE slot='head'");
  const beforeSnapshot=beforeHead?await this.snapshot(this.decode('state','head',beforeHead.payload).id):null;
  for(const record of book.entries){
   await withRecordWriteEncoding(this,record,metadata,async (prepared,record)=>{
    const prior=beforeSnapshot?await this.member(beforeSnapshot,record.id):null;
    if(beforeSnapshot&&(record.attempt||prior?.hasAttempt))await validateAttemptChange(this.workspace,metadata.id,prior?await this.record(prior.id,prior.revision):null,record);
    if(record.results)await validateResultSources(this.workspace,record);
    await validateFigureSources(this.workspace,record);
    records.push(await new RecordMemberCollections(this).retain({...summary(record,prepared.encoding),...await this.putQuery(record,metadata)}));
    const initialize=!(await this.db.get('SELECT 1 FROM records WHERE id=$1 LIMIT 1',record.id)),fresh=await this.putRecord(record);
    history.push(Object.freeze({id:record.id,initialize,fresh,item:Object.freeze({revision:prepared.encoding.revision,snapshotId:etag,view:prepared.view})}));
   });
  }
  const oldHead=await this.db.get("SELECT payload FROM state WHERE slot='head'");
  const current=oldHead?await this.indexed(await this.snapshot(this.decode('state','head',oldHead.payload).id)):null,index=new SnapshotIndex(this);
  const rows=records.map((row,position)=>({...row,position})),before=[],after=[];let membership;
  if(!current)membership=await index.build(rows);
  else{
   const remaining=new Set(rows.map(row=>row.id));
   for(const row of rows){const old=await index.get(current.membership,row.id);if(!old||hash(old)!==hash(row)){if(old)before.push(old);after.push(row);}}
   for await(const old of index.members(current.membership))if(!remaining.has(old.id))before.push(old);
   membership=await index.replace(current.membership,before,after);
  }
  await assertProjectHierarchyChange(this,current?.metadata??null,metadata);
  const authority=new ProjectSourceAuthority(this);if(await authority.active()){await authority.metadata(current?.metadata??null,metadata);await authority.fullBookRecords(current,metadata,before,after,rows);}
  const snapshot={indexVersion:1,metadata,membership,count:rows.length,bytes:rows.reduce((total,row)=>total+row.bytes,0),nextPosition:rows.length},search=new RecordSearchIndex(this);
  snapshot.searchIndex=current?.searchIndex?await search.replace(current.searchIndex,before,after,metadata,{beforeMetadata:current.metadata}):await search.build(snapshot);
  const types=new RecordTypeIndex(this);
  snapshot.typeIndex=current?.typeIndex?await types.replace(current.typeIndex,before,after):await types.build(snapshot);
  const recent=new RecordRecentIndex(this);
  snapshot.recentIndex=current?.recentIndex?await recent.replace(current.recentIndex,before,after):await recent.build(snapshot);
  const reading=new RecordReadingIndex(this);
  snapshot.readingIndex=current?.readingIndex?await reading.replace(current.readingIndex,before,after):await reading.build(snapshot);
  const publication=new RecordPublicationIndex(this);
  snapshot.publicationIndex=current?.publicationIndex?.version===3?await publication.replace(current.publicationIndex,before,after):await publication.build(snapshot);
  await this.db.run('INSERT INTO snapshots VALUES ($1,$2,$3)',etag,ordinal,this.encode('snapshot',etag,snapshot));

  for(const {id,item,initialize,fresh} of history)await this.historyIndex(id).append(item,{initialize,fresh});
  (await this.db.run("INSERT INTO state VALUES ('head',$1) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload",this.encode('state','head',{id:etag})));
  return {book,etag};
 }
 // Validate metadata against authenticated record identities without loading bodies.
 validateMetadata(current,metadata,options){return validateIndexedMetadata(this,current,metadata,options);}
 async recordOutline({signal,snapshotId=null}={}){
  signal?.throwIfAborted();const etag=snapshotId??await this.head(),source=await this.snapshot(etag);
  if(source.metadata.formatVersion!==21)throw new AppError('INVALID');
  const {notebookCounts,total}=await catalogueOutline(this,source,{signal});
  return {outline:true,book:{...source.metadata,entries:[]},etag,recordRevisions:{},notebookCounts,total};
 }
 async recordSelection(ids,{signal,snapshotId=null,workspaceId=null}={}){
  if(!validRecordSelection(ids))throw new AppError('INVALID');
  signal?.throwIfAborted();
  const etag=snapshotId??await this.head(),source=await this.snapshot(etag);
  if(workspaceId&&source.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  if(source.metadata.formatVersion!==21)throw new AppError('INVALID');
  const entries=[],recordRevisions={},missing=[];
  let selectedBytes=0;
  for(const id of ids){
   signal?.throwIfAborted();const row=await this.member(source,id);
   if(!row){missing.push(id);continue;}
   const record=await this.record(row.id,row.revision);selectedBytes+=Buffer.byteLength(JSON.stringify(record));
   admitResearchBytes('recordSelection',selectedBytes,{recordId:id});
   entries.push(record);recordRevisions[id]=recordRevision(record);
  }
  const {notebookCounts,total}=await catalogueOutline(this,source,{signal});
  signal?.throwIfAborted();return {book:{...source.metadata,entries},etag,recordRevisions,recordScope:{ids:[...ids],missing,notebookCounts,total}};
 }
 async updateRecords(command,apply,{compact=false,recordIds=null,receipt=false,storedBases=false}={}){
  if(typeof receipt!=='boolean'||receipt&&recordIds!==null)throw new AppError('INVALID');
  if(recordIds!==null&&(!validRecordSelection(recordIds)||command.changes.some(c=>!recordIds.includes(c.id))))throw new AppError('INVALID');
  const currentId=await this.head(),source=await this.snapshot(currentId);
  if(source.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  if(receipt&&source.metadata.formatVersion!==21)throw new AppError('INVALID');
  const oldRows=new Map();
  for(const change of command.changes){const row=await this.member(source,change.id);if(row)oldRows.set(row.id,row);}
  const useBases=storedBases&&source.metadata.formatVersion===21,replacementBases=useBases?new Map():null;
  const selected=await operationStage('read-record-bases',{total:oldRows.size,unit:'records'},async()=>{
   const values=[];
   for(const row of oldRows.values()){if(useBases)replacementBases.set(row.id,await recordReplacementBase(this,row));else values.push(await this.record(row.id,row.revision));operationAdvance();}
   return values;
  });
  const original={...source.metadata,entries:selected,partialRecords:true,...(useBases?{replacementBases}:{})},result=await operationStage('prepare-record-edits',{},()=>apply(original));let modified=[];
  if(result){
   if(result.id!==source.metadata.id||result.revision!==source.metadata.revision)throw new AppError('CONFLICT');
   const now=new Date().toISOString(),previous=new Map(selected.map(r=>[r.id,r]));
   for(const record of result.entries){
    const prior=useBases?replacementBases.get(record.id):previous.get(record.id);record.createdAt=prior?.createdAt??now;
    record.updatedAt=prior&&(useBases?prior.revision===recordRevision(record):sameJSONData(prior,record))?prior.updatedAt:now;
    modified.push(record);
   }
   const current=await operationStage('validate-records',{},async()=>{
    validateRecordChanges(source.metadata,modified,[]);
    const current=await this.indexed(source),index=new SnapshotIndex(this);
    validateRecordChanges(current.metadata,modified,await index.validationRows(current.membership,modified));return current;
   });
   await this.commitChanges(currentId,current,current.metadata,modified,{now});
  }
  return operationStage('read-saved-records',{},async()=>{
  if(receipt)return {recordReceipt:{workspaceId:source.metadata.id,etag:await this.head()}};
  if(recordIds!==null)return this.recordSelection(recordIds);
  if(!compact||!command.baseEtag)return this.read();
  if(command.baseEtag===currentId)return this.changeResponse(currentId,modified,{appended:modified.filter(r=>!oldRows.has(r.id)).map(r=>r.id)});
  return this.recordPatch(command.baseEtag);
  });
 }
 // Shared commit owner for record and structure commands; caller validation and
 // all immutable branches, history receipts and the head share one transaction.
 async commitChanges(currentId,current,proposed,modified,{removed=[],now=new Date().toISOString(),membershipRebuilt=false}={}){
   if(proposed.id!==current.metadata.id||proposed.revision!==current.metadata.revision||proposed.createdAt!==current.metadata.createdAt)throw new AppError('CONFLICT');
   const bulk=removed.length>20||!Array.isArray(modified)||modified.length>20;
   const index=new SnapshotIndex(this,bulk?{cacheSize:4096,cacheMembers:true}:{});
   const metadata={...proposed,entries:[],revision:current.metadata.revision+1,updatedAt:now},before=[],after=[];
   const removedIds=new Set(removed),changedIds=new Set();
   if(removedIds.size!==removed.length)throw new AppError('INVALID');
   const etag=digest('Observanda/catalogue-snapshot/'+randomUUID()),ordinal=(await this.db.get('SELECT MAX(ordinal)+1 AS n FROM snapshots')).n;
   let count=current.count,bytes=current.bytes,nextPosition=current.nextPosition;
   for(const id of removedIds){
    const prior=await index.get(current.membership,id);if(!prior)throw new AppError('CONFLICT');
    before.push(prior);count--;bytes-=prior.bytes;
   }
   // Bulk presentation and hierarchy commands may stream originals. Only
   // authenticated member descriptors survive each iteration; record bodies
   // and their history are retained within this same transaction.
   await operationStage('write-records',{...(Array.isArray(modified)?{total:modified.length}:{}),unit:'records'},async()=>{
   for await(const record of modified){
    operationItem(record.title);
    await withRecordWriteEncoding(this,record,metadata,async (prepared,record)=>{
     admitResearchBytes('record',prepared.encoding.bytes,{recordId:record.id});
     if(removedIds.has(record.id)||changedIds.has(record.id))throw new AppError('INVALID');
     changedIds.add(record.id);
     const prior=await index.get(current.membership,record.id);
     await replacementCompletion(this,prior,record,metadata);
     await validateReplacementAttempt(this,prior,record,metadata);
     if(record.results)await validateResultSources(this.workspace,record);
     await validateFigureSources(this.workspace,record);
     const row=await new RecordMemberCollections(this).retain({...summary(record,prepared.encoding),...await this.putQuery(record,metadata),position:prior?.position??nextPosition++});
     if(prior){before.push(prior);bytes-=prior.bytes;}else count++;
     after.push(row);bytes+=row.bytes;
     const initialize=!(await this.db.get('SELECT 1 FROM records WHERE id=$1 LIMIT 1',record.id));
     const fresh=await this.putRecord(record);
     await this.rememberHistory(record,metadata,etag,initialize,fresh);
    });
    operationAdvance();
   }
   });
   return this.finishRecordChanges(currentId,current,metadata,before,after,{removed,changedIds,now,membershipRebuilt,bulk,index,etag,ordinal,count,bytes,nextPosition});
 }
 // Every writer, including selected-block edits, publishes through the same
 // membership, history and derived-index transaction. No head is advanced until
 // all the retained values and indexes have been written successfully.
 async finishRecordChanges(currentId,current,metadata,before,after,{removed=[],changedIds=new Set(after.map(row=>row.id)),membershipRebuilt=false,bulk=false,index=new SnapshotIndex(this),etag,ordinal,count=current.count-before.length+after.length,bytes=current.bytes-before.reduce((n,row)=>n+row.bytes,0)+after.reduce((n,row)=>n+row.bytes,0),nextPosition=current.nextPosition}={}){
   await assertProjectHierarchyChange(this,current.metadata,metadata);
   const authority=new ProjectSourceAuthority(this);if(await authority.active()){await authority.metadata(current.metadata,metadata);await authority.recordRows(current.metadata,before);await authority.recordRows(metadata,after);}
   return operationStage('index-records',{total:5,unit:'indexes'},async()=>{
   if(!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(bytes)||bytes<0||!Number.isSafeInteger(nextPosition))throw new AppError('LIMIT');
   admitResearchBytes('metadata',Buffer.byteLength(serialize(metadata)));
   const membership=await index.replace(current.membership,before,after);
   if(metadata.websites?.length){
    const old=new Map(before.map(r=>[r.id,r])),project=(m,n)=>m.notebooks.find(book=>book.id===n)?.projectId;
    const moved=after.filter(r=>old.has(r.id)&&(old.get(r.id).notebookId!==r.notebookId||project(current.metadata,r.notebookId)!==project(metadata,r.notebookId))).map(r=>r.id);
    await reconcileWebsiteMembership(metadata,id=>index.get(membership,id),{moved,removed,previous:current.metadata});
    admitResearchBytes('metadata',Buffer.byteLength(serialize(metadata)));
   }
   const snapshot={indexVersion:1,metadata,membership,count,bytes,nextPosition,
    // Reconstructed old membership changes authenticated descriptors even when
    // no original changed. A record-only delta cannot describe that transition.
    ...(!membershipRebuilt&&count===current.count-removed.length?{delta:{parent:currentId,changed:[...changedIds],...(removed.length?{removed}: {})}}:{})};
   const search=new RecordSearchIndex(this,bulk?{cacheSize:4096}:{});
   snapshot.searchIndex=current.searchIndex?await search.replace(current.searchIndex,before,after,metadata,{beforeMetadata:current.metadata}):await search.build(snapshot);
   operationAdvance();
   const types=new RecordTypeIndex(this);
   snapshot.typeIndex=current.typeIndex?await types.replace(current.typeIndex,before,after):await types.build(snapshot);
   operationAdvance();
   const recent=new RecordRecentIndex(this);
   snapshot.recentIndex=current.recentIndex?await recent.replace(current.recentIndex,before,after):await recent.build(snapshot);
   operationAdvance();
   const reading=new RecordReadingIndex(this);
   snapshot.readingIndex=current.readingIndex?await reading.replace(current.readingIndex,before,after):await reading.build(snapshot);
   operationAdvance();
   const publication=new RecordPublicationIndex(this);
   snapshot.publicationIndex=current.publicationIndex?.version===3?await publication.replace(current.publicationIndex,before,after):await publication.build(snapshot);
   operationAdvance();
   await this.db.run('INSERT INTO snapshots VALUES ($1,$2,$3)',etag,ordinal,this.encode('snapshot',etag,snapshot));
   await this.db.run("UPDATE state SET payload=$1 WHERE slot='head'",this.encode('state','head',{id:etag}));
   return etag;
   });
 }
 // Exact-base writers already know the complete delta. Reuse it for edits and
 // insertions instead of scanning membership or rereading just-written bodies.
 async changeResponse(baseEtag,records,{removed=[],appended=[]}={}){
  if(records.length+removed.length>UPDATE_RECORDS||records.reduce((n,record)=>n+Buffer.byteLength(JSON.stringify(record)),0)>UPDATE_BYTES)return this.recordPatch(baseEtag);
  const etag=await this.head(),snapshot=await this.snapshot(etag);
  return {etag,recordPatch:{baseEtag,metadata:snapshot.metadata,order:null,count:snapshot.count??snapshot.records.length,records,removed,appended},
   recordRevisions:Object.fromEntries(records.map(r=>[r.id,recordRevision(r)]))};
 }
 async recordPatch(baseEtag,{signal}={}){
  signal?.throwIfAborted();
  const head=await this.head(),next=await this.snapshot(head),base=await this.snapshot(baseEtag);
  if(base.metadata.id!==next.metadata.id)throw new AppError('WORKSPACE_CHANGED');
  if(base.indexVersion&&next.indexVersion)return recordUpdate(this,baseEtag,{signal});
  const count=next.count??next.records.length,bytes=next.bytes??next.records.reduce((n,row)=>n+row.bytes,0);
  if(count>MAX_WORKSPACE_RECORDS||assembledBytes(next.metadata,count,bytes)>MAX_BYTES)throw new AppError('WORKSPACE_READ_LIMIT');
  const changed=new Set();let cursor=head,source=next;
  // Compatibility with flat retained bases: recent deltas may still provide a
  // small response. Older flat history retains its complete reconciliation path.
  for(let depth=0;depth<64;depth++){
   if(cursor===baseEtag){
    const records=[],removed=[];
    for(const id of changed){
     const row=await this.member(next,id),prior=await this.member(source,id);if(!prior)fail();
     if(!row)removed.push(id);else if(row.revision!==prior.revision)records.push(await this.record(id,row.revision));
    }
    return {etag:head,recordPatch:{baseEtag,metadata:next.metadata,order:null,count:next.count??next.records.length,records,removed},
     recordRevisions:Object.fromEntries(records.map(r=>[r.id,recordRevision(r)]))};
   }
   if(!source.delta)break;
   for(const id of [...source.delta.changed,...(source.delta.removed??[])])changed.add(id);
   cursor=source.delta.parent;source=await this.snapshot(cursor);
   if(source.metadata.id!==next.metadata.id)fail();
  }
  const previous=await this.manifest(baseEtag),complete=await this.manifest(head);
  const prior=new Map(previous.records.map(r=>[r.id,r.revision])),nextIds=new Set(complete.records.map(r=>r.id));
  const records=await Promise.all(complete.records.filter(r=>prior.get(r.id)!==r.revision).map(r=>this.record(r.id,r.revision)));
  return {etag:head,recordPatch:{baseEtag,metadata:complete.metadata,order:complete.records.map(r=>r.id),records,removed:previous.records.filter(r=>!nextIds.has(r.id)).map(r=>r.id)},
    recordRevisions:Object.fromEntries(records.map(r=>[r.id,recordRevision(r)]))};
 }
 async snapshots(){return (await this.db.all('SELECT id FROM snapshots ORDER BY ordinal DESC')).map(r=>r.id);}
 async rememberHistory(record,metadata,snapshotId,initialize=false,fresh=false){
  const prepared=recordWriteEncoding(this,record,metadata);
  if(prepared)return this.historyIndex(record.id).append({revision:prepared.encoding.revision,snapshotId,view:prepared.view},{initialize,fresh});
  const display=historicalRecordValue(metadata,record);
  return this.historyIndex(record.id).append({revision:recordEncoding(record).revision,snapshotId,view:{revision:recordRevision(display),title:display.title,status:display.status,updatedAt:display.updatedAt}},{initialize,fresh});
 }
 historyIndex(id){return new RecordHistoryIndex(this,id);}
 async historyItem(id,row){
  const manifest=await this.snapshot(row.snapshotId);
  if((await this.member(manifest,id))?.revision!==row.revision)fail();
  return {record:await this.record(id,row.revision),metadata:manifest.metadata,snapshotId:row.snapshotId};
 }
 async verifyRecordHistory(id){
  const index=this.historyIndex(id),head=await index.head();await index.check(head);let ordinal=0;
  for await(const row of index.items(head)){
   const snapshot=await this.snapshot(row.snapshotId);if((await this.member(snapshot,id))?.revision!==row.revision)fail();
   const display=await retainedRecordDisplay(this,id,row.revision,snapshot.metadata);
   if(row.view&&hash(row.view)!==hash(display))fail();
   if(!head.legacy&&(await index.lookup(head,'view',display.revision)).ordinal!==ordinal)fail();ordinal++;
  }
  // Verify every raw revision's lookup, including alternate serialized forms of
  // one canonical revision. Stream identities rather than retaining all bodies.
  let count=0;
  for await(const row of this.db.rows('SELECT revision FROM records WHERE id=$1',[id])){
    const found=await index.lookup(head,'version',row.revision),source=await this.snapshot(found.item.snapshotId);
    // Visible revisions were authenticated above. Only an alternate serialized
    // spelling needs another body traversal to prove the same logical identity.
    if(row.revision!==found.item.revision){
     const display=await retainedRecordDisplay(this,id,row.revision,source.metadata);
     if(found.item.view&&display.revision!==found.item.view.revision)fail();
    }
    count++;
  }
  if(count!==head.revisions)fail();
 }
 async moduleData(workspaceId,options){return new ModuleCatalogue(this).read(workspaceId,options);}
 async assertModuleWrite(){if((await readProjectDomainRegistry(this))?.commandVersion===1)throw new AppError('ACCESS_UPGRADE');}
 async putModuleData(data,changed,event){return new ModuleCatalogue(this).write(data,changed,event);}
 async objectIdPage(prefix,{after=null,limit=32,signal}={}){
  if(typeof prefix!=='string'||after!==null&&(typeof after!=='string'||!after.startsWith(prefix))||!Number.isSafeInteger(limit)||limit<1||limit>32)throw new AppError('INVALID');
  signal?.throwIfAborted();const index=this.objectIndex({cacheReads:true}),head=await index.head(),items=[];let next=null;
  await metadataBatchIndex(this)?.flushObjects();
  const proof=async()=>{
   const total=await index.prefixCount(head,prefix),actual=await catalogueObjectPrefixCount(this.db,prefix);
   if(actual.n!==String(total))fail();
  };
  if(this.readCache)await this.readCache.proof('prefix:'+prefix,proof);else await proof();
  for await(const entry of index.entries(head,prefix,after)){
   signal?.throwIfAborted();if(items.length===limit){next=items.at(-1);break;}items.push(entry.id);
  }
  if(items.length){
   const rows=await this.db.all('SELECT id FROM objects WHERE id=ANY($1::text[])',items),found=new Set(rows.map(r=>r.id));
   if(found.size!==items.length||items.some(id=>!found.has(id)))fail();
  }
  return {items,next};
 }
 async *objectIdEntries(prefix,{signal}={}){
  let after=null;
  do{
   const page=await this.objectIdPage(prefix,{after,signal});
   for(const id of page.items){signal?.throwIfAborted();yield id;}after=page.next;
  }while(after!==null);
 }
 async objectIdentity(id){
  await metadataBatchIndex(this)?.flushObjects();
  const index=this.objectIndex(),head=await index.head(),entry=await index.find(head,id),
        row=await this.db.get('SELECT id FROM objects WHERE id=$1',id);
  if(!!entry!==!!row)fail();return entry?{id:entry.id,revision:entry.revision}:null;
 }
 async objectIds(prefix){const ids=[];for await(const id of this.objectIdEntries(prefix))ids.push(id);return ids;}
 async objectPage(prefix,{after=null,limit=20,localOnly=false}={}){
  if(typeof prefix!=='string'||!prefix||after!==null&&(typeof after!=='string'||!after.startsWith(prefix))||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AppError('INVALID');
  const index=this.objectIndex(),head=await index.head(),items=[];let next=null;
  // Range proofs are the same authenticated branches used for point reads.
  // Extra unindexed SQL rows never become visible; backup verifies all row counts.
  for await(const entry of index.entries(head,prefix,after)){
   if(localOnly&&await retiredMetadataSourceLocation(this,entry.id))continue;
   if(items.length===limit){next=items.at(-1).id;break;}
   items.push({id:entry.id,value:await this.objectValue(entry.id,entry)});
  }
  return {items,next};
 }
 async objectValue(id,expected){
  const batch=metadataBatchIndex(this),row=batch?await batch.objectRow(id):await this.db.get('SELECT payload FROM objects WHERE id=$1',id);
  if(!!expected!==!!row)fail();if(!row)return null;
  const value=await resolveMetadataValue(this,id,expected.revision,this.decode('object',id,row.payload));if(hash(value)!==expected.revision)fail();return value;
 }
 async object(id){
  const index=this.objectIndex(),head=await index.head();
  return this.objectValue(id,await index.find(head,id));
 }
 async putObject(id,value){
  if(id==='metadata:.observanda/dashboard.observanda'&&await workspaceSettingsRegistry(this))throw new AppError('ACCESS_UPGRADE');
  if(id.startsWith('metadata:.observanda/module-draft')&&(await readProjectDomainRegistry(this))?.authoringVersion===1)throw new AppError('ACCESS_UPGRADE');
  const index=this.objectIndex(),head=await index.head(),expected=await index.find(head,id),revision=hash(value);
  if(expected)await this.objectValue(id,expected);
  if(expected?.revision===revision)return;
  // Convert an older index before changing row counts. Both the index and
  // object payload commit together under the workspace writer lock.
  await index.update(head,id,revision);
  const payload=this.encode('object',id,value),batch=metadataBatchIndex(this);
  if(batch)await batch.stageObject(id,payload,{create:!expected});
  else{
   try{await this.db.run('INSERT INTO objects VALUES ($1,$2)'+(expected?' ON CONFLICT(id) DO UPDATE SET payload=excluded.payload':''),id,payload);}
   catch(error){if(!expected&&error.code==='23505')fail();throw error;}
  }
  await changedRetainedHistory(this,id,revision);
 }
 async deleteObject(id){
  const index=this.objectIndex(),head=await index.head(),expected=await index.find(head,id);
  await this.objectValue(id,expected);if(!expected)return;
  await index.update(head,id,null);
  const batch=metadataBatchIndex(this);
  if(batch)await batch.stageObject(id,null);else await this.db.run('DELETE FROM objects WHERE id=$1',id);
  await changedRetainedHistory(this,id,null);
 }
 async *verifiedObjects(){
  yield* verifiedCatalogueObjects(this);
 }
 async *orderedMembers(snapshot){
  if(snapshot.indexVersion){yield* this.members(snapshot);return;}
  // Only the old, intrinsically flat representation needs an array here.
  yield* snapshot.records.map((row,position)=>({...row,position})).sort((a,b)=>a.id<b.id?-1:1);
 }
 async verifyDelta(snapshot){
  const parent=await this.snapshot(snapshot.delta.parent);
  if(parent.metadata.id!==snapshot.metadata.id||parent.metadata.revision+1!==snapshot.metadata.revision)fail();
  if(await verifyIndexedDelta(this,parent,snapshot))return;
  const changed=new Set(snapshot.delta.changed),removed=new Set(snapshot.delta.removed??[]);
  let changes=0,deletions=0;
  const iterator=this.orderedMembers(parent);
  try{
   let prior=await iterator.next();
   for await(const row of this.orderedMembers(snapshot)){
    while(!prior.done&&prior.value.id<row.id){
     if(!removed.has(prior.value.id))fail();deletions++;prior=await iterator.next();
    }
    if(prior.done||row.id!==prior.value.id||removed.has(row.id)||row.position!==prior.value.position)fail();
    if(changed.has(row.id))changes++;else if(hash(row)!==hash(prior.value))fail();
    prior=await iterator.next();
   }
   while(!prior.done){if(!removed.has(prior.value.id))fail();deletions++;prior=await iterator.next();}
  }finally{await iterator.return();}
  if(changes!==changed.size||deletions!==removed.size)fail();
 }
 async verifySnapshot(id,workspaceId,verified={once:(_identity,check)=>check()},previous=null,media=null){
  if(!verified.stableSnapshot)previous=null;
  const snapshot=await this.snapshot(id),index=new SnapshotIndex(this,{cacheSize:4096}),context=hash(verificationContext(snapshot.metadata));
  if(snapshot.metadata.id!==workspaceId)fail();
  if(snapshot.indexVersion)await verified.once(['membership',snapshot.membership,snapshot.searchIndex,snapshot.count,snapshot.bytes,snapshot.nextPosition],async()=>{
   if(!previous||!await verifyMembershipChange(this,previous,snapshot))await index.verify(snapshot);
  });
  if(snapshot.metadata.formatVersion===21){
   try{await this.validateMetadata(snapshot,snapshot.metadata);}catch(error){if(['INVALID','FORMAT','LIMIT','RECORD_SIZE_LIMIT','WORKSPACE_METADATA_LIMIT'].includes(error.code))fail();throw error;}
  }
  if(media)await verified.once(['media-metadata',context],()=>media.metadata(snapshot.metadata));
  const unchangedContext=previous?.indexVersion&&snapshot.indexVersion&&snapshot.metadata.formatVersion===21&&hash(verificationContext(previous.metadata))===context;
  const members=unchangedContext?changedVerificationMembers(this,previous,snapshot):this.members(snapshot);
  for await(const row of members){
   // The member contains every identity/workflow field used to resolve the
   // other records needed by validation. Their authenticated values are part
   // of the receipt, so changed ownership or run relationships force a check.
   // Full membership verification already proves section identity ownership.
   // Workflow validation needs the parent/child relationships, not every ID.
   const validation=snapshot.indexVersion&&snapshot.metadata.formatVersion===21?await index.validationRows(snapshot.membership,[{id:row.id,type:row.type,sections:[],relations:row.runOf.map(target=>({role:'run-of',target}))}]):[];
   await verified.once(['record',context,row,validation],async()=>{
   if(snapshot.metadata.formatVersion===21&&row.queryRevision&&(row.bytes>65535||row.collections||row.hasAttempt)){
    try{await verifyRecordDocument(this,row,snapshot.metadata,validation,media);}
    catch(error){if(['INVALID','FORMAT','LIMIT','RECORD_SIZE_LIMIT'].includes(error.code))fail();throw error;}
    return;
   }
   const record=await this.record(row.id,row.revision),{position,queryRevision,summaryRevision,...stored}=row,expected=summary(record);void position;void queryRevision;void summaryRevision;
   if(row.notebookId===undefined)delete expected.notebookId;
   if(row.share===undefined)delete expected.share;
   if(row.updatedAt===undefined)delete expected.updatedAt;
   if(row.occurredOn===undefined)delete expected.occurredOn;
   if(row.template===undefined)delete expected.template;
   if(row.cardItems===undefined)delete expected.cardItems;
   if(hash(stored)!==hash(expected))fail();
   if(media)await media.record(record);
   await validateFigureSources(this.workspace,record);
   if(snapshot.indexVersion&&snapshot.metadata.formatVersion===21){
    try{validateRecordChanges(snapshot.metadata,[record],validation);}
    catch(error){if(['INVALID','FORMAT','LIMIT','RECORD_SIZE_LIMIT'].includes(error.code))fail();throw error;}
   }
   await verifyRecordVocabulary(this,row);
   for(const search of row.summaryRevision?[true,false]:[true])for await(const value of this.queryDocuments([row],snapshot.metadata,{revisions:true,search,publication:true,cards:true,inventory:true,publicationDetails:true,stored:true})){
    const {revision:cachedRevision,storageRevision,...query}=value,display=historicalBook(snapshot.metadata,record).entries[0];void storageRevision;
    if(cachedRevision!==null&&cachedRevision!==recordRevision(display))fail();
    const expectedQuery=search?recordQueryDocument(display):browseDocument(recordQueryDocument(display));expectedQuery.publication=recordPublicationSummary(display);expectedQuery.publicationCard=publicationCard(display);if(!Object.hasOwn(query,'referenceTargets'))delete expectedQuery.referenceTargets;
    if(!Object.hasOwn(query,'cardSources'))delete expectedQuery.cardSources;
    if(!Object.hasOwn(query,'publication'))delete expectedQuery.publication;
    if(!Object.hasOwn(query,'publicationCard'))delete expectedQuery.publicationCard;
    if(Object.hasOwn(query,'publicationDescriptor'))expectedQuery.publicationDescriptor=publicationDescriptor(display);
    if(Object.hasOwn(query,'editionInventory'))expectedQuery.editionInventory=recordEditionInventory(display,recordRevision(display));
    if(hash(query)!==hash(expectedQuery))fail();
   }
   });
  }
  if(snapshot.delta)await this.verifyDelta(snapshot);
  if(snapshot.searchIndex)await verified.once(['search',context,snapshot.membership,snapshot.searchIndex,snapshot.count],async()=>{
   if(!previous||!await verifySearchChange(this,previous,snapshot))await new RecordSearchIndex(this,{cacheSize:4096}).verify(snapshot);
  });
  for(const [field,Owner] of [['typeIndex',RecordTypeIndex],['recentIndex',RecordRecentIndex],['readingIndex',RecordReadingIndex],['publicationIndex',RecordPublicationIndex]])if(snapshot[field])await verified.once([field,snapshot.membership,snapshot[field]],async()=>{
   const index=new Owner(this,{cacheSize:4096});if(!previous||!await verifyDerivedRecordChange(this,index,field,previous,snapshot))await index.verify(snapshot);
  });
  return snapshot;
 }
 async verify(descriptor){
  return operationStage('verify-copy',{},async()=>{
  if(!descriptor||Object.keys(descriptor).sort().join()!=='format,version,workspaceId'||descriptor.format!=='observanda-research-catalogue'||descriptor.version!==2||!identifier(descriptor.workspaceId))fail();
  if((await this.snapshot()).metadata.id!==descriptor.workspaceId)fail();
  await withCatalogueVerification(this,verified=>this.workspace.inspectCatalogue(this,async()=>{
   const {MediaVerification}=await import('./media-verification.js'),media=new MediaVerification(this.workspace,verified);
   let previous=null;
   await operationSequence('verify-copy',['verify-snapshots','verify-modules','verify-objects','verify-analysis','verify-reviews','verify-imports','verify-evidence','verify-collaboration','verify-media','verify-publication','verify-drafts','verify-run-receipts','verify-history'],async()=>{
   await operationStage('verify-snapshots',{total:Number((await this.db.get('SELECT count(*)::text AS total FROM snapshots')).total),unit:'snapshots'},async()=>{
    for await(const {id} of this.db.rows('SELECT id FROM snapshots ORDER BY ordinal')){operationItem(id);previous=await this.verifySnapshot(id,descriptor.workspaceId,verified,verified.stableSnapshot?previous:null,media);operationAdvance();}
   });
   const {workspaceModules}=await import('./modules/index.js');
   await operationStage('verify-modules',{},async()=>{await workspaceModules(this.workspace).verifyCatalogue(this,descriptor.workspaceId);});
   await operationStage('verify-objects',{},async()=>{await verifyWorkspaceSettings(this);for await(const object of this.verifiedObjects())void object;});
   const {verifySampleAnalysisCatalogue}=await import('./sample-analysis-catalogue.js');
   await operationStage('verify-analysis',{},()=>verifySampleAnalysisCatalogue(this));
   await operationStage('verify-reviews',{},()=>new ReviewScopeIndex(this).verify());
   const {verifyImports}=await import('./migration/import-verification.js');
   await operationStage('verify-imports',{},()=>verifyImports(this));
   const {ResearchMaterials}=await import('./research-materials.js');
   await operationStage('verify-evidence',{},()=>new ResearchMaterials(this.workspace).verifySnapshot({readOnly:true}));
   const {verifyCollaboration}=await import('./collaboration/verification.js');
   await operationStage('verify-collaboration',{},()=>verifyCollaboration(this.workspace,verified));
   await operationStage('verify-media',{},()=>media.pending());
   const {verifyPublicationStorage}=await import('./publication-storage-verification.js');await operationStage('verify-publication',{},()=>verifyPublicationStorage(this.workspace));
   const {verifyResearchDrafts}=await import('./research-draft-verification.js'),{verifyRecordStarters}=await import('./record-starter-verification.js');await operationStage('verify-drafts',{unit:'checkpoints'},async()=>{await verifyResearchDrafts(this);await verifyRecordStarters(this.workspace);});
   await operationStage('verify-run-receipts',{},async()=>{
    const {verifyRunReceiptStores}=await import('./run-receipt-store.js');await verifyRunReceiptStores(this.workspace);
    const {verifyRecordRunCreations}=await import('./record-run-creation.js');await verifyRecordRunCreations(this);
   });
   await operationStage('verify-history',{total:Number((await this.db.get('SELECT count(DISTINCT id)::text AS total FROM records')).total),unit:'records'},async()=>{
    for await(const row of this.db.rows('SELECT DISTINCT id FROM records ORDER BY id')){operationItem(row.id);await this.verifyRecordHistory(row.id);operationAdvance();}
   });
   });
  }));
  });
 }
}

// Rekey encrypted objects into a portable backup, preserving historical identities.
export async function rekeyCatalogue(source,target,descriptor){
 return operationStage('rekey',{},async()=>{
 // A storage handoff already owns and freezes this source catalogue. Reuse
 // that transaction rather than restoring and verifying the same archive in
 // another connection while its writer is held. catalogue() checks the owner
 // namespace and vault before allowing the borrowed connection.
 const borrowed=catalogueContext.getStore()?.root===source.root?await source.catalogue(store=>store):null;
 const sourceDb=borrowed?.db??await source.openCatalogue({detached:true});let targetDb;
 try{
  targetDb=await target.openCatalogue({create:true,detached:true});
  if(!borrowed)await sourceDb.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await targetDb.run('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const from=borrowed??source.catalogueStore(sourceDb),to=target.catalogueStore(targetDb);
  const transferRows=(table,query,visit)=>operationStage('rekey-table',{unit:'rows',item:table},async()=>{
   for await(const row of sourceDb.rows(query,[],{batchSize:1})){await visit(row);operationAdvance();}
  });
  const format=await catalogueFormat(sourceDb);
  if(format>=4)await ({4:requireRecordBlocks,5:requireRecordQueryBlocks,6:requireMemberCollections,7:requireSelectedValueDrafts,8:requireRetainedRecordDocuments,9:requireRunReceiptStore,10:requireDraftEdits,11:requireAttemptIndexes,12:requireCurrentAttemptIndexes,13:requireRecordTypeDrafts,14:requireRecordMethodIndexes,15:requireFigureCopyDrafts,16:requireSearchVocabulary,17:requireJoinedQueryText,18:requireKeyedQueryArrays,19:requireReferenceQueries,20:requireAttemptQueries,21:requireStarterDocuments,22:requireProjectDomains,23:requireRetiredProjectRecords,24:requireWorkspaceDomains,25:requireWorkspaceSettings,26:requireRecordResultIndexes,27:async db=>{await requireWorkspaceDomains(db);await requireRecordResultIndexes(db);},28:async db=>{await requireWorkspaceSettings(db);await requireRecordResultIndexes(db);}}[format])(targetDb);
  // Rekey the retained representation itself: rebuilding books changes index
  // roots/deltas and omits non-record state. Fresh per-scope keys encrypt the
  // same original records; all content identities and historical roots survive.
  await transferRows('scope_keys','SELECT scope_id,generation FROM scope_keys',async row=>{
   const prior=await from.scopeKey(row.scope_id,row.generation);prior.fill(0);
   const next=await to.scopeKey(row.scope_id,row.generation,{create:true});next.fill(0);
  });
  await transferRows('records','SELECT id,revision,scope_id,generation FROM records',async row=>{
   await verifyStoredRecord(from,row.id,row.revision);
   await withRecordEnvelope(from,row.id,row.revision,async({value})=>{
    const key=await to.scopeKey(row.scope_id,row.generation);
    try{await targetDb.run('INSERT INTO records VALUES ($1,$2,$3,$4,$5)',row.id,row.revision,row.scope_id,row.generation,
     seal(Buffer.from(serialize(value)),key,to.recordAAD(row.id,row.revision,row.scope_id,row.generation)));}
    finally{key.fill(0);}
   });
  });
  await transferRows('snapshots','SELECT id,ordinal,payload FROM snapshots',async({id,ordinal,payload})=>
   targetDb.run('INSERT INTO snapshots VALUES ($1,$2,$3)',id,ordinal,to.encode('snapshot',id,from.decode('snapshot',id,payload))));
  const rekeyRows=async function*(table,key){
   for await(const row of cataloguePayloadRows(sourceDb,table,[key,'payload'])){
    const owner=table==='objects'?'object':'state';let value=from.decode(owner,row[key],row.payload);
    if(table==='state'&&row[key].startsWith(RECORD_BLOCK_PREFIX))value=await rekeyRecordBlock(from,to,row[key],value);
    yield [row[key],to.encode(owner,row[key],value)];operationAdvance();
   }
  };
  await operationStage('rekey-table',{unit:'rows',item:'state'},()=>writeCatalogueRows(targetDb,'state',rekeyRows('state','slot'),{create:true}));
  await transferRows('module_entities','SELECT * FROM module_entities',async({id,revision,payload})=>
   targetDb.run('INSERT INTO module_entities VALUES ($1,$2,$3)',id,revision,to.encode('module-entity',id+'/'+revision,from.decode('module-entity',id+'/'+revision,payload))));
  await transferRows('module_events','SELECT * FROM module_events',async row=>
   targetDb.run('INSERT INTO module_events VALUES ($1,$2,$3)',row.command_id,row.ordinal,to.encode('module-event',row.command_id+'/'+row.ordinal,from.decode('module-event',row.command_id+'/'+row.ordinal,row.payload))));
  await operationStage('rekey-table',{unit:'rows',item:'objects'},()=>writeCatalogueRows(targetDb,'objects',rekeyRows('objects','id'),{create:true}));
  await rekeyProjectDomains(from,to);
  // Verify the copied descriptor and all re-encrypted content in the same
  // transaction that creates this exclusively owned, still-marked destination.
  await targetDb.scope(()=>withRetiredRecordCopy(source,target,()=>to.verify(descriptor)));
  await targetDb.run('COMMIT');if(!borrowed)await sourceDb.run('COMMIT');
  await backupCatalogue(target.root,target.root,{connection:targetDb});
 }finally{if(!borrowed)await sourceDb.close();await targetDb?.close();}
 });
}
export async function verifyCatalogueArchive(workspace,descriptor){
 let verified=false;
 const db=await workspace.openCatalogue({detached:true,onVerified:value=>{verified=serialize(value)===serialize(descriptor);}});
 // A newly restored archive is checked before its import transaction commits.
 // An existing binding still needs an explicit check of its current snapshot.
 try{if(verified)return;await db.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await db.scope(()=>workspace.catalogueStore(db).verify(descriptor));await db.run('COMMIT');}finally{await db.close();}
}
