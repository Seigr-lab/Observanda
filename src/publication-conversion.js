import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {withRecordDocument} from './record-document.js';
import {SnapshotIndex} from './snapshot-index.js';
import {WebsiteFileStore,websiteSourceId} from './website-file-store.js';
import {sourceRecordAllowed} from './web/source-publication-permissions.js';
import {PUBLICATION_PARTS,publicationPartAllowed,figureSharingId} from './web/record-publication-privacy.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {convertPublicationRecord} from './publication-conversion-render.js';
import {enrichWebsiteSources} from './website-file-library.js';
import {changedFeedField,feedContentStamp} from './publication-feed-admission.js';
import {feedOwnerDeletionHooks} from './website-feed-owner.js';
import {runWebsiteUpgrade} from './website-upgrade-lease.js';
import {readFeedSource,writeLiveFeedSource,removeLiveFeedSource,releasePreviousFeedSource} from './website-feed-source.js';

const channels=['website','pdf'];
const consentKey=target=>target==='pdf'?'sharePdf':'share';
const domainFields=new Set(PUBLICATION_PARTS);
const collectionAllowed=(value,target,collection)=>target==='pdf'?value===true:collection==='sections'?value!==false:value===true;
const identity=(metadata,recordId,notebookId,target)=>{const book=metadata.notebooks.find(item=>item.id===notebookId);return book?{workspaceId:metadata.id,projectId:book.projectId,notebookId,recordId,target}:null;};
function libraryContext(metadata,provenance){
 const book=metadata.notebooks.find(b=>b.id===provenance.notebookId&&b.projectId===provenance.projectId);
 if(metadata.id!==provenance.workspaceId||!book||book.share===false)throw new AppError('PUBLICATION_PERMISSIONS_CHANGED');
 const title=value=>typeof value==='string'?value.trim().slice(0,300)||null:null;
 return {projectTitle:title(metadata.projects?.find(p=>p.id===book.projectId)?.title),notebookTitle:title(book.title)};
}

// Never enumerate a research owner while opening a website. Only an explicit
// research save can reach this adapter. Ordinary edits to copied writing do
// not change the copy. Deleting its original is not a publication withdrawal.
function commandTargets(route,data){
 if(!data||typeof data!=='object')return null;
 const records=new Map(),books=new Set(),previousLocations=[],removed=new Set(),removedBooks=new Set();let liveOnly=false,liveFields,selectedId;
 const add=(id,notebook=null)=>{if(researchId(id))records.set(id,notebook);};
 switch(route){
 case '/api/research/records/tags':add(data.recordId);break;
 case '/internal/publication/live-fields':
  if(!Array.isArray(data.fields))return null;
  liveOnly=!data.fields.includes('tags');liveFields=[...new Set(data.fields.map(changedFeedField).filter(Boolean))];
  if(liveOnly&&!liveFields.length)return null;selectedId=data.sectionId;add(data.recordId);break;
 case '/api/research/records/remove':add(data.recordId);removed.add(data.recordId);liveOnly=true;break;
 case '/api/research/records/values/save':{
  if(!['share','sharePdf','publication'].includes(data.field)&&!figureSharingId(data.field)&&!(typeof data.field==='string'&&data.field.startsWith('media:'))){
   const field=changedFeedField(data.field);if(!field)return null;liveOnly=true;liveFields=[field];if(field==='figures')selectedId=data.field.slice(7);
  }
  add(data.recordId);break;
 }
 case '/api/research/records/writing/save':if(!data.value)return null;
  liveOnly=!data.sectionId||!['share','sharePdf'].some(key=>Object.hasOwn(data.value,key));liveFields=[data.sectionId?'sections':'body'];selectedId=data.sectionId;add(data.recordId);break;
 case '/api/research/records/sections':liveOnly=data.action==='move';liveFields=['sections'];add(data.recordId);break;
 case '/api/research/records/figures':liveOnly=true;liveFields=['figures','results'];add(data.recordId);break;
 case '/api/research/records/preparation/save':liveOnly=true;liveFields=['attempt'];add(data.recordId);break;
 case '/api/research/records/media':add(data.recordId);break;
 case '/api/research/records/history/restore':add(data.recordId);break;
 case '/api/research/records/location':add(data.recordId,data.notebookId);if(researchId(data.recordId)&&researchId(data.sourceNotebookId))previousLocations.push([data.recordId,data.sourceNotebookId]);break;
 case '/api/workspace/save':case '/api/research/records/save':
  for(const change of data.changes??[])add(change?.id,change?.record?.notebookId);
  for(const change of data.removed??[]){add(change?.id);removed.add(change?.id);}break;
 case '/api/notebook/save':for(const record of data.book?.entries??[])add(record.id,record.notebookId);for(const book of data.book?.notebooks??[])if(researchId(book.id))books.add(book.id);break;
 case '/api/workspace/notebook':if(researchId(data.change?.id))books.add(data.change.id);break;
 case '/api/workspace/structure':{
  const {kind,value}=data.change??{};
  if(kind==='delete-notebook'&&value?.records==='move'&&researchId(value.id)&&researchId(value.destinationId))return {records,books:new Set([value.id]),rehome:value.destinationId};
  if(kind==='delete-notebook'&&researchId(value?.id)){books.add(value.id);removedBooks.add(value.id);liveOnly=true;}
  if(kind==='notebook'&&researchId(value?.id))books.add(value.id);break;
 }
 default:return null;
 }
 return records.size||books.size?{records,books,previousLocations,liveOnly,liveFields,selectedId,removed,removedBooks}:null;
}

