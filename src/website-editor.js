// Website editing coordinates only the selected site's owner. Research is
// read at an immutable snapshot and remains available during draft writes.
import {AppError} from './errors.js';
import {WebsiteSites} from './website-sites.js';
import {WebsiteEditorStore} from './website-editor-store.js';
import {WEBSITE_DOCUMENT_FIELDS,siteProjectIds} from './web/website-sites-model.js';
import {SnapshotIndex} from './snapshot-index.js';
import {ProjectSourceAuthority} from './project-source-authority.js';
import {researchId} from './web/research-reference.js';
const reads=new Set(['open','window','item','sources']);
const mutations=new Set(['change','undo','redo','discard','save']);
export class WebsiteEditor{
 constructor(workspace,{sourceReader}={}){this.workspace=workspace;this.sourceReader=sourceReader;this.sites=new WebsiteSites(workspace);}
 async response(store,result,{signal}={}){
  if(!result.site)return result;
  const pin=result.websitePin,snapshot=await store.snapshot(pin.researchSnapshotId),metadata=structuredClone(snapshot.metadata),site=result.site;
  for(const key of [...WEBSITE_DOCUMENT_FIELDS,'websites'])delete metadata[key];
  const projects=new Map((site.projects??[]).map(p=>[p.id,p])),ids=siteProjectIds(metadata,site.projectId);
  metadata.projects=metadata.projects.filter(p=>ids.has(p.id)).map(p=>({...p,share:projects.get(p.id)?.share??false,logoId:projects.get(p.id)?.logoId??null,...(p.id===site.projectId&&p.parentId?{parentId:null}:{})}));
  metadata.notebooks=metadata.notebooks.filter(n=>ids.has(n.projectId));
  const index=new SnapshotIndex(store),notebookCounts=Object.fromEntries(metadata.notebooks.map(n=>[n.id,0])),selectionProjects={},notebooks=new Map(metadata.notebooks.map(n=>[n.id,n.projectId])),selected=new Set((site.selection?.records??[]).map(value=>value.id));let total=0;
  if(snapshot.indexVersion&&await index.scopedCount(snapshot.membership)===snapshot.count){
   for(const notebook of metadata.notebooks){signal?.throwIfAborted();const count=await index.scopedCount(snapshot.membership,notebook.id);notebookCounts[notebook.id]=count;total+=count;}
   for(const id of selected){signal?.throwIfAborted();const row=await store.member(snapshot,id);if(row&&notebooks.has(row.notebookId))selectionProjects[id]=notebooks.get(row.notebookId);}
  }else for await(const row of store.members(snapshot,{signal})){
   const notebookId=row.notebookId??(await store.record(row.id,row.revision)).notebookId;
   if(!notebooks.has(notebookId))continue;notebookCounts[notebookId]++;total++;if(selected.has(row.id))selectionProjects[row.id]=notebooks.get(notebookId);
  }
  return {...result,workspaceId:metadata.id,etag:pin.researchSnapshotId,research:{metadata,count:total},recordRevisions:{},notebookCounts,total,selectionProjects};
 }
 async execute(operation,data,{signal}={}){
  if(!reads.has(operation)&&!mutations.has(operation))throw new AppError('NOT_FOUND');
  if(!data||typeof data!=='object'||Array.isArray(data))throw new AppError('INVALID');
  const {websiteId,workspaceId,...options}=data;if(websiteId!==null&&!researchId(websiteId)||workspaceId!==undefined&&!researchId(workspaceId))throw new AppError('INVALID');
  const run=async store=>{
   signal?.throwIfAborted();if(workspaceId!==undefined&&(await store.snapshot()).metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');const editor=new WebsiteEditorStore(store,{sourceReader:this.sourceReader});
   if(mutations.has(operation)){
    const current=await editor.open(websiteId,{signal});await new ProjectSourceAuthority(store).writable(current.site.projectId);
   }
   const result=await editor[operation==='save'?'commit':operation](websiteId,{...options,signal});
   signal?.throwIfAborted();return this.response(store,result,{signal});
  };
  return reads.has(operation)?this.workspace.catalogue(run):this.sites.write(websiteId,{},run);
 }
}
