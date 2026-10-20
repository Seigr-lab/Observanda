import {ProjectSourceAuthority} from './project-source-authority.js';
import {randomUUID} from 'node:crypto';
import {validWebsiteName} from './web/website-name.js';
import {AppError} from './errors.js';
import {validateWorkspaceEditCommand,workspaceEditMetadata} from './workspace-edit-command.js';
import {websiteDocument,websiteBook,WEBSITE_DOCUMENT_FIELDS,validWebsites} from './web/website-sites-model.js';
import {websiteDefaults,emptyHomepage,siteLayoutDefaults} from './web/website-model.js';
import {presentationDefaults} from './web/media-presentation.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validWebsitePin} from './web/website-pin.js';
import {SnapshotIndex} from './snapshot-index.js';
import {serialize} from './storage-format.js';
import {WebsiteDocumentStore} from './website-document-store.js';
import {websiteDocumentHeader} from './website-document-validation.js';
import {projectWebsiteAttachmentChoices} from './website-selection-admission.js';
import {readWebsiteDocumentRegistry,websiteDocumentLocks} from './website-document-registry.js';
import {defaultWebsiteSelection,mergeLegacyWebsiteSelection} from './website-owned-metadata.js';
import {assertNotDeleting} from './workspace-delete-state.js';
import {assertNotMoving} from './workspace-move-state.js';
import {assertNotRenaming} from './workspace-rename-state.js';

