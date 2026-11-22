// A selected project owns its files, not independently registered descendants.
import path from 'node:path';
import {readdir,lstat,realpath} from 'node:fs/promises';
import {assertRegular,workspaceFile} from './storage.js';
import {AppError} from './errors.js';
export const protectsDirectory=(boundaries,relative)=>boundaries.some(child=>child===relative||child.startsWith(relative+'/'));
export async function projectMoveDirectory(root){
 await assertRegular(root,{directory:true});if(await realpath(root)!==root)throw new AppError('UNSAFE');
 const stat=await lstat(root,{bigint:true});if(stat.ino===0n)throw new AppError('STORAGE_MOVE_STATE');return {dev:String(stat.dev),ino:String(stat.ino)};
}
export async function assertProjectMoveDirectory(root,expected){
 const current=await projectMoveDirectory(root);if(!expected||current.dev!==expected.dev||current.ino!==expected.ino)throw new AppError('STORAGE_MOVE_STATE');
}
export async function ownedProjectFolder(root,boundaries=[],books=[]){
 if(root===path.parse(root).root||await realpath(root)!==root)throw new AppError('STORAGE_PATH');
 if(boundaries.some(relative=>['.observanda/postgresql','.observanda/database-transition'].some(engine=>relative===engine||relative.startsWith(engine+'/'))))throw new AppError('STORAGE_PATH');
 const descriptor=path.basename(await workspaceFile(root)),bookNames=new Set(books.map(book=>book.directory));
 async function container(relative){
  await assertRegular(path.join(root,relative),{directory:true});if(boundaries.includes(relative))return;
  for(const name of await readdir(path.join(root,relative))){const child=path.posix.join(relative,name);if(!protectsDirectory(boundaries,child))throw new AppError('STORAGE_MOVE_CONTENTS');await container(child);}
 }
 for(const name of await readdir(root))if(!['.observanda',descriptor].includes(name)){
  if(bookNames.has(name)){await assertRegular(path.join(root,name),{directory:true});continue;}
  if(!protectsDirectory(boundaries,name))throw new AppError('STORAGE_MOVE_CONTENTS');await container(name);
 }
}
