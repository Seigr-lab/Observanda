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
export async function websitePreviewSource(workspace,command,{designTarget,referenceCursor=null,collections=[],signal,sourceReader}={}){
 validateWorkspaceEditCommand(command);signal?.throwIfAborted();
 websiteCollectionRequests(collections);
 if(typeof designTarget!=='string'||! /^(home|(?:page|project|notebook|entry):[a-f0-9-]{36})$/.test(designTarget))throw new AppError('INVALID');
 if(referenceCursor!==null&&!designTarget.startsWith('entry:'))throw new AppError('INVALID');
 if(!workspace)throw new AppError('MISSING');
 const outline=await workspace.outline();
 if(outline.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
 if(outline.metadata.formatVersion!==21||await workspace.storageKind()!=='catalogue')throw new AppError('FORMAT');
 return workspace.catalogue(async store=>{
  if((await store.snapshot()).metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  const snapshot=await store.snapshot(command.baseEtag);
  if(snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  const metadata={...structuredClone(snapshot.metadata),...structuredClone(command.metadata)};
  for(const change of command.projects){
   const project=metadata.projects.find(p=>p.id===change.id);if(!project)throw new AppError('INVALID');
   project.share=change.share;project.logoId=change.logoId;
  }
  const records=new WebsitePreviewRecords(store,snapshot,metadata,command,{signal,websiteId:workspace.websiteId??null});await records.initialize();
  const sources=metadata.website.researchSources??[];
  if(!validPublicationSources(sources)||sources.some(source=>source.workspaceId===metadata.id))throw new AppError('INVALID');
  if(!sources.length)return websitePreviewPage(records,metadata,{designTarget,referenceCursor,collections,signal});
  const reader=await sourceReader?.({signal});if(!reader)throw new AppError('ACCESS_LOCKED');
  try{
   const combined=await new WebsitePreviewSources(records,reader).initialize(sources);
   const page=await websitePreviewPage(combined,combined.metadata,{designTarget,referenceCursor,collections,signal});
   await reader.verify();return {...page,editor:publicationEditorProjection(combined),media:publicationPreviewMedia(workspace,combined.mediaOrigins,sourceReader)};
  }finally{await reader.close();}
 });
}
