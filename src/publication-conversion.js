import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {withRecordDocument} from './record-document.js';
import {SnapshotIndex} from './snapshot-index.js';
import {WebsiteFileStore,websiteSourceId} from './website-file-store.js';
import {sourceRecordAllowed} from './web/source-publication-permissions.js';
import {PUBLICATION_PARTS,publicationPartAllowed} from './web/record-publication-privacy.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {convertPublicationRecord} from './publication-conversion-render.js';
import {enrichWebsiteSources} from './website-file-library.js';

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
 const records=new Map(),books=new Set(),previousLocations=[];
 const add=(id,notebook=null)=>{if(researchId(id))records.set(id,notebook);};
 switch(route){
 case '/api/research/records/values/save': if(!['share','sharePdf','publication'].includes(data.field)&&!(typeof data.field==='string'&&data.field.startsWith('media:')))return null;add(data.recordId);break;
 case '/api/research/records/writing/save':if(!data.sectionId||!data.value||!['share','sharePdf'].some(key=>Object.hasOwn(data.value,key)))return null;add(data.recordId);break;
 case '/api/research/records/sections':if(data.action==='move')return null;add(data.recordId);break;
 case '/api/research/records/media':add(data.recordId);break;
 case '/api/research/records/history/restore':add(data.recordId);break;
 case '/api/research/records/location':add(data.recordId,data.notebookId);if(researchId(data.recordId)&&researchId(data.sourceNotebookId))previousLocations.push([data.recordId,data.sourceNotebookId]);break;
 case '/api/workspace/save':case '/api/research/records/save':for(const change of data.changes??[])add(change?.id,change?.record?.notebookId);break;
 case '/api/notebook/save':for(const record of data.book?.entries??[])add(record.id,record.notebookId);for(const book of data.book?.notebooks??[])if(researchId(book.id))books.add(book.id);break;
 case '/api/workspace/notebook':if(researchId(data.change?.id))books.add(data.change.id);break;
 case '/api/workspace/structure':{
  const {kind,value}=data.change??{};
  if(kind==='delete-notebook'&&value?.records==='move'&&researchId(value.id)&&researchId(value.destinationId))return {records,books:new Set([value.id]),rehome:value.destinationId};
  if(kind==='notebook'&&researchId(value?.id))books.add(value.id);break;
 }
 default:return null;
 }
 return records.size||books.size?{records,books,previousLocations}:null;
}

async function visibleParts(document,field,target){
 const keys=[];for await(const item of document.items([field])){
  const flag=(await document.tree.selected(item.value,[consentKey(target)])).value;
  if(collectionAllowed(flag,target,field))keys.push((await document.tree.selected(item.value,['id'])).value);
 }return keys.sort();
}
async function status(metadata,row,document,target){
 const record={id:row.id,notebookId:row.notebookId??(await document.field(['notebookId'])).value,[consentKey(target)]:(await document.field([consentKey(target)])).value};
 const provenance=identity(metadata,row.id,record.notebookId,target);if(!provenance)throw new AppError('CATALOGUE_DAMAGED');
 const visible=sourceRecordAllowed(record,metadata,target);let permissions=null;
 if(visible){const publication=(await document.field(['publication'])).value;permissions={parts:PUBLICATION_PARTS.filter(key=>publicationPartAllowed({publication},key,target)),sections:await visibleParts(document,'sections',target),attachments:await visibleParts(document,'attachments',target)};}
 return {provenance,sourceId:websiteSourceId(provenance),visible,signature:digest(serialize(permissions)),revision:row.revision};
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
  for(const row of rows.values())await withRecordDocument(store,row.id,row.revision,async doc=>{for(const target of selectedChannels){const value=await status(metadata,row,doc,target);result.set(value.sourceId,{...value,snapshotId});}});
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
  }else record[key]=(await doc.field([key])).value;
 }
 return record;
}

