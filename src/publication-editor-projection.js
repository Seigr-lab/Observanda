// Editor labels are a separate, bounded derivative of the admitted canvas.
// Only known presentation fields cross this boundary, even when an original
// was needed to render the selected page. Consent remains with the website.
export function publicationEditorProjection(provider){
 const owners=provider.owners,projects=new Map(),notebooks=new Map(),records=[];
 for(const owner of owners){
  for(const project of owner.projected.projects)projects.set(project.id,{id:project.id,title:project.title,parentId:project.parentId??null,share:true,logoId:null,description:''});
  for(const notebook of owner.projected.notebooks)notebooks.set(notebook.id,{id:notebook.id,projectId:notebook.projectId,title:notebook.title});
 }
 for(const descriptor of provider.descriptors.values()){
  const owner=owners.find(owner=>owner.source.workspaceId===descriptor.sourceWorkspaceId);if(!owner)continue;
  const original=owner.originals.get(descriptor.id),admitted=new Set((descriptor.media??[]).map(item=>item.id));
  const attachments=(original?.attachments??descriptor.attachments??[]).filter(item=>admitted.has(item.id)).map(item=>({id:item.id,kind:item.kind,caption:item.caption??'',alt:item.alt??'',share:true}));
  records.push({id:descriptor.id,title:descriptor.title,notebookId:descriptor.notebookId,type:descriptor.type,share:true,attachments});
 }
 return {workspaceId:provider.metadata.id,
  sources:owners.map(owner=>({workspaceId:owner.source.workspaceId,snapshotId:owner.snapshotId,projectId:owner.owner.projectId??null,labBookId:owner.owner.labBookId??null})),
  recordCount:owners.some(owner=>owner.notebookCounts===undefined)?null:owners.reduce((total,owner)=>total+Object.values(owner.notebookCounts).reduce((sum,count)=>sum+count,0),0),
  projects:[...projects.values()],notebooks:[...notebooks.values()],records};
}
