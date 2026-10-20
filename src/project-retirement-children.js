// Retiring a parent promotes surviving children to the workspace root. Legacy
// metadata is committed first: both states are valid if deletion is interrupted.
// Registry publication checks the graph again under its hierarchy lease.
import {AppError} from './errors.js';
export function legacyProjectChildren(value,metadata,projectId){
 const owned=new Set([...value.projects,...(value.deleted??[]),...(value.relocated??[])].map(project=>project.projectId));
 return metadata.projects.filter(project=>!owned.has(project.id)&&project.parentId===projectId);
}
export async function legacyProjectChildrenInView(view,metadata,projectId){
 const children=[];for(const project of metadata.projects)if(project.parentId===projectId&&!await view.get(project.id))children.push(project);return children;
}
export async function detachLegacyProjectChildren(registry,entry){
 const workspace=registry.workspace,outline=await workspace.outline();
 if(outline.metadata.id!==registry.workspaceId)throw new AppError('WORKSPACE_CHANGED');
 if(!(await registry.inspect(view=>legacyProjectChildrenInView(view,outline.metadata,entry.projectId))).length)return;
 await workspace.withLock(()=>workspace.catalogue(async store=>{
  await registry.inspect(async view=>{
   const row=await view.get(entry.projectId),selected=row?.state==='active'?row.entry:null;if(!selected||['root','namespaceId','vaultId'].some(key=>selected[key]!==entry[key]))throw new AppError('CONFLICT');
   const head=await store.head(),snapshot=await store.snapshot(head),children=await legacyProjectChildrenInView(view,snapshot.metadata,entry.projectId);
   if(snapshot.metadata.id!==registry.workspaceId)throw new AppError('WORKSPACE_CHANGED');if(!children.length)return;
   const ids=new Set(children.map(project=>project.id)),metadata=structuredClone(snapshot.metadata);
   for(const child of metadata.projects)if(ids.has(child.id)){child.parentId=null;child.share=false;}
   await store.validateMetadata(snapshot,metadata);await store.commitChanges(head,snapshot,metadata,[]);
  });
 }));
}
