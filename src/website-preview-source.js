import {publicationWorkspace,publicationSnapshot} from './publication-pin.js';
import {websiteEditorProjection} from './website-editor-projection.js';
import {publicationEditorProjection} from './publication-editor-projection.js';
import {WebsitePreviewSources} from './website-preview-sources.js';
import {publicationPreviewMedia} from './publication-preview-media.js';
import {validPublicationSources} from './web/publication-sources-model.js';
import {AppError} from './errors.js';
import {validateWorkspaceEditCommand} from './workspace-edit-command.js';
import {WebsitePreviewRecords} from './website-preview-records.js';
import {websiteCollectionRequests} from './website-preview-collections.js';
import {websitePreviewPage} from './website-preview-page.js';

// The base snapshot pins both originals and summaries. Resolve only the page's
// selected collections, links and neighbours; this projection cannot be exported.
export async function websitePreviewSource(workspace,command,{websitePin,designTarget,referenceCursor=null,collections=[],signal,sourceReader}={}){
 validateWorkspaceEditCommand(command);signal?.throwIfAborted();
 websiteCollectionRequests(collections);
 if(typeof designTarget!=='string'||! /^(home|(?:page|project|notebook|entry):[a-f0-9-]{36})$/.test(designTarget))throw new AppError('INVALID');
 if(referenceCursor!==null&&!designTarget.startsWith('entry:'))throw new AppError('INVALID');
 if(!workspace)throw new AppError('MISSING');
 workspace=publicationWorkspace(workspace);
 const outline=await workspace.outline();
 if(outline.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
 if(outline.metadata.formatVersion!==21||await workspace.storageKind()!=='catalogue')throw new AppError('FORMAT');
 return workspace.catalogue(async store=>{
  if((await store.snapshot()).metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  const snapshot=await publicationSnapshot(store,workspace,command.baseEtag,websitePin);
  if(snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  const metadata={...structuredClone(snapshot.metadata),...structuredClone(command.metadata)};
  for(const change of command.projects){
   const project=metadata.projects.find(p=>p.id===change.id);if(!project)throw new AppError('INVALID');
   project.share=change.share;project.logoId=change.logoId;
  }
  const records=new WebsitePreviewRecords(store,snapshot,metadata,command,{signal,websiteId:workspace.websiteId??null});await records.initialize();
  const sources=metadata.website.researchSources??[];
  if(!validPublicationSources(sources)||sources.some(source=>source.workspaceId===metadata.id))throw new AppError('INVALID');
  if(!sources.length)return {...await websitePreviewPage(records,metadata,{designTarget,referenceCursor,collections,signal}),websitePin:snapshot.websitePin};
  const reader=await sourceReader?.({signal});if(!reader)throw new AppError('ACCESS_LOCKED');
  try{
   const combined=await new WebsitePreviewSources(records,reader).initialize(sources);
   const page=await websitePreviewPage(combined,combined.metadata,{designTarget,referenceCursor,collections,signal});
   await reader.verify();return {...page,websitePin:snapshot.websitePin,editor:publicationEditorProjection(combined),media:publicationPreviewMedia(workspace,combined.mediaOrigins,sourceReader)};
  }finally{await reader.close();}
 });
}

// Native editor requests name an immutable server-retained document. They do
// not transport or reconstruct the website's growing authoring collections.
export async function websiteDocumentPreviewSource(workspace,{websitePin,websiteDraft},{designTarget,referenceCursor=null,collections=[],signal,sourceReader}={}){
 websiteCollectionRequests(collections);
 if(typeof designTarget!=='string'||! /^(home|(?:page|project|notebook|entry):[a-f0-9-]{36})$/.test(designTarget)||referenceCursor!==null&&!designTarget.startsWith('entry:'))throw new AppError('INVALID');
 const websiteId=workspace.websiteId??null,base=workspace.baseWorkspace??workspace;
 return base.catalogue(async store=>{
  const {metadata,snapshot}=await websiteEditorProjection(store,websiteId,{websitePin,websiteDraft,designTarget,signal});
  const command={workspaceId:metadata.id,baseEtag:websitePin.researchSnapshotId,metadata:{},projects:[],changes:[],removed:[]};
  const records=new WebsitePreviewRecords(store,snapshot,metadata,command,{signal,websiteId,metadataAdmitted:true});await records.initialize();
  const sources=metadata.website.researchSources??[];
  if(!validPublicationSources(sources)||sources.some(source=>source.workspaceId===metadata.id))throw new AppError('INVALID');
  if(!sources.length)return {...await websitePreviewPage(records,metadata,{designTarget,referenceCursor,collections,signal}),websitePin};
  const reader=await sourceReader?.({signal});if(!reader)throw new AppError('ACCESS_LOCKED');
  try{
   const combined=await new WebsitePreviewSources(records,reader).initialize(sources),page=await websitePreviewPage(combined,combined.metadata,{designTarget,referenceCursor,collections,signal});
   await reader.verify();return {...page,websitePin,editor:publicationEditorProjection(combined),media:publicationPreviewMedia(workspace,combined.mediaOrigins,sourceReader)};
  }finally{await reader.close();}
 });
}
