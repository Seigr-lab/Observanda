import {nestedRenameRoot} from './workspace-rename-paths.js';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {AsyncLocalStorage} from 'node:async_hooks';
import {assertRegular} from './storage.js';
import {AppError} from './errors.js';
export const RENAME_MARKER='.observanda/rename.observanda';
const scope=new AsyncLocalStorage();
export const renameScope=(id,operation)=>scope.run(id,operation);
export async function workspaceRename(root){
 const file=path.join(root,RENAME_MARKER),stat=await assertRegular(file,{missing:true});if(!stat)return null;
 if(stat.size>16384)throw new AppError('STORAGE_RENAME_STATE');
 let value;try{value=JSON.parse(await readFile(file,'utf8'));}catch{throw new AppError('STORAGE_RENAME_STATE');}
 if(![1,2,3].includes(value?.version)||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.id??'')||![value.source,value.destination].every(p=>typeof p==='string'&&path.isAbsolute(p)&&path.resolve(p)===p&&p!==path.parse(p).root)||![value.source,value.destination].includes(root))throw new AppError('STORAGE_RENAME_STATE');
 if(value.placement!==undefined&&value.placement!==true)throw new AppError('STORAGE_RENAME_STATE');
 if(value.placement){const source=value.version===1?value.source:value.parentSource,destination=value.version===1?value.destination:value.parentDestination;if(typeof source!=='string'||typeof destination!=='string'||source===destination||destination.startsWith(source+path.sep)||source.startsWith(destination+path.sep))throw new AppError('STORAGE_RENAME_STATE');}
 if(value.version===1){if(!value.placement&&path.dirname(value.source)!==path.dirname(value.destination))throw new AppError('STORAGE_RENAME_STATE');}
 else{
  if(value.version===3&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.labBookId??''))throw new AppError('STORAGE_RENAME_STATE');
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.projectId??'')||![value.parentSource,value.parentDestination].every(p=>typeof p==='string'&&path.isAbsolute(p)&&path.resolve(p)===p&&p!==path.parse(p).root)||!value.placement&&path.dirname(value.parentSource)!==path.dirname(value.parentDestination)||value.parentSource===value.parentDestination||value.source!==nestedRenameRoot(value.parentSource,value.relative)||value.destination!==nestedRenameRoot(value.parentDestination,value.relative))throw new AppError('STORAGE_RENAME_STATE');
 }
 return value;
}
export async function assertNotRenaming(root){
 // A contained owner also observes its parents' handoff. This closes admission
 // through a second application while the parent freezes individual databases.
 for(let current=root;;){
  const parent=path.dirname(current),checks=await Promise.allSettled([workspaceRename(current),parent===current?null:assertRegular(path.join(parent,'.observanda'),{directory:true,missing:true})]);
  if(checks[0].status==='rejected')throw checks[0].reason;
  const pending=checks[0].value;if(pending&&scope.getStore()!==pending.id)throw new AppError('STORAGE_RENAMING');
  if(checks[1].status==='rejected')throw checks[1].reason;
  if(parent===current||!checks[1].value)return;current=parent;
 }
}
