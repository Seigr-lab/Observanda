import {workspaceProjectMoveLocation} from './project-workspace-move-location.js';
import {validProjectPlacementTransfer} from './project-placement-transfer-state.js';
import {projectMoveDirectory} from './project-move-boundaries.js';
import {validProjectPlacement} from './project-placement.js';
import {workspaceRename} from './workspace-rename-state.js';
// Project location receipts use workspace-relative names and authenticated storage.
import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {assertRegular,digest} from './storage.js';
import {researchId} from './web/research-reference.js';
import {nestedRenameRoot} from './workspace-rename-paths.js';
import {validateRenameProjects,validateRenameBooks} from './rename-owner-receipts.js';
import {AppError} from './errors.js';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const validProjectRenameSettings=value=>value&&['etag,project','etag,input,project','checkpoint,etag,input,project'].includes(Object.keys(value).sort().join())&&hash(value.etag)&&(!Object.hasOwn(value,'input')||hash(value.input))&&(!Object.hasOwn(value,'checkpoint')||value.checkpoint&&Object.keys(value.checkpoint).sort().join()==='id,revision'&&researchId(value.checkpoint.id)&&hash(value.checkpoint.revision));
export const directoryIdentity=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
export const sameDirectory=(a,b)=>a?.dev===b?.dev&&a?.ino===b?.ino;
export function projectRenameFile(registry,id){if(!researchId(id))throw new AppError('INVALID');return path.join(registry.workspace.root,'.observanda/project-renames',id+'.obsv');}
export async function readProjectRename(registry,projectId){
 const file=projectRenameFile(registry,projectId),stat=await assertRegular(file,{missing:true});if(!stat)return null;if(stat.size>16*1024*1024)throw new AppError('STORAGE_RENAME_STATE');
 let value;try{value=JSON.parse(await registry.workspace.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_RENAME_STATE');}
 if(![1,2].includes(value?.version)||value.projectId!==projectId||![value.id,value.projectId,value.namespaceId,value.vaultId].every(researchId)||!['prepared','frozen','copying','moved','registered','retiring','retired','complete','cancelling','cancelled'].includes(value.phase)||!['dev','ino'].every(k=>typeof value.identity?.[k]==='string')||![value.accessHash,value.descriptorHash].every(hash)||value.parentId!==null&&!researchId(value.parentId))throw new AppError('STORAGE_RENAME_STATE');
 if(value.cancelReason!==undefined&&(value.cancelReason!=='volume'||!['cancelling','cancelled'].includes(value.phase)))throw new AppError('STORAGE_RENAME_STATE');
 const source=nestedRenameRoot(registry.workspace.root,value.source),destination=nestedRenameRoot(registry.workspace.root,value.destination);
 if(value.settings!==undefined&&value.settings!==null&&(!validProjectRenameSettings(value.settings)||value.settings.project?.id!==projectId||value.settings.project.title!==path.basename(destination)||value.settings.project.parentId!=null))throw new AppError('STORAGE_RENAME_STATE');
 if(value.placement!==undefined&&(!validProjectPlacement(value.placement)||value.placement.expectedParentId!==value.parentId||typeof value.placementParent?.relative!=='string'||Object.keys(value.placementParent).sort().join()!=='dev,ino,relative'||path.dirname(destination)!==(value.placementParent.relative?nestedRenameRoot(registry.workspace.root,value.placementParent.relative):registry.workspace.root)||!['dev','ino'].every(key=>typeof value.placementParent?.[key]==='string')||path.basename(source)!==path.basename(destination)))throw new AppError('STORAGE_RENAME_STATE');
 if(source===destination||destination.startsWith(source+path.sep)||source.startsWith(destination+path.sep)||!value.placement&&path.dirname(source)!==path.dirname(destination))throw new AppError('STORAGE_RENAME_STATE');
 validateRenameProjects(value.projects??[]);if(value.projects?.length&&(!hash(value.projectKeysHash)||!hash(value.projectRegistryRevision)))throw new AppError('STORAGE_RENAME_STATE');
 if(!value.rootBooks||typeof value.rootBooks!=='object')throw new AppError('STORAGE_RENAME_STATE');
 if(value.rootBooks.books!==undefined){validateRenameBooks(value.rootBooks.books);if(!hash(value.rootBooks.bookKeysHash)||!hash(value.rootBooks.bookRegistryRevision))throw new AppError('STORAGE_RENAME_STATE');}
 if(!validProjectPlacementTransfer(value))throw new AppError('STORAGE_RENAME_STATE');
 return value;
}
export async function locateProjectRename(registry,value){
 const transferred=value.version===2,owner=transferred?value.transfer.owners.find(item=>item.relative===''):null;
 for(const relative of transferred?[value.phase==='copying'?value.source:value.destination]:[value.destination,value.source]){
  const root=nestedRenameRoot(registry.workspace.root,relative),stat=await assertRegular(root,{directory:true,missing:true});
  if(!stat||!sameDirectory(transferred?await projectMoveDirectory(root):directoryIdentity(stat),transferred?(relative===value.source?owner.sourceIdentity:owner.destinationIdentity):value.identity)||await realpath(root)!==root)continue;
  if(digest(await readFile(path.join(root,'.observanda/access.json')))!==value.accessHash&&!(value.phase==='prepared'&&relative===value.source&&!await workspaceRename(root)))throw new AppError('STORAGE_RENAME_STATE');return root;
 }
 throw new AppError('STORAGE_RENAME_STATE');
}

export async function pendingProjectRename(registry,projectId,projects){
 projects??=(await registry.read()).value.projects;const seen=new Set();
 for(let id=projectId;id!==null;){
  if(seen.has(id))throw new AppError('FORMAT');seen.add(id);const entry=projects.find(p=>p.projectId===id);if(!entry)return null;
  const value=await readProjectRename(registry,id);
  if(value&&value.phase!=='cancelled'&&(value.phase!=='complete'||(await workspaceRename(entry.root))?.id===value.id))return value;
  id=entry.parentId;
 }
 return null;
}
export async function projectRenameLocation(registry,entry,projects){
 const value=await pendingProjectRename(registry,entry.projectId,projects);if(!value)return workspaceProjectMoveLocation(registry,entry,projects);
 const source=nestedRenameRoot(registry.workspace.root,value.source),destination=nestedRenameRoot(registry.workspace.root,value.destination),root=await locateProjectRename(registry,value);
 const prefix=[source,destination].find(parent=>entry.root===parent||entry.root.startsWith(parent+path.sep));if(!prefix)throw new AppError('STORAGE_RENAME_STATE');
 return {...entry,root:path.join(root,path.relative(prefix,entry.root))};
}
