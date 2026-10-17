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

// Merge real project groups across their independently owned books. A repeated
// book identity or two unrelated projects sharing a public ID is never merged.
export function appendPublicationCollections(target,incoming){
 for(const key of ['projects','notebooks'])for(const item of incoming[key]){
  const existing=target[key].find(value=>value.id===item.id);
  if(!existing){target[key].push(item);continue;}
  if(existing.sourceId!==item.sourceId||key==='notebooks')throw new AppError('PUBLICATION_IDENTITY');
  existing.referenceNamespaces=[...new Set([...(existing.referenceNamespaces??[]),...(item.referenceNamespaces??[])])];
 }
}

export async function projectPublicationRecord(row,owner,identities){
 const namespace=owner.workspaceId,mediaIdentities={};
 for(const media of row.media??[])mediaIdentities[media.id]=await identities.identity(namespace,'media',media.id);
 const media=[];for(const value of row.media??[])media.push({...value,id:await identities.identity(namespace,'media',value.id)});
 const attachments=[];for(const value of row.attachments??[])attachments.push({...value,id:await identities.identity(namespace,'media',value.id)});
 return {...row,id:await identities.identity(namespace,'record',row.id),recordId:row.recordId??row.id,sourceWorkspaceId:namespace,
  referenceNamespaces:[...new Set([namespace,...(row.referenceNamespaces??[])])],notebookId:await identities.identity(namespace,'notebook',row.notebookId),mediaIdentities,media,attachments,
  selectors:row.selectors.map(selector=>selector.kind==='figure'&&mediaIdentities[selector.id]?{...selector,sourceId:selector.id,id:mediaIdentities[selector.id]}:{...selector})};
}
export async function retainPublicationAliases(builder,kind,row,workspaceId){
 const owner=row.sourceWorkspaceId??workspaceId,sourceId=kind==='record'?row.recordId??row.id:row.sourceId??row.id;
 for(const namespace of new Set([workspaceId,...(row.referenceNamespaces??[])])){
  const target=namespace+'/'+kind+'/'+sourceId+'/',key=target+row.id;
  await builder.upsert('aliases',key,{namespace,kind,sourceId,publicId:row.id,owner},{indexes:{target}});
 }
}
export async function appendPublicationOwnerCollections(builder,metadata,owner,identities,{signal}={}){
 const namespace=owner.workspaceId;
 if(metadata.id!==namespace)throw new AppError('WORKSPACE_CHANGED');
 for(const project of metadata.projects){
  signal?.throwIfAborted();if(!project.share)continue;
  const value={...project,id:await identities.project(owner,project.id),sourceId:project.id,sourceWorkspaceId:owner.projectId===project.id?owner.projectNamespaceId??namespace:namespace,
   referenceNamespaces:[...new Set([namespace,...(project.referenceNamespaces??[]),...(owner.projectId===project.id&&owner.projectNamespaceId?[owner.projectNamespaceId]:[])])],
   parentId:metadata.projects.some(value=>value.id===project.parentId&&value.share)?await identities.project(owner,project.parentId):null};
  const previous=await builder.get('projects',value.id);
  if(previous){if(previous.sourceId!==value.sourceId||previous.sourceWorkspaceId!==value.sourceWorkspaceId)throw new AppError('PUBLICATION_IDENTITY');value.referenceNamespaces=[...new Set([...previous.referenceNamespaces,...value.referenceNamespaces])];}
  await builder.upsert('projects',value.id,value);await retainPublicationAliases(builder,'project',value,namespace);
 }
 for(const notebook of metadata.notebooks){
  signal?.throwIfAborted();if(!metadata.projects.some(project=>project.id===notebook.projectId&&project.share))continue;
  const value={...notebook,id:await identities.identity(namespace,'notebook',notebook.id),sourceId:notebook.id,sourceWorkspaceId:namespace,referenceNamespaces:[...new Set([namespace,...(notebook.referenceNamespaces??[])])],projectId:await identities.project(owner,notebook.projectId)};
  await builder.append('notebooks',value.id,value);await retainPublicationAliases(builder,'notebook',value,namespace);
 }
}
