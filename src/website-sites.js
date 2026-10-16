import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {validateWorkspaceEditCommand,workspaceEditMetadata} from './workspace-edit-command.js';
import {websiteDocument,websiteBook,WEBSITE_DOCUMENT_FIELDS,validWebsites} from './web/website-sites-model.js';
import {websiteDefaults,emptyHomepage,siteLayoutDefaults} from './web/website-model.js';
import {presentationDefaults} from './web/media-presentation.js';
import {researchId} from './web/research-reference.js';
import {SnapshotIndex} from './snapshot-index.js';

// A website owns presentation and selection. Research originals keep their own
// revisions; the shared catalogue transaction commits each website edit.
export class WebsiteSites{
 constructor(workspace){this.workspace=workspace;}
 async list(){const s=await this.workspace.outline();return {workspaceId:s.metadata.id,etag:s.etag,sites:(s.metadata.websites??[]).map(({id,name,projectId})=>({id,name,projectId}))};}
 async read(id,{signal}={}){
  signal?.throwIfAborted();
  if(!researchId(id))throw new AppError('INVALID');
  const s=await this.workspace.outline(),site=s.metadata.websites?.find(v=>v.id===id);if(!site)throw new AppError('NOT_FOUND');
  const book=websiteBook({...s.metadata,entries:[]},site),notebookCounts=Object.fromEntries(book.notebooks.map(n=>[n.id,0])),projects=new Map(book.notebooks.map(n=>[n.id,n.projectId])),selected=new Set(site.selection.records.map(r=>r.id)),selectionProjects={};let total=0;
  await this.workspace.catalogue(async store=>{
   const snapshot=await store.snapshot(s.etag),index=new SnapshotIndex(store);
   if(snapshot.indexVersion&&await index.scopedCount(snapshot.membership)===snapshot.count){
    for(const notebook of book.notebooks){signal?.throwIfAborted();const count=await index.scopedCount(snapshot.membership,notebook.id);notebookCounts[notebook.id]=count;total+=count;}
    for(const id of selected){signal?.throwIfAborted();const row=await store.member(snapshot,id);if(row&&projects.has(row.notebookId))selectionProjects[id]=projects.get(row.notebookId);}
   }else{
    // Retained ownership predating the index is resolved one record at a time.
    // Do not alter snapshot identities or allocate a corpus-sized manifest.
    for await(const row of store.members(snapshot,{signal})){
     const notebookId=row.notebookId??(await store.record(row.id,row.revision)).notebookId;
     if(!Object.hasOwn(notebookCounts,notebookId))continue;
     notebookCounts[notebookId]++;total++;if(selected.has(row.id))selectionProjects[row.id]=projects.get(notebookId);
    }
   }
  });
  return {site,etag:s.etag,book,outline:true,recordRevisions:{},notebookCounts,total,selectionProjects};
 }
 async change({workspaceId,etag,operation,id,name,projectId}){
  return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   const head=await store.head(),snapshot=await store.snapshot(head);
   if(snapshot.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');if(etag!==head)throw new AppError('CONFLICT');
   const sites=structuredClone(snapshot.metadata.websites??[]);
   if(operation==='create'){
    const project=snapshot.metadata.projects.find(p=>p.id===projectId);if(!project)throw new AppError('INVALID');
    const document=websiteDocument(snapshot.metadata);
    document.website={...websiteDefaults(),title:name,description:'',home:emptyHomepage(),design:siteLayoutDefaults(),assets:[],layouts:[],templates:[],typography:{},presentation:presentationDefaults(),palette:{},logoId:null,logoAlt:'',footer:'',navigation:[]};
    document.pages=[];document.branding=[];
    id=randomUUID();sites.push({id,name,projectId,document,projects:[{id:projectId,share:true,logoId:project.logoId}],selection:{defaultShare:false,includeProjects:[],records:[]}});
   }else if(operation==='rename'){
    const site=sites.find(s=>s.id===id);if(!site)throw new AppError('NOT_FOUND');site.name=name;
   }else throw new AppError('INVALID');
   const metadata={...snapshot.metadata,websites:sites};if(!validWebsites(sites,metadata))throw new AppError('INVALID');
   await store.validateMetadata(snapshot,metadata);await store.commitChanges(head,await store.indexed(snapshot),metadata,[]);
   return {id,...await this.list()};
  }));
 }
 async save(id,command){
  const {response,...edit}=command;void response;validateWorkspaceEditCommand(edit);
  if(edit.changes.length||edit.removed.length||Object.keys(edit.metadata).some(k=>!WEBSITE_DOCUMENT_FIELDS.includes(k)))throw new AppError('INVALID');
  return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   const head=await store.head(),snapshot=await store.snapshot(head);
   if(snapshot.metadata.id!==edit.workspaceId)throw new AppError('WORKSPACE_CHANGED');if(head!==edit.baseEtag)throw new AppError('CONFLICT');
   const metadata=structuredClone(snapshot.metadata),site=metadata.websites?.find(s=>s.id===id);if(!site)throw new AppError('NOT_FOUND');
   const book=workspaceEditMetadata(websiteBook(metadata,site),edit);
   site.document=websiteDocument(book);site.projects=book.projects.map(({id,share,logoId})=>({id,share,logoId}));
   if(edit.selection)site.selection=structuredClone(edit.selection);
   if(!validWebsites(metadata.websites,metadata))throw new AppError('INVALID');
   const notebooks=new Set(book.notebooks.map(n=>n.id));
   for(const selected of site.selection.records){const row=await store.member(snapshot,selected.id);if(!row||!notebooks.has(row.notebookId))throw new AppError('INVALID');}
   await store.validateMetadata(snapshot,metadata);await store.commitChanges(head,await store.indexed(snapshot),metadata,[]);
   return this.read(id);
  }));
 }
}
