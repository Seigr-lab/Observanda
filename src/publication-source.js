import {AppError} from './errors.js';
import {upgradeNotebook} from './model.js';
import {publicationRecords} from './publication-records.js';
import {validateWorkspaceEditCommand,workspaceEditMetadata} from './workspace-edit-command.js';
import {emptyWebsiteSelection,websiteRecordShare} from './web/website-selection.js';
import {recordRevision} from './research.js';
import {publicationSelectionPage} from './publication-selection-page.js';
import {recordEditionInventory} from './web/publication-inventory.js';
// Sharing is an edition choice, not a new research revision. Keep the original
// privately bound to the selected derivative; callers cannot forge this link.
const originals=new WeakMap();
export const publicationOriginal=record=>originals.get(record)??record;

function consumeBook(book,consume,page,inventory){
 if(page?.cursor)throw new AppError('PUBLICATION_SELECTION_CURSOR');
 if(!consume)return book;
 const {entries,...metadata}=book,heads=new Map(entries.map(record=>[record.id,recordRevision(record)]));
 const notebooks=new Set(metadata.notebooks.filter(n=>metadata.projects.some(p=>p.id===n.projectId&&p.share)).map(n=>n.id));
 const selected=entries.filter(r=>r.share&&notebooks.has(r.notebookId)&&(!page?.recordId||r.id===page.recordId));
 const records=page?selected.slice(page.offset,page.offset+page.limit):selected;
 return consume(metadata,inventory?records.map(record=>({...recordEditionInventory(record,recordRevision(record)),notebook:metadata.notebooks.find(n=>n.id===record.notebookId)?.title??''})):records,{recordHead:id=>heads.get(id)??null});
}

// Resolve saved selection before retrieving originals. Rendering and privacy
// projection remain the publisher's responsibility; metadata is not public output.
export async function selectedPublicationBook(store,snapshot,{signal,metadata=snapshot.metadata,selection=emptyWebsiteSelection()}={}){
 const entries=[];for await(const record of selectedPublicationRecords(store,snapshot,{signal,metadata,selection}))entries.push(record);
 return {...metadata,entries};
}
async function* selectedPublicationRows(store,snapshot,{signal,metadata=snapshot.metadata,selection=emptyWebsiteSelection(),page,inventory=false}={}){
 const book=metadata,selected=new Map(selection.records.map(r=>[r.id,r])),overrides=new Map();
 if(selection.includeProjects.some(id=>!metadata.projects.some(p=>p.id===id)))throw new AppError('INVALID');
 const projects=new Set(book.projects.filter(p=>p.share).map(p=>p.id));
 const notebooks=new Set(book.notebooks.filter(n=>projects.has(n.projectId)).map(n=>n.id));
 const owners=new Map(metadata.notebooks.map(n=>[n.id,n.projectId]));
 // Validate explicit overrides independently of the displayed page. A late
 // stale attachment/record must still fail, but ordinary pages need not scan
 // the entire private corpus merely to prove that all overrides were found.
 async function* overrideRows(){
  for(const id of selected.keys()){
   signal?.throwIfAborted();const row=await store.member(snapshot,id);
   if(!row)throw new AppError('RECORD_CHANGED');overrides.set(id,{row,patch:selected.get(id)});yield row;
  }
 }
 for await(const summary of store.queryDocuments(overrideRows(),snapshot.metadata,{signal,search:false,publication:true})){
  if(selected.get(summary.id).attachments.some(a=>!summary.publication.attachments.some(item=>item.id===a.id)))throw new AppError('INVALID');
 }
 async function* rows(){
  if(page?.recordId){const row=await store.member(snapshot,page.recordId);if(row)yield row;return;}
  yield* publicationRecords(store,snapshot,{signal,metadata,selection,overrides,notebooks,after:page?.after??null});
 }
 let position=0;
 // Missing historical inventory labels are loaded by the selected page's
 // owner below. Asking the query layer to fill them here opens skipped prose.
 for await(const summary of store.queryDocuments(rows(),snapshot.metadata,{signal,search:false,publication:true,inventory,inventoryFallback:false})){
  signal?.throwIfAborted();
  const patch=selected.get(summary.id);
  if(!websiteRecordShare(selection,summary,owners.get(summary.notebookId))||!notebooks.has(summary.notebookId))continue;
  if(page?.recordId&&summary.id!==page.recordId)continue;
  const index=position++;if(page&&(index<page.offset||index>=page.offset+page.limit))continue;
  const row=await store.member(snapshot,summary.id);
  if(!row)throw new AppError('CATALOGUE_DAMAGED');
  yield {row,summary,patch};
  if(page&&position>=page.offset+page.limit)return;
 }
 signal?.throwIfAborted();
}

