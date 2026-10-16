import path from 'node:path';
import {opendir,unlink} from 'node:fs/promises';
import {assertRegular,privateDirectory,serialize,digest} from './storage.js';
import {researchId} from './web/research-reference.js';
import {validateStorageName} from './storage-names.js';
import {AppError} from './errors.js';
const nameKey=name=>['win32','darwin'].includes(process.platform)?name.normalize('NFC').toLowerCase():name;
const folder=project=>path.join(project.root,'.observanda/lab-book-placements');
const pointer=(project,id)=>path.join(folder(project),id+'.pointer');
const namePointer=(project,name)=>pointer(project,'name-'+digest(nameKey(name)));
async function readPointer(project,file){
 await project.requireStorageKey();await assertRegular(path.dirname(file),{directory:true,missing:true});const stat=await assertRegular(file,{missing:true});if(!stat)return null;if(stat.size>4096)throw new AppError('STORAGE_RENAME_STATE');
 let value;try{value=JSON.parse(await project.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_RENAME_STATE');}
 if(!value||!['directory,id,labBookId','directory,id,kind,labBookId'].includes(Object.keys(value).sort().join())||value.kind!==undefined&&!['move','import'].includes(value.kind)||!researchId(value.id)||!researchId(value.labBookId))throw new AppError('STORAGE_RENAME_STATE');validateStorageName(value.directory,{nameError:'STORAGE_RENAME_STATE'});return value;
}
export async function bookPlacementPending(project,id){if(!researchId(id))throw new AppError('INVALID');return readPointer(project,pointer(project,id));}
export async function assertBookPlacementAvailable(project,id,name=null,{except=null}={}){
 const pending=await bookPlacementPending(project,id),named=name===null?null:await readPointer(project,namePointer(project,name));
 const blocked=[pending,named].find(value=>value&&value.id!==except);if(blocked)throw new AppError(blocked.kind==='import'?'LAB_BOOK_IMPORT_PENDING':'LAB_BOOK_MOVE_PENDING');
}
export async function assertProjectBookPlacementsComplete(project){
 const directory=folder(project);if(!await assertRegular(directory,{directory:true,missing:true}))return;
 for await(const item of await opendir(directory))if(item.name.endsWith('.pointer')){const pending=await readPointer(project,path.join(directory,item.name));throw new AppError(pending.kind==='import'?'LAB_BOOK_IMPORT_PENDING':'LAB_BOOK_MOVE_PENDING');}
}
export async function reserveBookPlacement(project,value){
 await assertBookPlacementAvailable(project,value.labBookId,value.directory,{except:value.id});await privateDirectory(project.root,'.observanda/lab-book-placements');
 const bytes=serialize({id:value.id,labBookId:value.labBookId,directory:value.directory,...(value.kind?{kind:value.kind}:{})});await project.writeFile(pointer(project,value.labBookId),bytes);await project.writeFile(namePointer(project,value.directory),bytes);
}
export async function releaseBookPlacement(project,value){
 for(const file of [namePointer(project,value.directory),pointer(project,value.labBookId)]){const pending=await readPointer(project,file);if(pending?.id===value.id)await unlink(file);}
}
