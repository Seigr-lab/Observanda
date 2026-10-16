import {AppError} from './errors.js';
// Only publication derivatives receive public identities. The encrypted input
// and the selection that was checked against it retain their original IDs.
export function publicationOwnerProjection(input,owner,identities){
 const namespace=owner.workspaceId;
 if(input.metadata.id!==namespace)throw new AppError('WORKSPACE_CHANGED');
 const mediaId=id=>identities.identity(namespace,'media',id),recordId=id=>identities.identity(namespace,'record',id);
 const selectedProjects=input.metadata.projects.filter(project=>project.share),projects=new Set(selectedProjects.map(project=>project.id));
 const references=item=>[...new Set([namespace,...(item.referenceNamespaces??[])])];
 const records=input.records.map(row=>{
  const mediaIdentities=Object.fromEntries((row.media??[]).map(media=>[media.id,mediaId(media.id)]));
  return {...row,id:recordId(row.id),recordId:row.recordId??row.id,sourceWorkspaceId:namespace,
   referenceNamespaces:references(row),notebookId:identities.identity(namespace,'notebook',row.notebookId),mediaIdentities,
   media:row.media.map(media=>({...media,id:mediaId(media.id)})),attachments:row.attachments.map(media=>({...media,id:mediaId(media.id)})),
   selectors:row.selectors.map(selector=>selector.kind==='figure'&&mediaIdentities[selector.id]?{...selector,sourceId:selector.id,id:mediaIdentities[selector.id]}:{...selector})};
 });
 return {...input,records,metadata:{...input.metadata,
  projects:selectedProjects.map(project=>({...project,id:identities.project(owner,project.id),sourceId:project.id,sourceWorkspaceId:owner.projectId===project.id?owner.projectNamespaceId??namespace:namespace,referenceNamespaces:[...new Set([...references(project),...(owner.projectId===project.id&&owner.projectNamespaceId?[owner.projectNamespaceId]:[])])],
   parentId:projects.has(project.parentId)?identities.project(owner,project.parentId):null})),
  notebooks:input.metadata.notebooks.filter(notebook=>projects.has(notebook.projectId)).map(notebook=>({...notebook,id:identities.identity(namespace,'notebook',notebook.id),sourceId:notebook.id,sourceWorkspaceId:namespace,referenceNamespaces:references(notebook),projectId:identities.project(owner,notebook.projectId)}))}};
}
export function publicationPageRecord(selected,row){
 const record=structuredClone(selected),media=row.mediaIdentities??{};
 const visit=node=>{if(node?.type==='book_figure'&&media[node.attrs?.figureId])node.attrs.figureId=media[node.attrs.figureId];for(const child of node?.content??[])visit(child);};
 for(const document of [record.body,...record.sections.map(section=>section.body)])visit(document);
 record.attachments=record.attachments.map(attachment=>({...attachment,id:media[attachment.id]??attachment.id}));
 return {...record,id:row.id,notebookId:row.notebookId,...(row.recordId?{recordId:row.recordId}:{}),
  ...(row.sourceWorkspaceId?{sourceWorkspaceId:row.sourceWorkspaceId}:{}),...(row.referenceNamespaces?{referenceNamespaces:row.referenceNamespaces}:{}),
  ...(row.historical?{historical:true,revision:row.revision}:{})};
}