const pinOf=({researchSnapshotId,websiteId,websiteRevision})=>({researchSnapshotId,websiteId,websiteRevision});
const identifier=id=>id===null||researchId(id);
const sameSite=(a,b)=>{const {id:ai,...av}=a,{id:bi,...bv}=b;void ai;void bi;return serialize(av)===serialize(bv);};
// Website originals and optimistic revisions belong to this owner. Research
// is read through an immutable snapshot; ordinary site saves do not claim its
// writer or advance its history.
export class WebsiteSites{
 constructor(workspace){this.workspace=workspace;}
 async initialize(){
  if(await this.workspace.storageKind()!=='catalogue')throw new AppError('STORAGE_UPGRADE_REQUIRED');
  if(await this.workspace.catalogue(readWebsiteDocumentRegistry))return;
  await this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   await store.initializeWebsiteDocuments();
  }));
 }
 async write(websiteId,{registration=false}={},consume){
  await this.initialize();await this.workspace.requireStorageKey();
  const db=await this.workspace.openCatalogue();
  try{
   await db.run('BEGIN');const store=this.workspace.catalogueStore(db);
   await websiteDocumentLocks(store,{websiteIds:registration?[]:[websiteId],registration});
   await assertNotDeleting(this.workspace.root);await assertNotMoving(this.workspace.root);await assertNotRenaming(this.workspace.root);
   const value=await consume(store,new WebsiteDocumentStore(store));await db.run('COMMIT');return value;
  }finally{await db.close();}
 }
 async list({after=null,limit=20}={}){
  if(await this.workspace.storageKind()!=='catalogue')throw new AppError('STORAGE_UPGRADE_REQUIRED');
  return this.workspace.catalogue(async store=>{
   const etag=await store.head(),snapshot=await store.snapshot(etag),documents=new WebsiteDocumentStore(store);
   if(await readWebsiteDocumentRegistry(store)){
    const page=await documents.list({after,limit});
    return {workspaceId:snapshot.metadata.id,etag,sites:page.sites.map(site=>({...site,id:site.websiteId})),next:page.next};
   }
   if(after!==null&&(typeof after!=='string'||!researchId(after))||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new AppError('INVALID');
   const selected=(snapshot.metadata.websites??[]).filter(site=>after===null||site.id>after).sort((a,b)=>a.id<b.id?-1:1).slice(0,limit+1),more=selected.length>limit;if(more)selected.pop();
   return {workspaceId:snapshot.metadata.id,etag,sites:selected.map(({id,name,projectId})=>({id,name,projectId})),next:more?selected.at(-1).id:null};
  });
 }
 async version(id,{websitePin=null}={}){
  if(await this.workspace.storageKind()!=='catalogue')throw new AppError('STORAGE_UPGRADE_REQUIRED');
  if(!identifier(id)||websitePin!==null&&(!validWebsitePin(websitePin)||websitePin.websiteId!==id))throw new AppError('INVALID');
  return this.workspace.catalogue(async store=>{
   const researchSnapshotId=await store.head(),value={...await new WebsiteDocumentStore(store).head(id),researchSnapshotId},snapshot=await store.snapshot(researchSnapshotId);
   return {workspaceId:snapshot.metadata.id,etag:value.researchSnapshotId,websitePin:pinOf(value)};
  });
 }
 async read(id,{signal,websitePin=null}={}){
  if(await this.workspace.storageKind()!=='catalogue')throw new AppError('STORAGE_UPGRADE_REQUIRED');
  if(!identifier(id)||websitePin!==null&&(!validWebsitePin(websitePin)||websitePin.websiteId!==id))throw new AppError('INVALID');
  return this.workspace.catalogue(async store=>{
   signal?.throwIfAborted();
   const value=await new WebsiteDocumentStore(store).read(id,{...websitePin,signal}),snapshot=await store.snapshot(value.researchSnapshotId),site=value.site;
   const book=websiteBook({...snapshot.metadata,entries:[]},site),notebookCounts=Object.fromEntries(book.notebooks.map(n=>[n.id,0])),projects=new Map(book.notebooks.map(n=>[n.id,n.projectId])),selected=new Set((site.selection?.records??[]).map(r=>r.id)),selectionProjects={};let total=0;
   const index=new SnapshotIndex(store);
   if(snapshot.indexVersion&&await index.scopedCount(snapshot.membership)===snapshot.count){
    for(const notebook of book.notebooks){signal?.throwIfAborted();const count=await index.scopedCount(snapshot.membership,notebook.id);notebookCounts[notebook.id]=count;total+=count;}
    for(const id of selected){signal?.throwIfAborted();const row=await store.member(snapshot,id);if(row&&projects.has(row.notebookId))selectionProjects[id]=projects.get(row.notebookId);}
   }else for await(const row of store.members(snapshot,{signal})){
    const notebookId=row.notebookId??(await store.record(row.id,row.revision)).notebookId;
    if(!Object.hasOwn(notebookCounts,notebookId))continue;
    notebookCounts[notebookId]++;total++;if(selected.has(row.id))selectionProjects[row.id]=projects.get(notebookId);
   }
   return {site:{...site,id,selection:site.selection??{includeProjects:[],records:[]}},websitePin:pinOf(value),etag:value.researchSnapshotId,book,outline:true,recordRevisions:{},notebookCounts,total,selectionProjects};
  });
 }
 async validate(store,snapshot,previous,site){
  if(!validWebsites([site],snapshot.metadata))throw new AppError('INVALID');
  const book=websiteBook(snapshot.metadata,site),before={...snapshot,metadata:websiteBook(snapshot.metadata,previous??site)};
  await store.validateMetadata(before,book);
  const notebooks=new Set(book.notebooks.map(n=>n.id)),selected=new Map(site.selection.records.map(value=>[value.id,value])),saved=new Map((previous?.selection?.records??[]).map(value=>[value.id,value]));
  async function* rows(){for(const choice of selected.values()){const row=await store.member(snapshot,choice.id);if(!row||!notebooks.has(row.notebookId))throw new AppError('INVALID');if(choice.attachments.length)yield row;}}
  for await(const summary of store.queryDocuments(rows(),snapshot.metadata,{search:false,publication:true}))projectWebsiteAttachmentChoices(selected.get(summary.id).attachments,summary.publication.attachments,saved.get(summary.id)?.attachments);
 }
 async change({workspaceId,etag,operation,id=null,name,projectId=null,websitePin=null}){
  if(await this.workspace.storageKind()!=='catalogue')throw new AppError('STORAGE_UPGRADE_REQUIRED');
  if(!revisionId(etag)||!researchId(workspaceId)||!['create','rename'].includes(operation)||!identifier(id)||operation==='create'&&(this.workspace.projectId||this.workspace.labBookId||projectId!==null))throw new AppError('INVALID');
  if(!validWebsiteName(name))throw new AppError('INVALID');name=name.trim();
  const created=operation==='create';
  const result=await this.write(id,{registration:created},async(store,documents)=>{
   const head=await store.head(),snapshot=await store.snapshot(head);
   if(snapshot.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(created){
    const document=websiteDocument(snapshot.metadata);
    document.website={...websiteDefaults(),title:name,description:'',home:emptyHomepage(),design:siteLayoutDefaults(),assets:[],layouts:[],templates:[],typography:{},presentation:presentationDefaults(),palette:{},logoId:null,logoAlt:'',footer:'',navigation:[]};
    document.pages=[];document.branding=[];id=randomUUID();
    const site={id,name,projectId:null,document,projects:snapshot.metadata.projects.map(({id})=>({id,share:false,logoId:null})),selection:{defaultShare:false,includeProjects:[],records:[]}};
    await this.validate(store,snapshot,null,site);return documents.create(site,{researchSnapshotId:head});
   }
   if(websitePin?.websiteRevision){
    const current=await documents.document(id,{mutable:true}),site=await websiteDocumentHeader(current.document);
    await new ProjectSourceAuthority(store).writable(site.projectId);
    const expected=await this.expected(store,documents,id,{baseEtag:etag,websitePin},current),document=await current.document.property([],'name',name);
    return documents.saveDocument(id,document,{researchSnapshotId:head,expectedRevision:expected,collectionIndexes:current.collectionIndexes,navigationProjection:current.navigationProjection});
   }
   const current=await documents.read(id);await new ProjectSourceAuthority(store).writable(current.site.projectId);const expected=await this.expected(store,documents,id,{baseEtag:etag,websitePin},current);
   const site={...current.site,name};await this.validate(store,snapshot,current.site,site);
   return documents.save(id,site,{researchSnapshotId:head,expectedRevision:expected});
  });
  return {id:result.websiteId,websitePin:pinOf(result),...await this.list()};
 }
 async expected(store,documents,id,{baseEtag,websitePin},current){
  if(websitePin!==undefined&&websitePin!==null){
   if(!validWebsitePin(websitePin)||websitePin.websiteId!==id||websitePin.researchSnapshotId!==baseEtag)throw new AppError('INVALID');
   if(websitePin.websiteRevision!==null){await documents.document(id,{researchSnapshotId:baseEtag,websiteRevision:websitePin.websiteRevision});return websitePin.websiteRevision;}
  }
  // Only an exact older inline document can authorize a client's first owner
  // save. A missing revision cannot overwrite a later independently saved site.
  const before=await store.snapshot(baseEtag);if(before.websiteDocuments)throw new AppError('CONFLICT');
  const legacy=await documents.read(id,{researchSnapshotId:baseEtag,websiteRevision:null});
  if(id===null)legacy.site.selection=await defaultWebsiteSelection(store,before);
  if(!sameSite(legacy.site,current.site))throw new AppError('CONFLICT');
  return current.websiteRevision;
 }
 async save(id,command){
  if(await this.workspace.storageKind()!=='catalogue')throw new AppError('STORAGE_UPGRADE_REQUIRED');
  if(!identifier(id))throw new AppError('INVALID');
  const {response,websitePin,...edit}=command;void response;validateWorkspaceEditCommand(edit);
  if(edit.changes.length||edit.removed.length||Object.keys(edit.metadata).some(k=>!WEBSITE_DOCUMENT_FIELDS.includes(k)))throw new AppError('INVALID');
  const saved=await this.write(id,{},async(store,documents)=>{
   const head=await store.head(),snapshot=await store.snapshot(head);
   if(snapshot.metadata.id!==edit.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const current=await documents.read(id);await new ProjectSourceAuthority(store).writable(current.site.projectId);const expected=await this.expected(store,documents,id,{baseEtag:edit.baseEtag,websitePin},current),site=structuredClone(current.site);
   const book=workspaceEditMetadata(websiteBook(snapshot.metadata,site),edit);
   site.document=websiteDocument(book);site.projects=book.projects.map(({id,share,logoId})=>({id,share,logoId}));
   if(edit.selection)site.selection=id===null&&!websitePin?.websiteRevision?mergeLegacyWebsiteSelection(site.selection,edit.selection):structuredClone(edit.selection);
   await this.validate(store,snapshot,current.site,site);
   return documents.save(id,site,{researchSnapshotId:head,expectedRevision:expected});
  });
  return this.read(id,{websitePin:pinOf(saved)});
 }
}
