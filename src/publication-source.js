import {websitePublicationMetadata,websitePublicationPages,websitePublicationCollections} from './publication-website-input.js';
import {websiteEditorProjection} from './website-editor-projection.js';
import {validateWebsiteDocument,websiteDocumentHeader} from './website-document-validation.js';
import {WebsiteDocumentStore} from './website-document-store.js';
import {websiteBook,WEBSITE_DOCUMENT_FIELDS} from './web/website-sites-model.js';
import {serialize} from './storage-format.js';
import {validWebsitePin} from './web/website-pin.js';
import {validWebsiteDraftPin} from './web/website-draft-pin.js';
import {publicationWorkspace,publicationSnapshot} from './publication-pin.js';
import {projectWebsiteAttachmentChoices} from './website-selection-admission.js';
import {publicationRevisionCurrent} from './publication-freshness.js';
import {AppError} from './errors.js';
import {upgradeNotebook} from './model.js';
import {publicationRecords} from './publication-records.js';
import {validateWorkspaceEditCommand,workspaceEditMetadata} from './workspace-edit-command.js';
import {emptyWebsiteSelection,websiteRecordShare} from './web/website-selection.js';
import {recordRevision} from './research.js';
import {publicationSelectionPage} from './publication-selection-page.js';
import {recordEditionInventory} from './web/publication-inventory.js';
// Website choices can narrow source consent without creating a research revision. Keep the original
// privately bound to the selected derivative; callers cannot forge this link.
const originals=new WeakMap();
export const publicationOriginal=record=>originals.get(record)??record;
export function publicationDerivative(record,original){originals.set(record,publicationOriginal(original));return record;}

function consumeBook(book,consume,page,inventory,websitePin){
 if(page?.cursor)throw new AppError('PUBLICATION_SELECTION_CURSOR');
 if(!consume)return book;
 const {entries,...metadata}=book,heads=new Map(entries.map(record=>[record.id,recordRevision(publicationOriginal(record))]));
 const notebooks=new Set(metadata.notebooks.filter(n=>n.share!==false&&metadata.projects.some(p=>p.id===n.projectId&&p.share)).map(n=>n.id));
 const selected=entries.filter(r=>r.share&&notebooks.has(r.notebookId)&&(!page?.recordId||r.id===page.recordId));
 const records=page?selected.slice(page.offset,page.offset+page.limit):selected;
 return consume(metadata,inventory?records.map(record=>({...recordEditionInventory(record,recordRevision(publicationOriginal(record))),notebook:metadata.notebooks.find(n=>n.id===record.notebookId)?.title??''})):records,{recordHead:id=>heads.get(id)??null,sourceEtag:websitePin.researchSnapshotId,websitePin});
}

// Resolve saved selection before retrieving originals. Rendering and privacy
// projection remain the publisher's responsibility; metadata is not public output.
export async function selectedPublicationBook(store,snapshot,{signal,metadata=snapshot.metadata,selection=emptyWebsiteSelection()}={}){
 const entries=[];for await(const record of selectedPublicationRecords(store,snapshot,{signal,metadata,selection}))entries.push(record);
 return {...metadata,entries};
}
export async function* selectedPublicationRows(store,snapshot,{signal,metadata=snapshot.metadata,selection=emptyWebsiteSelection(),page,inventory=false}={}){
 const book=metadata,selected=new Map(selection.records.map(r=>[r.id,r])),saved=new Map((snapshot.websiteSelection?.records??[]).map(r=>[r.id,r])),overrides=new Map();
 if(selection.includeProjects.some(id=>!metadata.projects.some(p=>p.id===id)))throw new AppError('INVALID');
 const projects=new Set(book.projects.filter(p=>p.share).map(p=>p.id));
 const notebooks=new Set(book.notebooks.filter(n=>n.share!==false&&projects.has(n.projectId)).map(n=>n.id));
 const owners=new Map(metadata.notebooks.map(n=>[n.id,n.projectId]));
 // Validate explicit overrides independently of the displayed page. A late
 // unknown attachment/record must still fail, but ordinary pages need not scan
 // the entire private corpus merely to prove that all overrides were found.
 async function* overrideRows(){
  for(const id of selected.keys()){
   signal?.throwIfAborted();const row=await store.member(snapshot,id);
   if(!row)throw new AppError('RECORD_CHANGED');overrides.set(id,{row,patch:selected.get(id)});yield row;
  }
 }
 for await(const summary of store.queryDocuments(overrideRows(),snapshot.metadata,{signal,search:false,publication:true})){
  const patch=selected.get(summary.id),projected={...patch,attachments:projectWebsiteAttachmentChoices(patch.attachments,summary.publication.attachments,saved.get(summary.id)?.attachments)};
  selected.set(summary.id,projected);overrides.get(summary.id).patch=projected;
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
  const selected={...record,attachments:record.attachments.map(a=>{const choice=patch?.attachments.find(item=>item.id===a.id);return choice?{...a,share:a.share===true&&choice.share}:a;})};
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
  const item={...inventory,choice:{...inventory.choice,attachments:summary.publication.attachments.filter(a=>a.share===true&&(patch?.attachments.find(value=>value.id===a.id)?.share??a.share)).map(a=>a.id)},notebook:metadata.notebooks.find(n=>n.id===summary.notebookId)?.title??''};
  options.page?.remember?.(item,row.position??snapshot.records.findIndex(value=>value.id===row.id));yield item;
 }
}

