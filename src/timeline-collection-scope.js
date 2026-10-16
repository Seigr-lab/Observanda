import {AppError} from './errors.js';
import {LabBookDirectory} from './lab-book-directory.js';
import {projectCollectionScope} from './project-collection-scope.js';
import {timelineSource} from './web/tools/timeline-source.js';
// Resolve the union of projects and individual books before opening catalogues.
// An explicitly selected book does not unlock every other book in its project.
export async function timelineCollectionScope(registry,{workspaceId,scope,query}){
 const directory=await registry.directory(),all=directory.projects;
 if(workspaceId!==(scope?all.find(p=>p.projectId===scope)?.namespaceId:registry.workspaceId))throw new AppError('WORKSPACE_CHANGED');
 const available=projectCollectionScope(all,{scope,selection:{scopeMode:'all',projectIds:[],includeWorkspace:!scope,notebookMode:'all'}}).projectIds;
 const projects=new Set(),found=new Set(),namespaces=new Set(),visitedProjects=new Set(),unfiltered=!query.projects.length&&!query.books.length;
 for(const value of query.projects){
  const ref=timelineSource(value,workspaceId),entry=all.find(p=>p.projectId===ref.id&&(p.namespaceId??registry.workspaceId)===ref.workspaceId);
  if(!entry||!available.has(entry.projectId))continue;
  found.add('projects/'+value);const selected=projectCollectionScope(all,{scope,selection:{scopeMode:'selected',projectIds:[entry.projectId],includeDescendants:query.descendants,includeWorkspace:false,notebookMode:'all'}});
  for(const id of selected.projectIds){projects.add(id);visitedProjects.add(id);}
 }
 for(const value of query.books){
  const ref=timelineSource(value,workspaceId);
  if(ref.workspaceId===registry.workspaceId){if(!scope){namespaces.add(ref.workspaceId);visitedProjects.add(null);}continue;}
  const project=all.find(p=>p.namespaceId===ref.workspaceId);
  if(project){if(available.has(project.projectId)){namespaces.add(ref.workspaceId);visitedProjects.add(project.projectId);}continue;}
  const book=await new LabBookDirectory(registry).read(ref.workspaceId);
  if(book&&book.labBookId===ref.id&&available.has(book.projectId)){namespaces.add(ref.workspaceId);visitedProjects.add(book.projectId);}
 }
 const selection={scopeMode:unfiltered?'all':'selected',projectIds:[...visitedProjects].filter(id=>id!==null),includeDescendants:false,includeWorkspace:!scope&&(unfiltered||visitedProjects.has(null)),notebookMode:'all'};
 return {directory,projects,found,selection,includeOwner:owner=>unfiltered||projects.has(owner.projectId)||owner.projectId===null&&[...projects].some(id=>all.find(p=>p.projectId===id)?.legacy)||namespaces.has(owner.workspaceId),
  books(metadata){return new Set(metadata.notebooks.filter(book=>{
   const selected=query.books.filter(value=>{const ref=timelineSource(value,workspaceId);return ref.workspaceId===metadata.id&&ref.id===book.id;});
   for(const value of selected)found.add('books/'+value);
   return unfiltered||projects.has(book.projectId)||selected.length;
  }).map(book=>book.id));}};
}
