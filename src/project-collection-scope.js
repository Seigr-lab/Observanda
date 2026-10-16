import {AppError} from './errors.js';
// Resolve requested display scope against the authenticated workspace hierarchy.
// Child membership is explicit; moving a selected book never broadens a query.
export function projectCollectionScope(projects,{scope=null,selection}){
 const entries=new Map(projects.map(project=>[project.projectId,project]));
 const below=(id,parent)=>{const seen=new Set();while(id!==null){if(id===parent)return true;if(seen.has(id))throw new AppError('FORMAT');seen.add(id);id=entries.get(id)?.parentId??null;}return false;};
 const available=projects.filter(project=>!scope||below(project.projectId,scope));
 if(scope&&!entries.has(scope))throw new AppError('NOT_FOUND');
 const ids=new Set();
 if(selection.scopeMode==='all')for(const project of available)ids.add(project.projectId);
 else for(const id of selection.projectIds){
  if(!entries.has(id)||scope&&!below(id,scope))throw new AppError('RECORD_VIEW_SCOPE');
  ids.add(id);if(selection.includeDescendants)for(const project of available)if(below(project.projectId,id))ids.add(project.projectId);
 }
 if(!scope&&selection.includeWorkspace)ids.add(null);
 return {projectIds:ids,projectLabels:Object.fromEntries(selection.projectIds.map(id=>[id,entries.get(id)?.summary?.title??''])),notebookIds:selection.notebookMode==='selected'?new Set(selection.notebookIds):null};
}
