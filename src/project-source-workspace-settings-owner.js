// Workspace dashboard choices include enabled tools and display preferences.
// Links to projects do not turn these settings into project-owned content.
import {readWorkspaceDashboard} from './security/dashboard-storage.js';
export function projectSourceWorkspaceSettingsOwner(store){
 return async id=>{
  if(id!=='metadata:.observanda/dashboard.observanda')return null;
  await store.workspace.inspectCatalogue(store,()=>readWorkspaceDashboard(store.workspace));
  return {kind:'workspace'};
 };
}
