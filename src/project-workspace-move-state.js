import {validNativeRelocation} from './native-relocation-state.js';
// The source workspace owns the encrypted handoff journal. Relative owner
// paths preserve literal names; the authenticated peer location is private data.
import path from 'node:path';
import {unlink} from 'node:fs/promises';
import {assertRegular,privateDirectory,serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {nestedRenameRoot} from './workspace-rename-paths.js';
import {validateRenameProjects,validateRenameBooks} from './rename-owner-receipts.js';
import {validProjectPlacement} from './project-placement.js';
import {validPlacementIdentity,validProjectPlacementTransfer} from './project-placement-transfer-state.js';
import {validateProjectTree} from './project-tree-manifest.js';
import {AppError} from './errors.js';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const inside=(a,b)=>a===b||b.startsWith(a+path.sep);
const summary=value=>value===null||exact(value,'description,kind,templateName,title')&&['title','description','kind'].every(key=>typeof value[key]==='string'&&value[key].length<=({title:160,description:1500,kind:80})[key])&&(value.templateName===null||typeof value.templateName==='string'&&value.templateName.length<=160);
export function projectWorkspaceMoveFile(registry,projectId,complete=false){if(!researchId(projectId))throw new AppError('INVALID');return path.join(registry.workspace.root,complete?'.observanda/project-workspace-moved':'.observanda/project-workspace-moves',projectId+'.obsv');}
export function workspaceMoveScope(registry,value){return {...value,source:nestedRenameRoot(registry.workspace.root,value.source),destination:nestedRenameRoot(value.target.root,value.destination)};}
export function validateProjectWorkspaceMove(registry,projectId,value){
 if(!value||![1,2].includes(value.version)||value.projectId!==projectId||value.workspaceId!==registry.workspaceId||![value.id,value.projectId,value.namespaceId,value.vaultId,value.workspaceId].every(researchId)||!['preparing','prepared','frozen','copying','moved','registered','retiring','retired','departing','departed','complete','cancelled'].includes(value.phase)||!validPlacementIdentity(value.identity)||![value.accessHash,value.descriptorHash].every(hash)||value.parentId!==null&&!researchId(value.parentId)||!validProjectPlacement(value.placement)||value.placement.expectedParentId!==value.parentId)throw new AppError('STORAGE_MOVE_STATE');
 if(value.released!==undefined&&(value.released!==true||value.phase!=='complete'))throw new AppError('STORAGE_MOVE_STATE');
 const target=value.target;
 if(!exact(target,'identity,parentIdentity,parentRelative,root,vaultId,workspaceId')||!researchId(target.workspaceId)||target.workspaceId===registry.workspaceId||!researchId(target.vaultId)||typeof target.root!=='string'||!path.isAbsolute(target.root)||target.root!==path.resolve(target.root)||target.root===path.parse(target.root).root||inside(registry.workspace.root,target.root)||inside(target.root,registry.workspace.root)||!validPlacementIdentity(target.identity)||!validPlacementIdentity(target.parentIdentity)||typeof target.parentRelative!=='string')throw new AppError('STORAGE_MOVE_STATE');
 const scope=workspaceMoveScope(registry,value),parent=target.parentRelative?nestedRenameRoot(target.root,target.parentRelative):target.root;
 if(path.dirname(scope.destination)!==parent||path.basename(scope.source)!==path.basename(scope.destination)||value.placement.parentId===null&&target.parentRelative!==''||value.placement.parentId!==null&&target.parentRelative==='')throw new AppError('STORAGE_MOVE_STATE');
 if(value.ownerDirectoryVersion!==undefined){if(!validNativeRelocation(value)||['projects','rootBooks','entries','transfer','projectKeysHash'].some(key=>value[key]!==undefined))throw new AppError('STORAGE_MOVE_STATE');return value;}
 validateRenameProjects(value.projects??[]);if(value.projects?.length&&(!hash(value.projectKeysHash)||!hash(value.projectRegistryRevision)))throw new AppError('STORAGE_MOVE_STATE');
 if(!value.rootBooks||typeof value.rootBooks!=='object')throw new AppError('STORAGE_MOVE_STATE');
 if(value.rootBooks.books!==undefined){validateRenameBooks(value.rootBooks.books);if(!hash(value.rootBooks.bookKeysHash)||!hash(value.rootBooks.bookRegistryRevision))throw new AppError('STORAGE_MOVE_STATE');}
 const phase=value.version===1&&['registered','departing','departed'].includes(value.phase)?'moved':['departing','departed'].includes(value.phase)?'complete':value.phase;
 if(!validProjectPlacementTransfer({...value,phase}))throw new AppError('STORAGE_MOVE_STATE');
 if(!Array.isArray(value.entries)||value.entries.length!==(value.projects?.length??0)+1)throw new AppError('STORAGE_MOVE_STATE');
 const expected=[{projectId,namespaceId:value.namespaceId,vaultId:value.vaultId,relative:''},...(value.projects??[])];
 for(const [index,entry] of value.entries.entries()){
  const owner=expected[index];if(!exact(entry,'namespaceId,parentId,projectId,relative,summary,vaultId')||!summary(entry.summary)||['projectId','namespaceId','vaultId','relative'].some(key=>entry[key]!==owner[key])||entry.parentId!==null&&!researchId(entry.parentId)||index===0&&entry.parentId!==value.parentId)throw new AppError('STORAGE_MOVE_STATE');
 }
 validateProjectTree({version:1,projectId,namespaceId:value.namespaceId,vaultId:value.vaultId,projects:value.entries.slice(1).map(({summary,...entry})=>entry)});
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