async function selectedOriginal(store,{row,summary}){
 const record=await store.record(row.id,row.revision);
 if(record.share!==summary.share||record.notebookId!==summary.notebookId)throw new AppError('CATALOGUE_DAMAGED');
 return record;
}
export async function* selectedPublicationRecords(store,snapshot,options={}){
 for await(const item of selectedPublicationRows(store,snapshot,options)){
  const record=await selectedOriginal(store,item),patch=item.patch;
  const selected={...record,share:true,attachments:record.attachments.map(a=>{const choice=patch?.attachments.find(item=>item.id===a.id);return choice?{...a,share:choice.share}:a;})};
  originals.set(selected,record);options.page?.remember?.(selected,item.row.position??snapshot.records.findIndex(row=>row.id===record.id));yield selected;
 }
}
async function* selectedPublicationInventories(store,snapshot,options){
 const metadata=options.metadata??snapshot.metadata;
 for await(const {row,summary,patch} of selectedPublicationRows(store,snapshot,{...options,inventory:true})){
  // Historical derivatives lack this field. Only the chosen page falls back
  // to its originals; old snapshots and research revisions are never rewritten.
  let inventory=summary.editionInventory;
  if(!inventory){const original=await selectedOriginal(store,{row,summary});inventory=recordEditionInventory(original,recordRevision(original));}
  const item={...inventory,choice:{...inventory.choice,attachments:summary.publication.attachments.filter(a=>patch?.attachments.find(value=>value.id===a.id)?.share??a.share).map(a=>a.id)},notebook:metadata.notebooks.find(n=>n.id===summary.notebookId)?.title??''};
  options.page?.remember?.(item,row.position??snapshot.records.findIndex(value=>value.id===row.id));yield item;
 }
}

export async function publicationSource(workspace,{etag,book,workspaceId,draft},{signal,consume,page,inventory=false}={}){
 signal?.throwIfAborted();
 const current=await workspace.outline();
 if(workspaceId!==undefined&&workspaceId!==current.metadata.id)throw new AppError('WORKSPACE_CHANGED');
 if(etag!==current.etag)throw new AppError('CONFLICT');
 if(draft!==undefined){
  validateWorkspaceEditCommand(draft);
  if(book!==undefined||draft.baseEtag!==etag||draft.changes.length||draft.removed.length)throw new AppError('INVALID');
  if(draft.workspaceId!==current.metadata.id)throw new AppError('WORKSPACE_CHANGED');
 }
 if(book!==undefined){
  if(workspace.websiteId)throw new AppError('INVALID');
  const draft=upgradeNotebook(book);
  if(draft.id!==current.metadata.id)throw new AppError('INVALID');
  return consumeBook(draft,consume,page,inventory);
 }
 // Legacy file workspaces have no catalogue to address independently.
 if(await workspace.storageKind()!=='catalogue'){
  if(draft!==undefined)throw new AppError('FORMAT');
  const saved=await workspace.read();if(saved.etag!==etag)throw new AppError('CONFLICT');
  return consumeBook(upgradeNotebook(saved.book),consume,page,inventory);
 }
 return workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(etag);
  if(snapshot.metadata.id!==current.metadata.id)throw new AppError('WORKSPACE_CHANGED');
  const metadata=draft?workspaceEditMetadata(snapshot.metadata,draft):snapshot.metadata;
  if(draft)await store.validateMetadata(snapshot,metadata);
  const selection=draft?.selection??snapshot.websiteSelection,paging=publicationSelectionPage(store,{snapshotId:etag,websiteId:workspace.websiteId,metadata,selection},page);
  const options={signal,metadata,selection,page:paging.page};
  return consume?consume(metadata,(inventory?selectedPublicationInventories:selectedPublicationRecords)(store,snapshot,options),{sourceEtag:etag,nextCursor:paging.nextCursor}):selectedPublicationBook(store,snapshot,options);
 });
}
