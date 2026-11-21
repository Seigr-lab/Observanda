import {NativeProjectRelocation} from './native-project-relocation.js';
// Cross-workspace placement publishes verified destination ownership before
// retiring the source. Each project's and book's access remains independent.
import path from 'node:path';
import {readProjectWorkspaceMove,saveProjectWorkspaceMove,workspaceMoveScope} from './project-workspace-move-state.js';
import {workspaceFile} from './storage.js';
import {assertProjectMoveDirectory} from './project-move-boundaries.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const relative=(base,root)=>path.relative(base,root).split(path.sep).join('/');
export class ProjectWorkspaceMoves{
 constructor(registry,targetRegistry,projectId){
  if(!researchId(projectId)||registry.workspaceId===targetRegistry.workspaceId)throw new AppError('INVALID');
  this.registry=registry;this.targetRegistry=targetRegistry;this.projectId=projectId;
 }
 read(){return readProjectWorkspaceMove(this.registry,this.projectId);}
 save(value){return saveProjectWorkspaceMove(this.registry,value);}
 scope(value){return workspaceMoveScope(this.registry,value);}
 async parent(parentId){return parentId===null?this.targetRegistry.workspace.root:(await this.targetRegistry.locate(parentId)).root;}
 async authorizeParent(parentId,withParent){
  if(parentId===null)return;
  if(typeof withParent!=='function')throw new AppError('ACCESS_LOCKED');
  const entry=await this.targetRegistry.locate(parentId);
  await withParent(parentId,async storage=>{if(storage.projectId!==parentId||storage.root!==entry.root||storage.vault?.id!==entry.vaultId)throw new AppError('ACCESS_DENIED');authenticateKeyring((await readAccess(entry.root)).value,storage.vault);});
 }
 async checkTarget(value){
  const registry=this.targetRegistry,target=value.target;
  if(registry.workspaceId!==target.workspaceId||registry.workspace.root!==target.root||registry.workspace.vault?.id!==target.vaultId)throw new AppError('ACCESS_DENIED');
  await assertProjectMoveDirectory(target.root,target.identity);authenticateKeyring((await readAccess(target.root)).value,registry.workspace.vault);
  const descriptor=JSON.parse(await registry.workspace.readFile(await workspaceFile(target.root),'utf8'));
  if(descriptor.workspaceId!==registry.workspaceId)throw new AppError('DATABASE_LOCATION');
  const parent=await this.parent(value.placement.parentId);
  if(relative(target.root,parent)!==target.parentRelative)throw new AppError('CONFLICT');await assertProjectMoveDirectory(parent,target.parentIdentity);
 }
 async run(storage,{id,parentId=null,expectedParentId,withProject,withBook,withParent,check=async()=>{},checkpoint=async()=>{}}){
  if(storage?.projectId!==this.projectId||!researchId(id)||parentId!==null&&!researchId(parentId)||expectedParentId!==null&&!researchId(expectedParentId))throw new AppError('INVALID');
  return new NativeProjectRelocation(this).run(storage,{id,parentId,expectedParentId,withProject,withBook,withParent,check,checkpoint});
 }
 resume(vault,options={}){return new NativeProjectRelocation(this).resume(vault,options);}
}
