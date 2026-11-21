import {validNativeRelocation} from './native-relocation-state.js';
// The source workspace owns the encrypted handoff journal. Relative owner
// paths preserve literal names; the authenticated peer location is private data.
import path from 'node:path';
import {unlink} from 'node:fs/promises';
import {assertRegular,privateDirectory,serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {nestedRenameRoot} from './workspace-rename-paths.js';
import {validProjectPlacement} from './project-placement.js';
import {validPlacementIdentity} from './project-placement-transfer-state.js';
import {AppError} from './errors.js';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const inside=(a,b)=>a===b||b.startsWith(a+path.sep);
export function projectWorkspaceMoveFile(registry,projectId,complete=false){if(!researchId(projectId))throw new AppError('INVALID');return path.join(registry.workspace.root,complete?'.observanda/project-workspace-moved':'.observanda/project-workspace-moves',projectId+'.obsv');}
export function workspaceMoveScope(registry,value){return {...value,source:nestedRenameRoot(registry.workspace.root,value.source),destination:nestedRenameRoot(value.target.root,value.destination)};}
export function validateProjectWorkspaceMove(registry,projectId,value){
 if(!value||value.version!==1||value.projectId!==projectId||value.workspaceId!==registry.workspaceId||![value.id,value.projectId,value.namespaceId,value.vaultId,value.workspaceId].every(researchId)||!['preparing','prepared','frozen','copying','moved','registered','retiring','retired','departing','departed','complete','cancelled'].includes(value.phase)||!validPlacementIdentity(value.identity)||![value.accessHash,value.descriptorHash].every(hash)||value.parentId!==null&&!researchId(value.parentId)||!validProjectPlacement(value.placement)||value.placement.expectedParentId!==value.parentId)throw new AppError('STORAGE_MOVE_STATE');
 if(value.released!==undefined&&(value.released!==true||value.phase!=='complete'))throw new AppError('STORAGE_MOVE_STATE');
 const target=value.target;
 if(!exact(target,'identity,parentIdentity,parentRelative,root,vaultId,workspaceId')||!researchId(target.workspaceId)||target.workspaceId===registry.workspaceId||!researchId(target.vaultId)||typeof target.root!=='string'||!path.isAbsolute(target.root)||target.root!==path.resolve(target.root)||target.root===path.parse(target.root).root||inside(registry.workspace.root,target.root)||inside(target.root,registry.workspace.root)||!validPlacementIdentity(target.identity)||!validPlacementIdentity(target.parentIdentity)||typeof target.parentRelative!=='string')throw new AppError('STORAGE_MOVE_STATE');
 // Folder checks shared with renames refuse with the rename code; in a move journal they are a move state error.
 let scope,parent;try{scope=workspaceMoveScope(registry,value);parent=target.parentRelative?nestedRenameRoot(target.root,target.parentRelative):target.root;}catch(error){if(error.code==='STORAGE_RENAME_STATE')throw new AppError('STORAGE_MOVE_STATE');throw error;}
 if(path.dirname(scope.destination)!==parent||path.basename(scope.source)!==path.basename(scope.destination)||value.placement.parentId===null&&target.parentRelative!==''||value.placement.parentId!==null&&target.parentRelative==='')throw new AppError('STORAGE_MOVE_STATE');
 if(!validNativeRelocation(value))throw new AppError('STORAGE_MOVE_STATE');
 return value;
}
export async function readProjectWorkspaceMove(registry,projectId){
 for(const complete of [false,true]){const file=projectWorkspaceMoveFile(registry,projectId,complete),stat=await assertRegular(file,{missing:true});if(!stat)continue;if(stat.size>16*1024*1024)throw new AppError('STORAGE_MOVE_STATE');
 let value;try{value=JSON.parse(await registry.workspace.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_MOVE_STATE');}return validateProjectWorkspaceMove(registry,projectId,value);}
 return null;
}
export async function saveProjectWorkspaceMove(registry,value){
 validateProjectWorkspaceMove(registry,value.projectId,value);const raw=serialize(value);if(Buffer.byteLength(raw)>16*1024*1024-128)throw new AppError('LIMIT');const complete=value.phase==='cancelled'||value.phase==='complete'&&value.released===true;
 await privateDirectory(registry.workspace.root,complete?'.observanda/project-workspace-moved':'.observanda/project-workspace-moves');await registry.workspace.writeFile(projectWorkspaceMoveFile(registry,value.projectId,complete),raw);
 if(complete)await unlink(projectWorkspaceMoveFile(registry,value.projectId)).catch(error=>{if(error.code!=='ENOENT')throw error;});
}