export async function publicationSource(workspace,{etag,websitePin,websiteDraft,book,workspaceId,draft,selection},{signal,consume,page,inventory=false}={}){
 signal?.throwIfAborted();
 workspace=publicationWorkspace(workspace);
 if(websiteDraft!==undefined&&!validWebsiteDraftPin(websiteDraft))throw new AppError('INVALID');
 if(await workspace.storageKind()!=='catalogue')throw new AppError('STORAGE_UPGRADE_REQUIRED');
 if(websitePin?.websiteRevision&&book===undefined&&draft===undefined)return websiteDocumentPublicationSource(workspace,{etag,websitePin,websiteDraft,workspaceId},{signal,consume,page,inventory});
 if(websiteDraft!==undefined)throw new AppError('INVALID');
 const current=await workspace.currentOutline();
 if(workspaceId!==undefined&&workspaceId!==current.metadata.id)throw new AppError('WORKSPACE_CHANGED');
 if(!await publicationRevisionCurrent(workspace,{etag,websitePin},{current}))throw new AppError('CONFLICT');
 if(draft!==undefined){
  validateWorkspaceEditCommand(draft);
  if(book!==undefined||draft.baseEtag!==etag||draft.changes.length||draft.removed.length)throw new AppError('INVALID');
  if(draft.workspaceId!==current.metadata.id)throw new AppError('WORKSPACE_CHANGED');
 }
 if(book!==undefined){
  if(workspace.websiteId||current.websitePin?.websiteRevision)throw new AppError('INVALID');
  const draft=upgradeNotebook(book),saved=await workspace.read();
  if(draft.id!==current.metadata.id||saved.etag!==etag)throw new AppError('INVALID');
  const source=value=>{const copy=structuredClone(value);for(const key of WEBSITE_DOCUMENT_FIELDS)delete copy[key];copy.projects=copy.projects.map(({share,logoId,...project})=>project);return copy;};
  if(serialize(source(draft))!==serialize(source(upgradeNotebook(saved.book))))throw new AppError('INVALID');
  const originals=new Map(saved.book.entries.map(record=>[record.id,record]));for(const record of draft.entries)publicationDerivative(record,originals.get(record.id));
  return consumeBook(draft,consume,page,inventory,websitePin??{researchSnapshotId:etag,websiteId:null,websiteRevision:null});
 }
 return workspace.catalogue(async store=>{
  const snapshot=await publicationSnapshot(store,workspace,etag,websitePin);
  if(snapshot.metadata.id!==current.metadata.id)throw new AppError('WORKSPACE_CHANGED');
  const metadata=draft?workspaceEditMetadata(snapshot.metadata,draft):snapshot.metadata;
  if(draft)await store.validateMetadata(snapshot,metadata);
  const selection=draft?.selection??snapshot.websiteSelection,paging=publicationSelectionPage(store,{snapshotId:etag,websiteId:workspace.websiteId,websitePin:snapshot.websitePin,metadata,selection},page);
  const options={signal,metadata,selection,page:paging.page};
  return consume?consume(metadata,(inventory?selectedPublicationInventories:selectedPublicationRecords)(store,snapshot,options),{sourceEtag:etag,websitePin:snapshot.websitePin,nextCursor:paging.nextCursor}):selectedPublicationBook(store,snapshot,options);
 });
}

async function websiteDocumentPublicationSource(workspace,{etag,websitePin,websiteDraft,workspaceId},{signal,consume,page,inventory}){
 const id=workspace.websiteId??null,base=workspace.baseWorkspace??workspace;
 if(!validWebsitePin(websitePin)||websitePin.websiteId!==id||websitePin.researchSnapshotId!==etag)throw new AppError('INVALID');
 if(!await publicationRevisionCurrent(workspace,{etag,websitePin}))throw new AppError('CONFLICT');
 return base.catalogue(async store=>{
  const retained=!!consume&&!page&&!inventory,projected=await websiteEditorProjection(store,id,{websitePin,websiteDraft,pageLabels:false,signal});
  if(workspaceId!==undefined&&workspaceId!==projected.metadata.id)throw new AppError('WORKSPACE_CHANGED');
  const raw=await store.snapshot(etag);
  // Selection/inventory pages consume labels, not the website's page bodies.
  // Preparation streams independently retained pages after semantic admission;
  // the ordinary selection routes continue to consume the compact header.
  if(websiteDraft&&!page&&!inventory){
   const previous=await websiteDocumentHeader((await new WebsiteDocumentStore(store).document(id,websitePin)).document,{signal});
   await validateWebsiteDocument(store,raw,projected.document,{signal,previous});
  }
  const site=retained||page||inventory?projected.site:await projected.document.tree.read(projected.document.root);
  const metadata=retained?await websitePublicationMetadata(projected,{signal}):page||inventory?projected.metadata:websiteBook(raw.metadata,site),selection=site.selection;
  const snapshot={...raw,metadata,websiteSelection:selection,websitePin};
  const paging=publicationSelectionPage(store,{snapshotId:etag,websiteId:id,websitePin,websiteDraft,metadata,selection},page),options={signal,metadata,selection,page:paging.page};
  return consume?consume(metadata,(inventory?selectedPublicationInventories:selectedPublicationRecords)(store,snapshot,options),{sourceEtag:etag,websitePin,nextCursor:paging.nextCursor,...(retained?{websitePages:websitePublicationPages(projected,{signal}),websiteCollections:await websitePublicationCollections(projected,{signal})}:{})}):selectedPublicationBook(store,snapshot,options);
 });
}