async function visibleParts(document,field,target){
 const keys=[];for await(const item of document.items([field])){
  const flag=(await document.tree.selected(item.value,[consentKey(target)])).value;
  if(collectionAllowed(flag,target,field))keys.push((await document.tree.selected(item.value,['id'])).value);
 }return keys.sort();
}
async function status(metadata,row,document,target,options={}){
 const {tagsOnly=false,trackLive=false,liveOnly=false}=options;
 const record={id:row.id,notebookId:row.notebookId??(await document.field(['notebookId'])).value,[consentKey(target)]:(await document.field([consentKey(target)])).value};
 const provenance=identity(metadata,row.id,record.notebookId,target);if(!provenance)throw new AppError('CATALOGUE_DAMAGED');
 const visible=sourceRecordAllowed(record,metadata,target);let permissions=null,tagsRevision=null,liveSignature=null;
 if(visible&&tagsOnly){
  if((await document.field(['publication',target,'tags'])).value!==false)tagsRevision=await document.reference(['tags']);
  permissions={tags:!!tagsRevision};
 }else if(visible){
  const publication=(await document.field(['publication'])).value;
  if(!liveOnly&&publicationPartAllowed({publication},'tags',target))tagsRevision=await document.reference(['tags']);
  if(trackLive&&target==='website')liveSignature=await feedContentStamp(document,publication,options);
  permissions={parts:PUBLICATION_PARTS.filter(key=>publicationPartAllowed({publication},key,target))};
  if(!liveOnly){permissions.sections=await visibleParts(document,'sections',target);permissions.attachments=await visibleParts(document,'attachments',target);}
  if(permissions.parts.includes('figures')&&publication?.[target]?.hiddenFigures?.length)permissions.hiddenFigures=[...publication[target].hiddenFigures].sort();
 }
 return {provenance,sourceId:websiteSourceId(provenance),visible,signature:digest(serialize(permissions)),revision:row.revision,tagsRevision,liveSignature};
}

