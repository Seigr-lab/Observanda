// Catalogues on a configured PostgreSQL server ('installation' placement) and
// unactivated archives can be deleted without adopting their storage.
// Only deletion uses this adapter; ordinary workspace routing stays unchanged.
import {Workspace} from './storage.js';
import {catalogueBinding} from './postgres-activation.js';
import {hasCatalogue} from './postgres.js';
import {databaseProvider} from './workspace-database-context.js';
export async function deletionDatabaseEnvironment(root,vault){
 const provider=databaseProvider();
 return provider?.deletionEnvironment?provider.deletionEnvironment(root,{vault}):provider?.environment(root,{vault});
}
class DeletionStorage extends Workspace{
 constructor(workspace,env,detached){super(workspace.root,workspace.vault);this.env=env;this.detached=detached;}
 openCatalogue(options={}){return super.openCatalogue({...options,env:this.env,detached:this.detached});}
}
export async function workspaceDeletionStorage(workspace){
 const binding=await catalogueBinding(workspace.root),provider=databaseProvider();
 if(binding?.placement==='installation')return new DeletionStorage(workspace,await deletionDatabaseEnvironment(workspace.root,workspace.vault),true);
 if(!binding&&await hasCatalogue(workspace.root)&&provider?.archiveEnvironment)return new DeletionStorage(workspace,await provider.archiveEnvironment(workspace.root),true);
 return workspace;
}
