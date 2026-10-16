import {WorkspaceSettings,readOwnedDashboard} from '../workspace-settings.js';
import {serialize} from '../storage.js';
import {defaultDashboard,validDashboard} from '../web/dashboard-model.js';
import {dashboardSnapshot} from '../preferences.js';
import {AppError} from '../errors.js';

// Workspace-dependent names, filters and card settings belong inside its encrypted boundary.
export async function readWorkspaceDashboard(workspace){
 if(await workspace.storageKind()==='catalogue'){const owned=await workspace.catalogue(readOwnedDashboard);if(owned)return owned;}
 const raw=await workspace.readMetadata('.observanda/dashboard.observanda',1048576);
 if(raw===null)return dashboardSnapshot(defaultDashboard());
 let settings;try{settings=JSON.parse(raw);}catch(error){if(error.code)throw error;throw new AppError('PREFERENCES_FORMAT');}
 if(!validDashboard(settings))throw new AppError('PREFERENCES_FORMAT');return dashboardSnapshot(settings);
}
export async function writeWorkspaceDashboard(workspace,settings,etag){
 if(!validDashboard(settings))throw new AppError('INVALID');
 if(await workspace.storageKind()==='catalogue'&&await workspace.catalogue(readOwnedDashboard))return new WorkspaceSettings(workspace).writeDashboard(settings,etag);
 return workspace.withLock(async()=>{
  if((await readWorkspaceDashboard(workspace)).etag!==etag)throw new AppError('DASHBOARD_CHANGED');
  await workspace.writeMetadata('.observanda/dashboard.observanda',serialize(settings));return dashboardSnapshot(settings);
 });
}