async function states(storage,targets,workspaceId,selectedChannels=channels){
 return storage.catalogue(async store=>{
  const snapshotId=await store.head(),snapshot=await store.snapshot(snapshotId),metadata=snapshot.metadata;if(workspaceId&&metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  const rows=new Map(),result=new Map();
  for(const notebookId of targets.books){
   if(!snapshot.indexVersion)throw new AppError('STORAGE_UPGRADE_REQUIRED');
   const index=new SnapshotIndex(store);if(await index.scopedCount(snapshot.membership)!==snapshot.count)throw new AppError('STORAGE_UPGRADE_REQUIRED');
   for await(const row of index.members(snapshot.membership,{notebookId}))rows.set(row.id,row);
  }
  for(const [id] of targets.records)if(!rows.has(id)){const row=await store.member(snapshot,id);if(row)rows.set(id,row);}
  for(const row of rows.values())await withRecordDocument(store,row.id,row.revision,async doc=>{for(const target of selectedChannels){const value=await status(metadata,row,doc,target,targets);result.set(value.sourceId,{...value,snapshotId});}});
  // A new entry or a move may introduce a second identity that also needs a
  // write fence before the research transaction can commit.
  for(const locations of [targets.records,targets.previousLocations??[]])for(const [id,notebookId] of locations)if(notebookId)for(const target of selectedChannels){const provenance=identity(metadata,id,notebookId,target);if(!provenance)continue;const sourceId=websiteSourceId(provenance);if(!result.has(sourceId))result.set(sourceId,{sourceId,provenance,visible:false,signature:null,revision:null});}
  return result;
 });
}

async function permittedOriginal(doc,target){
 const record={},publication=(await doc.field(['publication'])).value;
 for(const key of await doc.tree.propertyNames(doc.root)){
  if(key==='publication'){record.publication=publication;continue;}
  if(key==='sections'||key==='attachments'){
   const values=[];for await(const item of doc.items([key])){const flag=(await doc.tree.selected(item.value,[consentKey(target)])).value;if(collectionAllowed(flag,target,key))values.push(await doc.tree.read(item.value));}record[key]=values;
  }else if(domainFields.has(key)&&!publicationPartAllowed({publication},key,target)){
   if(['contributors','tags','figures','relations'].includes(key))record[key]=[];else if(['body','outcome'].includes(key))record[key]='';
  }else if(key==='figures'&&publication?.[target]?.hiddenFigures?.length){
   const hidden=new Set(publication[target].hiddenFigures),figures=[];
   for await(const item of doc.items(['figures']))if(!hidden.has((await doc.tree.selected(item.value,['id'])).value))figures.push(await doc.tree.read(item.value));
   record.figures=figures;
  }else record[key]=(await doc.field([key])).value;
 }
 return record;
}

export class PublicationConversion{
 constructor(workspace,{store=new WebsiteFileStore(workspace)}={}){this.files=store;}
 deletionHooks(){return feedOwnerDeletionHooks(this.files);}
 // A physically relocated book is frozen until its journals admit the new
 // owner. Retire affected files before committing that owner's metadata. A
 // retry derives the same identities even after an interrupted withdrawal.
 async withdrawReparentedEntry(workspaceId,notebookId,recordId,projectIds,pending,possible){
  for(const projectId of projectIds)for(const target of channels){
   const provenance={workspaceId,notebookId,recordId,projectId,target},sourceId=websiteSourceId(provenance);
   if(!pending.has(sourceId)&&!possible(sourceId))continue;
   const prior=await this.files.sourceStatus(sourceId);
   if(!prior.source?.visible&&!prior.pending&&!pending.has(sourceId))continue;
   const token=await this.files.beginSourceUpdate({sourceId,target,provenance});
   await this.capture(null,{sourceId,provenance,visible:false,revision:null},token);
  }
 }
 async fenceRecordMove(storage,{workspaceId,notebookId,recordId},signal){
  const provenances=await storage.catalogue(async store=>{
   const snapshot=await store.snapshot();if(snapshot.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   return channels.map(target=>identity(snapshot.metadata,recordId,notebookId,target));
  });
  if(provenances.some(value=>!value))throw new AppError('CATALOGUE_DAMAGED');
  const pending=new Map();
  for(const provenance of provenances){
   const sourceId=websiteSourceId(provenance),token=await this.files.beginSourceUpdate({sourceId,target:provenance.target,provenance,signal});
   pending.set(sourceId,{token,provenance,sourceId,visible:false,revision:null});
  }
  return pending;
 }
 async settleRecordMove(storage,pending,{incoming=false,signal}={}){
  const first=pending.values().next().value.provenance;
  const current=incoming?await states(storage,{records:new Map([[first.recordId,first.notebookId]]),books:new Set()},first.workspaceId):null;
  for(const [id,state] of pending){signal?.throwIfAborted();await this.capture(storage,current?.get(id)??state,state.token);}
 }
 async composition(storage,state){
  const {sourceId,provenance}=state,target=provenance.target;
  const {metadata,record}=await storage.catalogue(async store=>{
   const snapshot=await store.snapshot(),row=await store.member(snapshot,provenance.recordId);if(!row||row.revision!==state.revision)throw new AppError('RECORD_CHANGED');
   return withRecordDocument(store,row.id,row.revision,async doc=>({metadata:snapshot.metadata,record:await permittedOriginal(doc,target)}));
  });
  const output=await convertPublicationRecord(storage,metadata,record,{target});if(!output.visible)throw new AppError('RECORD_CHANGED');
  return {sourceId,target,provenance:{...provenance,revision:state.revision,recordRevision:state.revision,snapshotId:state.snapshotId??null,...(target==='website'?{feedCompositionVersion:1}:{})},pickerContext:target==='website'?libraryContext(metadata,provenance):undefined,title:record.title,...output};
 }
 async capture(storage,state,token){
  const {sourceId,provenance}=state,target=provenance.target;
  if(!state.visible)return this.files.putSource({sourceId,target,provenance:{...provenance,revision:state.revision,recordRevision:state.revision,snapshotId:state.snapshotId??null},title:'Private entry',visible:false},{token});
  return this.files.putSource(await this.composition(storage,state),{token});
 }
 async captureLive(storage,state,token){
  return this.commitLive(state.sourceId,await this.composition(storage,state),token);
 }
 async commitLive(sourceId,output,token,signal){
  return this.files.scope(async()=>{
   const {source:base,pending}=await this.files.sourceStatus(sourceId);
   if(pending?.token!==token||!base?.visible||!pending.previous?.visible||pending.previous.revision!==base.revision)throw new AppError('CONFLICT');
   const {live,retired,retained}=output?await writeLiveFeedSource(this.files,base,{...output,context:output.pickerContext,signal}):await removeLiveFeedSource(this.files,base,{signal});
   const {refreshFeedSubscriptions}=await import('./website-dynamic-feeds.js');
   await refreshFeedSubscriptions(this.files,live,{signal});
   await releasePreviousFeedSource(this.files,retired,retained,signal);
   await this.files.finishSourceUpdate(sourceId,'website',signal);
  },{write:true,signal});
 }
 async captureTags(storage,state,token,{refreshLive=false}={}){
  const {provenance,sourceId,revision}=state,target=provenance.target;
  const {tags,metadata}=await storage.catalogue(async store=>{
   const snapshot=await store.snapshot(),row=await store.member(snapshot,provenance.recordId);
   if(!row||row.revision!==revision)throw new AppError('RECORD_CHANGED');
   return withRecordDocument(store,row.id,revision,async document=>{
    const admission=await status(snapshot.metadata,row,document,target,{tagsOnly:true});
    if(!admission.visible||admission.sourceId!==sourceId||!admission.tagsRevision||admission.tagsRevision!==state.tagsRevision)throw new AppError('RECORD_CHANGED');
    return {tags:(await document.field(['tags'])).value,metadata:snapshot.metadata};
   });
  });
  const liveOutput=refreshLive&&target==='website'?await this.composition(storage,state):undefined;
  return this.files.updateSourceTags(sourceId,{token,tags,liveOutput,provenance:{...provenance,revision,recordRevision:revision,snapshotId:state.snapshotId},pickerContext:target==='website'?libraryContext(metadata,provenance):undefined});
 }
 async reconcileFeed(store,row,metadata,snapshotId,storage,source,context,signal,{repairPermissions=false}={}){
  const sourceId=source.id;
  const observed=await this.files.scope(async()=>{
   const {pending}=await this.files.sourceStatus(sourceId);if(pending&&!pending.feedBackfill)throw new AppError('CONFLICT');
   const live=await readFeedSource(this.files,sourceId,null,{signal,pending:!!pending,includeWithdrawn:true});
   return {live,pending};
  },{signal});
  repairPermissions||=Boolean(observed.pending&&!observed.pending.liveOnly);
  if(!repairPermissions&&!observed.pending&&observed.live.visible&&observed.live.provenance.feedCompositionVersion===1&&observed.live.provenance.recordRevision===row.revision)return source;
  const captured=observed.live.provenance?.recordRevision;
  if(captured&&captured!==row.revision){
   const index=store.historyIndex(row.id),head=await index.head(),old=await index.lookup(head,'version',captured,{optional:true}),now=await index.lookup(head,'version',row.revision);
   if(!old||old.ordinal>now.ordinal)throw new AppError('RECORD_CHANGED');
  }
  const token=await this.files.scope(async()=>{
   const {source:base,pending}=await this.files.sourceStatus(sourceId);if(!base?.visible||base.revision!==source.revision||pending?.token!==observed.pending?.token)throw new AppError('CONFLICT');
   await readFeedSource(this.files,sourceId,observed.live.revision,{signal,pending:!!pending,includeWithdrawn:true});
   return this.files.beginSourceUpdate({sourceId,target:'website',provenance:source.provenance,liveOnly:!repairPermissions,feedBackfill:true,signal});
  },{write:true,signal});
  const record=await withRecordDocument(store,row.id,row.revision,doc=>permittedOriginal(doc,'website'));
  const output=await convertPublicationRecord(storage,metadata,record,{signal,target:'website'});if(!output.visible)throw new AppError('PUBLICATION_PERMISSIONS_CHANGED');
  const composition={title:record.title,provenance:{...source.provenance,revision:row.revision,recordRevision:row.revision,snapshotId,feedCompositionVersion:1},pickerContext:context,...output};
  if(repairPermissions){
   await this.files.putSource({sourceId,target:'website',...composition,signal},{token});
   return this.files.scope(()=>this.files.source(sourceId),{signal});
  }
  await this.commitLive(sourceId,composition,token,signal);return source;
 }
 async historicalDisposition(catalogue,snapshot,pointer){
  const row=await catalogue.member(snapshot,pointer.recordId);if(!row)return 'removed';
  const book=snapshot.metadata.notebooks.find(book=>book.id===pointer.notebookId);
  if(!book||book.projectId!==pointer.projectId||book.share===false)return 'withdrawn';
  return withRecordDocument(catalogue,row.id,row.revision,async document=>{
   const record={notebookId:row.notebookId??(await document.field(['notebookId'])).value,share:(await document.field(['share'])).value};
   return record.notebookId!==pointer.notebookId||!sourceRecordAllowed(record,snapshot.metadata)?'withdrawn':null;
  });
 }
 async withdrawHistoricalMembership(reader,namespace,pointer,signal){
  const {sourceId}=pointer;
  const reserved=await this.files.scope(async()=>{
   const {source,pending}=await this.files.sourceStatus(sourceId);
   if(!source?.visible)return null;
   if(pending&&!pending.feedBackfill)throw new AppError('CONFLICT');
   if(source.provenance.workspaceId!==namespace||source.provenance.recordId!==pointer.recordId||source.provenance.projectId!==pointer.projectId||source.provenance.notebookId!==pointer.notebookId)throw new AppError('CONFLICT');
   const token=await this.files.beginSourceUpdate({sourceId,target:'website',provenance:source.provenance,feedBackfill:true,signal});
   return {sourceId,provenance:source.provenance,token,pending};
  },{write:true,signal});
  if(!reserved)return;
  const {value:state}=await reader.use(namespace,undefined,async(catalogue,snapshot,context)=>({disposition:await this.historicalDisposition(catalogue,snapshot,pointer),snapshotId:context.snapshotId}));
  if(state.disposition==='removed')await this.commitLive(sourceId,null,reserved.token,signal);
  else if(state.disposition==='withdrawn')await this.capture(null,{sourceId,provenance:reserved.provenance,visible:false,revision:null,snapshotId:state.snapshotId},reserved.token);
  else{if(!reserved.pending)await this.files.cancelSourceUpdate({sourceId,token:reserved.token,signal});throw new AppError('RECORD_CHANGED');}
 }
 async seedWebsites(provenances,withOwner,{signal,onSource,refreshHistoricalLive=false}={}){
  const pending=new Map(),sources=new Map(),existing=[];
  try{
   // Fence before taking the research snapshot. One owner can contain many
   // selected entries; its grant and snapshot cover them all.
   await this.files.scope(async()=>{
    const fenced=await this.files.pendingSources();
    for(const provenance of provenances){
     signal?.throwIfAborted();const sourceId=websiteSourceId(provenance),{source,pending:journal}=await this.files.sourceStatus(sourceId);
     if(source&&(!journal||refreshHistoricalLive&&journal.feedBackfill&&source.visible)){
      if(fenced.has(sourceId)&&!journal?.feedBackfill)throw new AppError('CONFLICT');
      if(source.target!=='website')throw new AppError('PUBLICATION_PERMISSIONS_CHANGED');
      if(source.visible)existing.push({source,provenance});
      else{
       // A tombstone is an authenticated prior withdrawal. Only a fresh
       // permission check under the owner below can create its replacement.
       const token=await this.files.beginSourceUpdate({sourceId,target:'website',provenance,ifAbsent:true,resumeSeed:true,reviveRevision:source.revision,signal});
       pending.set(sourceId,{token,provenance});
      }
     }else{
      const reviveRevision=journal?.seed&&journal.previous?.visible===false?journal.previous.revision:undefined;
      const token=await this.files.beginSourceUpdate({sourceId,target:'website',provenance,ifAbsent:true,resumeSeed:true,reviveRevision,signal});
      pending.set(sourceId,{token,provenance});
     }
    }
   },{write:true,signal});
   if(existing.length||pending.size)await withOwner(async(store,snapshot,{storage,snapshotId})=>{
    if(existing.length){
     const rows=[],metadata=snapshot.metadata;
     for(const entry of existing){
      let {source}=entry;const {provenance}=entry;let repairPermissions=false;
      signal?.throwIfAborted();const context=libraryContext(metadata,provenance),row=await store.member(snapshot,provenance.recordId);
      const captured=source.provenance?.recordRevision??source.provenance?.revision;
      if(!row||!captured||websiteSourceId(source.provenance)!==source.id)throw new AppError('PUBLICATION_PERMISSIONS_CHANGED');
      const current=await withRecordDocument(store,row.id,row.revision,async doc=>{
       const notebookId=row.notebookId??(await doc.field(['notebookId'])).value;
       if(notebookId!==provenance.notebookId||(await doc.field(['share'])).value!==true)throw new AppError('PUBLICATION_PERMISSIONS_CHANGED');
       return row.revision!==captured?status(metadata,row,doc,'website'):null;
      });
      if(current){
       // Ordinary edits do not replace an independently authored website
       // copy. A different grant can never endorse its old section selection.
       const prior=await withRecordDocument(store,row.id,captured,doc=>status(metadata,{id:row.id,revision:captured},doc,'website'));
       if(!prior.visible||prior.sourceId!==current.sourceId)throw new AppError('PUBLICATION_PERMISSIONS_CHANGED');
       if(prior.signature!==current.signature){if(!refreshHistoricalLive)throw new AppError('PUBLICATION_PERMISSIONS_CHANGED');repairPermissions=true;}
      }
      if(refreshHistoricalLive)source=await this.reconcileFeed(store,row,metadata,snapshotId,storage,source,context,signal,{repairPermissions});
      rows.push({source,context});
     }
     await this.files.scope(async()=>{
      const fenced=await this.files.pendingSources();
      for(const {source} of rows){
       const current=await this.files.source(source.id,{pending:true});
       if(fenced.has(source.id)||!current?.visible||current.revision!==source.revision||current.target!=='website')throw new AppError('PUBLICATION_PERMISSIONS_CHANGED');
      }
      await enrichWebsiteSources(this.files,rows,signal);
     },{write:true,signal});
     for(const {source} of rows){
      sources.set(source.provenance.recordId,{id:source.id,revision:source.revision,assets:source.assets.map(file=>({path:file.name,sha256:file.sha256}))});
      await onSource?.();
     }
    }
    for(const [sourceId,{token,provenance}] of pending){
     signal?.throwIfAborted();
     const row=await store.member(snapshot,provenance.recordId),metadata=snapshot.metadata;
     if(!row||metadata.id!==provenance.workspaceId)throw new AppError('PUBLICATION_PERMISSIONS_CHANGED');
     const record=await withRecordDocument(store,row.id,row.revision,async doc=>{
      const book=row.notebookId??(await doc.field(['notebookId'])).value;
      if(book!==provenance.notebookId||!metadata.notebooks.some(item=>item.id===book&&item.projectId===provenance.projectId)||
       !sourceRecordAllowed({id:row.id,notebookId:book,share:(await doc.field(['share'])).value},metadata,'website'))throw new AppError('PUBLICATION_PERMISSIONS_CHANGED');
      return permittedOriginal(doc,'website');
     });
     const output=await convertPublicationRecord(storage,metadata,record,{target:'website',signal});
     if(!output.visible)throw new AppError('PUBLICATION_PERMISSIONS_CHANGED');
     const saved=await this.files.putSource({sourceId,target:'website',title:record.title,provenance:{...provenance,revision:row.revision,recordRevision:row.revision,snapshotId,feedCompositionVersion:1},pickerContext:libraryContext(metadata,provenance),...output,signal},{token});
     pending.delete(sourceId);sources.set(provenance.recordId,{id:saved.id,revision:saved.revision,assets:output.assets.map(asset=>({path:asset.path,sha256:asset.path.slice(7,71)}))});
     await onSource?.();
    }
   });
   return sources;
  }catch(error){
   // Tokens are checked against the current fence. A concurrent permission
   // withdrawal cannot be cancelled by an interrupted initial materialization.
   for(const [sourceId,{token}] of pending)await this.files.cancelSourceUpdate({sourceId,token}).catch(()=>{});
   throw error;
  }
 }
 async mutate(storage,{route,data},operation){
  const targets=commandTargets(route,data);if(!targets)return operation();
  return this.withProducer(storage,()=>this.mutateTargets(storage,{route,data},targets,operation));
 }
 withProducer(storage,operation){
  const id=storage.vault?.id;if(!researchId(id))throw new AppError('ACCESS_LOCKED');
  // The research DB commit and the subsequent saved-file publication share
  // this owner lease. A second editor cannot supersede the first token
  // between those two commits. Other research owners remain independent.
  return runWebsiteUpgrade(this.files,'publication-writer-'+id,operation,{shareResult:false});
 }
 async mutateTargets(storage,{route,data},targets,operation){
  targets.tagsOnly=route==='/api/research/records/tags';
  const basis=targets.books.size&&['/api/workspace/notebook','/api/workspace/structure'].includes(route)?data.etag:null;
  if(targets.rehome)await storage.catalogue(async store=>{
   if(!revisionId(basis))throw new AppError('INVALID');
   const original=await store.snapshot(basis),index=new SnapshotIndex(store);
   for(const notebookId of targets.books)for await(const row of index.members(original.membership,{notebookId}))targets.records.set(row.id,targets.rehome);
  });
  return this.change(storage,targets,data.workspaceId,operation,basis);
 }
 async mutateNotebook(storage,notebookId,operation){if(!researchId(notebookId))throw new AppError('INVALID');return this.withProducer(storage,()=>this.change(storage,{records:new Map(),books:new Set([notebookId])},null,operation));}
 async change(storage,targets,workspaceId,operation,basis){
  targets={...targets,trackLive:!targets.tagsOnly};
  const selectedChannels=targets.liveOnly?['website']:channels;
  const deleting=state=>targets.removed?.has(state.provenance.recordId)||targets.removedBooks?.has(state.provenance.notebookId);
  const affected=state=>deleting(state)?state.visible&&state.provenance.target==='website':targets.liveOnly?state.visible&&state.liveSignature:targets.tagsOnly?state.tagsRevision:true;
  const before=await states(storage,targets,workspaceId,selectedChannels),pending=new Map();
  if(targets.removed?.size||targets.removedBooks?.size)await this.files.scope(async()=>{
   for(const id of await this.files.pendingSources()){
    if(before.has(id))continue;
    const {pending:journal}=await this.files.sourceStatus(id),prior=journal?.previous;
    if(journal?.feedRemoval&&prior?.visible&&prior.target==='website'&&(!workspaceId||prior.provenance.workspaceId===workspaceId)&&deleting(prior))before.set(id,{sourceId:id,provenance:prior.provenance,visible:true,signature:null,revision:prior.provenance.recordRevision});
   }
  });
  // A previous attempt may have committed the new project and stopped before
  // clearing the old HTML/PDF fence. Its authenticated snapshot identifies the
  // old addresses even though today's notebook has already changed owners.
  if(revisionId(basis)){
   const fenced=await this.files.scope(()=>this.files.pendingSources());
   if(fenced.size)await storage.catalogue(async store=>{
    if(await store.head()===basis)return;
    const original=await store.snapshot(basis),index=new SnapshotIndex(store);
    if(workspaceId&&original.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
    for(const notebookId of targets.books)for await(const row of index.members(original.membership,{notebookId})){
     for(const target of channels){
      const provenance=identity(original.metadata,row.id,notebookId,target);if(!provenance)throw new AppError('CATALOGUE_DAMAGED');
      const sourceId=websiteSourceId(provenance);if(fenced.has(sourceId)&&!before.has(sourceId))before.set(sourceId,{sourceId,provenance,visible:false,signature:null,revision:null});
     }
    }
   });
  }
  // After this point every affected site fails closed until its new website
  // files are committed. A lost response can be retried on the same source.
  try{for(const [id,state] of before){
   if(!affected(state))continue;
   const prior=await this.files.sourceStatus(id),removal=deleting(state);
   if(removal&&prior.pending&&!prior.pending.feedRemoval)throw new AppError('CONFLICT');
   const token=await this.files.beginSourceUpdate({sourceId:id,target:state.provenance.target,provenance:state.provenance,tagsOnly:targets.tagsOnly,liveOnly:targets.liveOnly||removal,feedRemoval:removal,policySignature:state.signature,tagsRevision:state.tagsRevision});
   pending.set(id,{prior,token,state});
  }}
  catch(error){await Promise.allSettled([...pending].filter(([,item])=>!item.prior.pending).map(([sourceId,{token}])=>this.files.cancelSourceUpdate({sourceId,token})));throw error;}
  let result,error;try{result=await operation();}catch(failure){error=failure;}
  const after=await states(storage,targets,workspaceId,selectedChannels);
  for(const [id,value] of after)if(!pending.has(id)&&value.visible&&affected(value))throw new AppError('CONFLICT');
  for(const [id,{prior,token,state}] of pending){
   const next=after.get(id)??{...state,visible:false,signature:null,revision:null};
   const samePermissions=next.visible===state.visible&&next.signature===state.signature;
   const liveChanged=next.provenance.target==='website'&&!targets.tagsOnly&&next.liveSignature!==state.liveSignature;
   const tagsChanged=next.tagsRevision!==state.tagsRevision;
   const recover=prior.pending&&(prior.pending.liveOnly||prior.pending.policySignature===next.signature);
   const removed=!after.has(id)&&(targets.removed?.has(state.provenance.recordId)||targets.removedBooks?.has(state.provenance.notebookId));
   if(removed&&prior.source?.visible&&state.provenance.target==='website')await this.commitLive(id,null,token);
   else if(removed&&state.provenance.target==='pdf'&&!prior.pending)await this.files.cancelSourceUpdate({sourceId:id,token});
   else if(!prior.pending&&samePermissions&&!tagsChanged&&!liveChanged&&(error||prior.source||!next.visible))await this.files.cancelSourceUpdate({sourceId:id,token});
   else if(prior.source?.visible&&next.visible&&samePermissions&&(!prior.pending||recover||targets.tagsOnly&&prior.pending.tagsOnly)){
    const retryTags=prior.pending?.tagsOnly||prior.pending?.policySignature===next.signature&&prior.pending.tagsRevision!==next.tagsRevision;
    if(next.tagsRevision&&(tagsChanged||retryTags))await this.captureTags(storage,next,token,{refreshLive:liveChanged||!!recover&&!targets.tagsOnly});
    else if(next.provenance.target==='website')await this.captureLive(storage,next,token);
    else await this.capture(storage,next,token);
   }else if(!next.visible&&!prior.source&&!prior.pending)await this.files.cancelSourceUpdate({sourceId:id,token});
   else await this.capture(storage,next,token);
  }
  if(error)throw error;return result;
 }
}
