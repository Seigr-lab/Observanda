// Only hierarchy changes share this short transaction-scoped lease. Research
// records and independent domain commands do not acquire it.
import {projectDomainLock} from './project-domain-lock.js';
import {ProjectRegistry} from './project-registry.js';
import {serialize} from './storage-format.js';
import {AppError} from './errors.js';
export const projectHierarchyLock=db=>projectDomainLock(db,'Observanda/project-hierarchy/'+db.id);
export async function assertProjectHierarchyChange(store,before,after){
 if(store.workspace.projectId||store.workspace.labBookId||!before||serialize(before.projects)===serialize(after.projects))return;
 await projectHierarchyLock(store.db);
 const registry=new ProjectRegistry(store.workspace,before.id);await registry.inspect(view=>verifyProjectDirectoryHierarchy(view,before.projects,after.projects));
}

// Existing native branches were validated when their directory head was saved.
// A metadata edit can affect them only through an amended inline ancestor.
export async function verifyProjectDirectoryHierarchy(view,before,after){
 const next=new Map(after.map(entry=>[entry.id,entry])),resolved=new Set();
 for(const entry of before)if(!next.has(entry.id)&&!await view.get(entry.id)){
  if((await view.page({index:'parent',prefix:entry.id+':',limit:1})).items.length)throw new AppError('FORMAT');
 }
 for(const entry of after){
  if(await view.get(entry.id))continue;const seen=new Set();let id=entry.id;
  while(id!==null&&!resolved.has(id)){
   if(seen.has(id))throw new AppError('FORMAT');seen.add(id);const row=await view.get(id);
   if(row&&row.state!=='active')throw new AppError('FORMAT');const current=row?.entry??next.get(id);if(!current)throw new AppError('FORMAT');id=current.parentId??null;
  }
  for(const id of seen)resolved.add(id);
 }
}
