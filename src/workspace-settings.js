import {cataloguePrefixExists} from './postgres-indexes.js';
import {readProjectDomainRegistry} from './project-domain-registry.js';
// Workspace preferences have their own authenticated rows and writer lock.
// They share the lifecycle handoff with other owners, not the research writer.
import {catalogueFormat,catalogueRequiresSettings,requireWorkspaceSettings} from './catalogue-format.js';
import {projectDomainHandoff,projectDomainLock} from './project-domain-lock.js';
import {assertNotDeleting} from './workspace-delete-state.js';
import {assertNotMoving} from './workspace-move-state.js';
import {assertNotRenaming} from './workspace-rename-state.js';
import {defaultDashboard,validDashboard} from './web/dashboard-model.js';
import {dashboardSnapshot} from './preferences.js';
import {AppError} from './errors.js';

const registrySlot='workspace-settings',dashboardSlot='workspace-settings:dashboard';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const owner=namespaceId=>({version:1,namespaceId,features:['dashboard']});
async function row(store,slot){
 const saved=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
 return saved?store.decode('state',slot,saved.payload):null;
}
export async function workspaceSettingsRegistry(store){
 const value=await row(store,registrySlot),format=await catalogueFormat(store.db);
 if(!catalogueRequiresSettings(format)){if(value)damaged();return null;}
 const namespaceId=(await store.snapshot()).metadata.id;
 if(store.workspace.projectId||!value||Object.keys(value).sort().join()!=='features,namespaceId,version'||value.version!==1||value.namespaceId!==namespaceId||!Array.isArray(value.features)||value.features.join()!=='dashboard')damaged();
 return value;
}
export async function readOwnedDashboard(store){
 const registry=await workspaceSettingsRegistry(store);if(!registry)return null;
 const value=await row(store,dashboardSlot);
 if(!value||Object.keys(value).sort().join()!=='namespaceId,settings,version'||value.version!==1||value.namespaceId!==registry.namespaceId||!validDashboard(value.settings))damaged();
 return dashboardSnapshot(value.settings);
}
export async function initializeWorkspaceSettings(store,{dashboard=defaultDashboard()}={}){
 if(store.workspace.projectId||!validDashboard(dashboard))throw new AppError('INVALID');
 if((await readProjectDomainRegistry(store))?.commandVersion!==1)throw new AppError('ACCESS_UPGRADE');
 if(await workspaceSettingsRegistry(store)||await cataloguePrefixExists(store.db,'state','workspace-settings:')||await store.objectIdentity('metadata:.observanda/dashboard.observanda'))throw new AppError('EXISTS');
 const namespaceId=(await store.snapshot()).metadata.id;
 await requireWorkspaceSettings(store.db);
 for(const [slot,value] of [[registrySlot,owner(namespaceId)],[dashboardSlot,{version:1,namespaceId,settings:dashboard}]])await store.db.run('INSERT INTO state VALUES ($1,$2)',slot,store.encode('state',slot,value));
}
export async function verifyWorkspaceSettings(store){
 const registry=await workspaceSettingsRegistry(store);if(!registry)return;
 await readOwnedDashboard(store);
 const slots=await store.db.all('SELECT slot FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2 ORDER BY slot COLLATE "C" LIMIT 2','workspace-settings:','workspace-settings;');
 if(slots.length!==1||slots[0].slot!==dashboardSlot||await store.objectIdentity('metadata:.observanda/dashboard.observanda'))damaged();
}
export class WorkspaceSettings{
 constructor(workspace){this.workspace=workspace;}
 read(){return this.workspace.catalogue(readOwnedDashboard);}
 async writeDashboard(settings,etag){
  if(!validDashboard(settings)||typeof etag!=='string')throw new AppError('INVALID');
  const workspace=this.workspace;await workspace.requireStorageKey();const db=await workspace.openCatalogue();let store;
  try{
   await db.run('BEGIN');await projectDomainHandoff(db,{shared:true});await projectDomainLock(db,'Observanda/workspace-settings/'+db.id+'/dashboard');
   await assertNotDeleting(workspace.root);await assertNotMoving(workspace.root);await assertNotRenaming(workspace.root);
   store=workspace.catalogueStore(db);const current=await readOwnedDashboard(store);
   if(!current)throw new AppError('ACCESS_UPGRADE');if(current.etag!==etag)throw new AppError('DASHBOARD_CHANGED');
   const namespaceId=(await store.snapshot()).metadata.id,value={version:1,namespaceId,settings};
   await db.run('UPDATE state SET payload=$1 WHERE slot=$2',store.encode('state',dashboardSlot,value),dashboardSlot);await db.run('COMMIT');return dashboardSnapshot(settings);
  }finally{await db.close();}
 }
}
