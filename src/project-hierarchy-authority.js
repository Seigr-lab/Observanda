// Only hierarchy changes share this short transaction-scoped lease. Research
// records and independent domain commands do not acquire it.
import {projectDomainLock} from './project-domain-lock.js';
import {ProjectRegistry} from './project-registry.js';
import {serialize} from './storage-format.js';
export const projectHierarchyLock=db=>projectDomainLock(db,'Observanda/project-hierarchy/'+db.id);
export async function assertProjectHierarchyChange(store,before,after){
 if(store.workspace.projectId||store.workspace.labBookId||!before||serialize(before.projects)===serialize(after.projects))return;
 await projectHierarchyLock(store.db);
 const registry=new ProjectRegistry(store.workspace,before.id),current=await registry.read({metadata:before});registry.validate(current.value,{legacyProjects:after.projects});
}
