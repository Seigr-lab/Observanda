import {configurationOwner,configurationCheckpoint,discardConfigurationCheckpoint} from './configuration-commands.js';
// Existing structure forms use one command adapter. Metadata-only changes never
// assemble the record corpus; moves visit the selected lab book's branch only.
import {AppError} from './errors.js';
import {reconcileWebsiteMembership} from './website-membership.js';
import {commitStructureDocuments} from './record-structure-documents.js';
import {saveStructure,editNotebook,reorganizeWorkspace,transformStructure} from './structure.js';
import {SnapshotIndex} from './snapshot-index.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {digest,serialize} from './storage-format.js';
import {hasSnapshotOwnership,completeSnapshotOwnership} from './snapshot-ownership.js';
import {legacyStructurePreview} from './structure-preview.js';

const actions={structure:saveStructure,notebook:editNotebook,reorganize:reorganizeWorkspace};
const extras=result=>({...(result.projectId?{projectId:result.projectId}:{}),moved:result.moved??false});

// Public complete-document saves may edit retained identities, but owner
// creation is handled by the dedicated project and lab-book workflows.
// The subsequent save repeats the etag check before writing, so a concurrent
// hierarchy change cannot turn this read admission into stale authority.
export async function assertExistingNativeStructure(workspace,book,etag){
 if(await workspace.storageKind()!=='catalogue')return;
 const current=await workspace.outline();if(current.metadata.formatVersion!==21)return;
 if(current.etag!==etag)throw new AppError('CONFLICT');
 if(book?.id!==current.metadata.id)throw new AppError('WORKSPACE_CHANGED');
 for(const key of ['projects','notebooks']){
  const known=new Set(current.metadata[key].map(value=>value.id));
  if(!Array.isArray(book[key])||book[key].some(value=>!known.has(value?.id)))throw new AppError('INVALID');
 }
}

