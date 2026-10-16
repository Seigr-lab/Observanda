import {PublicationOwnerIdentities} from './publication-owner-identities.js';
import {AppError} from './errors.js';

// Authenticated editor labels carry public destinations beside their original
// owner address. They never enter a research draft or replace the host document.
export function publicationSourcePage(host,owner,metadata,record){
 if(metadata.id!==owner.workspaceId)throw new AppError('WORKSPACE_CHANGED');
 const notebook=metadata.notebooks.find(book=>book.id===record.notebookId),project=metadata.projects.find(project=>project.id===notebook?.projectId);
 if(!project)throw new AppError('CATALOGUE_DAMAGED');
 const identities=new PublicationOwnerIdentities(host.workspaceId),namespace=owner.workspaceId,id=identities.identity(namespace,'record',record.id),notebookId=identities.identity(namespace,'notebook',notebook.id),projectId=identities.project(owner,project.id);
 return {target:'entry:'+id,path:'entries/'+id+'.html',title:record.title,
  owner:{workspaceId:namespace,projectId:owner.projectId??null,labBookId:owner.labBookId??null},recordId:record.id,
  project:{id:projectId,title:project.title},notebook:{id:notebookId,title:notebook.title,projectId},
  record:{id,title:record.title,notebookId,type:record.type,share:record.share,attachments:record.attachments.map(attachment=>({id:identities.identity(namespace,'media',attachment.id),sourceId:attachment.id,kind:attachment.kind,caption:attachment.caption??'',alt:attachment.alt??'',share:attachment.share}))}};
}
