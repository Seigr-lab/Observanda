// Parent deletion requests child credentials in the selected workspace's
// application context. Closing an observer never grants another workspace access.
import {ProjectLocationAccess} from './project-location-access.js';
import {workspaceDeletion} from './workspace-delete-state.js';
export async function withWorkspaceDeletionSession(application,client,operation,options={}){
 const owners=new ProjectLocationAccess(application,client,options);
 try{return await operation({
  withProject:(id,use)=>owners.withProject(id,async storage=>{await application.jobs.invalidateProject(id);return use(storage);}),
  withBook:(project,id,use)=>owners.withBook(project,id,use)
 });}
 catch(error){if(['ACCESS_LOCKED','ACCESS_DENIED','DEVICE_UNKNOWN','AUTH'].includes(error.code)&&!await workspaceDeletion(application.workspace.root))error.operationNotStarted=true;throw error;}
 finally{await owners.close();}
}