export class StructureCommands{
 constructor(workspace){this.workspace=workspace;}
 async execute(kind,data,{preview=false,signal,onProgress=()=>{}}={}){
  signal?.throwIfAborted();
  if(!Object.hasOwn(actions,kind)||!data||typeof data.etag!=='string'||!data.change||preview&&kind!=='reorganize')throw new AppError('INVALID');
  if(data.response!==undefined&&data.response!=='outline')throw new AppError('INVALID');
  if(data.commandId!==undefined&&(!researchId(data.commandId)||data.response!=='outline'||preview))throw new AppError('INVALID');
  if(kind==='reorganize'&&!preview&&data.reviewed!==true)throw new AppError('INVALID');
  const outline=await this.workspace.outline();
  if(outline.etag!==data.etag&&!data.commandId)throw new AppError('CONFLICT');
  if(await this.workspace.storageKind()==='catalogue'&&outline.metadata.formatVersion===21){
   const run=()=>this.workspace.catalogue(async store=>{const result=await this.indexed(store,kind,data,outline.metadata.id,preview,{signal,onProgress});signal?.throwIfAborted();return result;});
   return preview?run():this.workspace.withLock(run);
  }
  // Older document formats still use their existing upgrade and full validation.
  if(preview){
   const current=await this.workspace.read();if(current.etag!==data.etag)throw new AppError('CONFLICT');
   return {summary:actions[kind](current.book,data.change).summary,etag:current.etag};
  }
  let result;
  const saved=await this.workspace.update(async book=>{
   if((await this.workspace.read()).etag!==data.etag)throw new AppError('CONFLICT');
   result=actions[kind](book,data.change);return result.book;
  });
  return {...saved,...extras(result)};
 }
 async indexed(store,kind,data,workspaceId,preview,{signal,onProgress}={}){
  const receiptFile=data.commandId?'.observanda/structure-commands/'+data.commandId+'.json':null;
  const fingerprint=digest(serialize({workspaceId,kind,data}));
  if(receiptFile){
   const raw=await this.workspace.readMetadata(receiptFile,8192);
   if(raw!==null){
    let receipt;try{receipt=JSON.parse(raw);}catch{throw new AppError('CATALOGUE_DAMAGED');}
    if(!receipt||Object.keys(receipt).sort().join()!=='etag,extras,fingerprint,version,workspaceId'||receipt.version!==1||!researchId(receipt.workspaceId)||!revisionId(receipt.fingerprint)||!revisionId(receipt.etag)||
     !receipt.extras||typeof receipt.extras.moved!=='boolean'||Object.keys(receipt.extras).some(key=>!['moved','projectId'].includes(key))||receipt.extras.projectId!==undefined&&!researchId(receipt.extras.projectId))throw new AppError('CATALOGUE_DAMAGED');
    if(receipt.workspaceId!==workspaceId||receipt.fingerprint!==fingerprint)throw new AppError('CONFLICT');
    return {...await store.recordOutline({snapshotId:receipt.etag,signal}),...receipt.extras};
   }
  }
  const etag=await store.head();if(etag!==data.etag)throw new AppError('CONFLICT');
  const source=await store.snapshot(etag);
  if(source.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  // New identities belong to dedicated owners. This adapter edits retained
  // inline identities only; it must not recreate the old aggregate hierarchy.
  const collection=kind==='structure'&&['project','notebook'].includes(data.change?.kind)?data.change.kind==='project'?'projects':'notebooks':null;
  if((collection&&!source.metadata[collection].some(value=>value.id===data.change.value?.id))||(kind==='reorganize'&&data.change.projectId==='new'))throw new AppError('INVALID');
  const complete=await hasSnapshotOwnership(store,source);
  if(preview&&!complete)return legacyStructurePreview(store,source,data.change,etag,{signal});
  if(!complete)onProgress?.({stage:'indexing'});
  const current=complete?source:await completeSnapshotOwnership(store,source,{signal}),index=new SnapshotIndex(store,{cacheSize:4096,cacheMembers:true}),change=structuredClone(data.change);
  let configuration=null;
  if(data.configurationDraft!==undefined||data.configurationPin!==undefined){
   const owner=configurationOwner(data.configurationPin);if(kind!=='structure'||!['project','notebook'].includes(change.kind)||change.kind==='notebook'&&(owner.slot!=='configuration'||owner.notebookId!==change.value?.id||owner.projectId!==change.value?.projectId)||change.kind==='project'&&(owner.slot!=='labBookTemplate'||owner.projectId!==change.value?.id))throw new AppError('INVALID');
   configuration={owner,...await configurationCheckpoint(store,owner,data.configurationDraft,data.configurationPin,{signal,validate:false})};
   if(configuration.absent)delete change.value[owner.slot];else if(change.kind==='notebook')change.value.configuration=configuration.configuration;else change.value.labBookTemplate={name:configuration.name,configuration:configuration.configuration};
  }
  const edit=kind==='notebook'?change:kind==='structure'&&change.kind==='notebook'?change.value:null;
  const deletion=kind==='structure'&&change.kind==='delete-notebook'?change.value:null;
  const notebook=source.metadata.notebooks.find(n=>n.id===(edit?.id??deletion?.id));
  const selected=[];
  if(notebook&&(deletion||edit.projectId!==notebook.projectId)){
   for await(const row of index.members(current.membership,{notebookId:notebook.id})){signal?.throwIfAborted();selected.push({id:row.id,revision:row.revision,notebookId:row.notebookId});}
  }
  // The structure transformation needs identities, ownership and the privacy
  // transition only. It must not own every selected record's prose or figures.
  const entries=selected.map(row=>({id:row.id,notebookId:row.notebookId,share:true}));
  const result=transformStructure({...current.metadata,entries},kind,change);
  const metadata={...result.book,entries:[]},kept=new Set(result.book.entries.map(r=>r.id)),removed=selected.filter(row=>!kept.has(row.id)).map(row=>row.id);
  const removedIds=new Set(removed);
  const changed=new Map(result.book.entries.map(r=>[r.id,r]));
  await reconcileWebsiteMembership(metadata,id=>removedIds.has(id)?null:changed.get(id)??store.member(current,id));
  await store.validateMetadata(current,metadata,{removed,records:result.book.entries});
  if(kind==='reorganize'){
   const notebooks=new Set(metadata.notebooks.filter(n=>n.projectId===result.projectId).map(n=>n.id));let count=0;
   if(notebooks.size===current.metadata.notebooks.length)count=current.count;
   else for(const id of notebooks)count+=await index.scopedCount(current.membership,id);
   result.summary.records=count;
  }
  if(preview)return {summary:result.summary,etag};
  const targets=new Map(result.book.entries.map(r=>[r.id,r])),now=new Date().toISOString();
  await commitStructureDocuments(store,etag,current,metadata,selected,targets,{removed,now,membershipRebuilt:!complete,signal,onProgress});
  if(configuration?.draft)await discardConfigurationCheckpoint(store,configuration.owner,{id:configuration.draft.id,revision:configuration.revision});
  signal?.throwIfAborted();
  if(receiptFile)await this.workspace.writeMetadata(receiptFile,serialize({version:1,workspaceId,fingerprint,etag:await store.head(),extras:extras(result)}));
  return {...await (data.response==='outline'?store.recordOutline():store.recordPatch(etag)),...extras(result)};
 }
}