export class PublicationConversion{
 constructor(workspace,{store=new WebsiteFileStore(workspace)}={}){this.files=store;}
 // A physically relocated book is frozen until its journals admit the new
 // owner. Retire affected files before committing that owner's metadata. A
 // retry derives the same identities even after an interrupted withdrawal.
 async withdrawReparentedEntry(workspaceId,notebookId,recordId,projectIds,pending,possible){
  for(const projectId of projectIds)for(const target of channels){
   const provenance={workspaceId,notebookId,recordId,projectId,target},sourceId=websiteSourceId(provenance);
   if(!pending.has(sourceId)&&!possible(sourceId))continue;
   const prior=await this.files.sourceStatus(sourceId);
   if(!prior.source?.visible&&!prior.pending&&!pending.has(sourceId))continue;
   const token=await this.files.beginSourceUpdate({sourceId,target});
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
   const sourceId=websiteSourceId(provenance),token=await this.files.beginSourceUpdate({sourceId,target:provenance.target,signal});
   pending.set(sourceId,{token,provenance,sourceId,visible:false,revision:null});
  }
  return pending;
 }
 async settleRecordMove(storage,pending,{incoming=false,signal}={}){
  const first=pending.values().next().value.provenance;
  const current=incoming?await states(storage,{records:new Map([[first.recordId,first.notebookId]]),books:new Set()},first.workspaceId):null;
  for(const [id,state] of pending){signal?.throwIfAborted();await this.capture(storage,current?.get(id)??state,state.token);}
 }
 async capture(storage,state,token){
  const {sourceId,provenance}=state,target=provenance.target;
  if(!state.visible)return this.files.putSource({sourceId,target,provenance:{...provenance,revision:state.revision,recordRevision:state.revision,snapshotId:state.snapshotId??null},title:'Private entry',visible:false},{token});
  const {metadata,record}=await storage.catalogue(async store=>{
   const snapshot=await store.snapshot(),row=await store.member(snapshot,provenance.recordId);if(!row||row.revision!==state.revision)throw new AppError('RECORD_CHANGED');
   return withRecordDocument(store,row.id,row.revision,async doc=>({metadata:snapshot.metadata,record:await permittedOriginal(doc,target)}));
  });
  const output=await convertPublicationRecord(storage,metadata,record,{target});if(!output.visible)throw new AppError('RECORD_CHANGED');
  return this.files.putSource({sourceId,target,provenance:{...provenance,revision:state.revision,recordRevision:state.revision,snapshotId:state.snapshotId??null},pickerContext:target==='website'?libraryContext(metadata,provenance):undefined,title:record.title,...output},{token});
 }
 async seedWebsites(provenances,withOwner,{signal,onSource}={}){
  const pending=new Map(),sources=new Map(),existing=[];
  try{
   // Fence before taking the research snapshot. One owner can contain many
   // selected entries; its grant and snapshot cover them all.
   await this.files.scope(async()=>{
    const fenced=await this.files.pendingSources();
    for(const provenance of provenances){
     signal?.throwIfAborted();const sourceId=websiteSourceId(provenance),{source,pending:journal}=await this.files.sourceStatus(sourceId);
     if(source&&!journal){
      if(fenced.has(sourceId))throw new AppError('CONFLICT');
      if(source.target!=='website')throw new AppError('PUBLICATION_PERMISSIONS_CHANGED');
      if(source.visible)existing.push({source,provenance});
      else{
       // A tombstone is an authenticated prior withdrawal. Only a fresh
       // permission check under the owner below can create its replacement.
       const token=await this.files.beginSourceUpdate({sourceId,target:'website',ifAbsent:true,resumeSeed:true,reviveRevision:source.revision,signal});
       pending.set(sourceId,{token,provenance});
      }
     }else{
      const reviveRevision=journal?.seed&&journal.previous?.visible===false?journal.previous.revision:undefined;
      const token=await this.files.beginSourceUpdate({sourceId,target:'website',ifAbsent:true,resumeSeed:true,reviveRevision,signal});
      pending.set(sourceId,{token,provenance});
     }
    }
   },{write:true,signal});
   if(existing.length||pending.size)await withOwner(async(store,snapshot,{storage,snapshotId})=>{
    if(existing.length){
     const rows=[],metadata=snapshot.metadata;
     for(const {source,provenance} of existing){
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
       if(!prior.visible||prior.sourceId!==current.sourceId||prior.signature!==current.signature)throw new AppError('PUBLICATION_PERMISSIONS_CHANGED');
      }
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
     const saved=await this.files.putSource({sourceId,target:'website',title:record.title,provenance:{...provenance,revision:row.revision,recordRevision:row.revision,snapshotId},pickerContext:libraryContext(metadata,provenance),...output,signal},{token});
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
  const basis=targets.books.size&&['/api/workspace/notebook','/api/workspace/structure'].includes(route)?data.etag:null;
  if(targets.rehome)await storage.catalogue(async store=>{
   if(!revisionId(basis))throw new AppError('INVALID');
   const original=await store.snapshot(basis),index=new SnapshotIndex(store);
   for(const notebookId of targets.books)for await(const row of index.members(original.membership,{notebookId}))targets.records.set(row.id,targets.rehome);
  });
  return this.change(storage,targets,data.workspaceId,operation,basis);
 }
 async mutateNotebook(storage,notebookId,operation){if(!researchId(notebookId))throw new AppError('INVALID');return this.change(storage,{records:new Map(),books:new Set([notebookId])},null,operation);}
 async change(storage,targets,workspaceId,operation,basis){
  const before=await states(storage,targets,workspaceId),pending=new Map();
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
  try{for(const [id,state] of before){const prior=await this.files.sourceStatus(id);pending.set(id,{prior,token:await this.files.beginSourceUpdate({sourceId:id,target:state.provenance.target}),state});}}
  catch(error){await Promise.allSettled([...pending].filter(([,item])=>!item.prior.pending).map(([sourceId,{token}])=>this.files.cancelSourceUpdate({sourceId,token})));throw error;}
  let result,error;try{result=await operation();}catch(failure){error=failure;}
  const after=await states(storage,targets,workspaceId);
  for(const [id,value] of after)if(!pending.has(id)){if(value.visible)throw new AppError('CONFLICT');}
  for(const [id,{prior,token,state}] of pending){
   const next=after.get(id)??{...state,visible:false,signature:null,revision:null};
   if(!prior.pending&&next.visible===state.visible&&next.signature===state.signature&&(error||prior.source||!next.visible))await this.files.cancelSourceUpdate({sourceId:id,token});
   else if(!next.visible&&!prior.source&&!prior.pending)await this.files.cancelSourceUpdate({sourceId:id,token});
   else await this.capture(storage,next,token);
  }
  if(error)throw error;return result;
 }
}
