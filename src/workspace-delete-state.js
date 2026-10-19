import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
const scope=new AsyncLocalStorage();
export const deletionScope=(id,operation)=>scope.run(id,operation);
import {readFile} from 'node:fs/promises';
import {assertRegular} from './storage.js';
import {AppError} from './errors.js';

export const DELETE_MARKER='.observanda/delete-workspace.json';
export async function workspaceDeletion(root){
 if(!root)return null;
 const file=path.join(root,DELETE_MARKER),stat=await assertRegular(file,{missing:true});if(!stat)return null;
 if(stat.size>16384)throw new AppError('STORAGE_DELETE_STATE');
 let value;try{value=JSON.parse(await readFile(file,'utf8'));}catch{throw new AppError('STORAGE_DELETE_STATE');}
 if(value?.version!==1||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.id)||!path.isAbsolute(value.source??''))throw new AppError('STORAGE_DELETE_STATE');return value;
}
export async function assertNotDeleting(root,id){
 // A parent fence closes admission to its dedicated descendants as well.
 for(let current=root;;){
  const parent=path.dirname(current),checks=await Promise.allSettled([workspaceDeletion(current),parent===current?null:assertRegular(path.join(parent,'.observanda'),{directory:true,missing:true})]);
  if(checks[0].status==='rejected')throw checks[0].reason;
  const state=checks[0].value;if(state&&state.id!==(id??scope.getStore()))throw new AppError('STORAGE_DELETING');
  if(checks[1].status==='rejected')throw checks[1].reason;
  if(parent===current||!checks[1].value)return;current=parent;
 }
}
