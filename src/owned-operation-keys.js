// Short-lived child-owner capabilities for authorized parent lifecycle commands.
// There is deliberately no plaintext or unencrypted-workspace write path.
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {seal,unseal,clearVault} from './encryption.js';
import {assertRegular,atomicWrite,digest} from './storage.js';
import {AppError} from './errors.js';
export const RENAME_KEYS_FILE='.observanda/rename-project-keys.observanda';
export const DELETE_PROJECT_KEYS_FILE='.observanda/delete-project-keys.observanda';
export const MOVE_BOOK_KEYS_FILE='.observanda/move-book-keys.observanda';
export const DELETE_BOOK_KEYS_FILE='.observanda/delete-book-keys.observanda';
export const RENAME_BOOK_KEYS_FILE='.observanda/rename-book-keys.observanda';
function keyFile(workspace,file){if(![RENAME_KEYS_FILE,RENAME_BOOK_KEYS_FILE,DELETE_BOOK_KEYS_FILE,DELETE_PROJECT_KEYS_FILE,MOVE_BOOK_KEYS_FILE].includes(file))throw new AppError('INVALID');return path.join(workspace.root,file);}
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const width=104,limit=50000;
function authority(workspace,id,file){
 if(!uuid(id)||!uuid(workspace.vault?.id)||!Buffer.isBuffer(workspace.vault?.key)||workspace.vault.key.length!==32)throw new AppError('ACCESS_LOCKED');
 return (file===MOVE_BOOK_KEYS_FILE?'Observanda/project-book-move/v1/':file===DELETE_PROJECT_KEYS_FILE?'Observanda/workspace-project-deletion/v1/':file===DELETE_BOOK_KEYS_FILE?'Observanda/project-book-deletion/v1/':'Observanda/workspace-project-rename/v1/')+workspace.vault.id+'/'+id;
}
export async function saveOwnerKeys(workspace,id,keys,file=RENAME_KEYS_FILE){
 const aad=authority(workspace,id,file);if(!(keys instanceof Map)||!keys.size||keys.size>limit)throw new AppError('INVALID');
 const plain=Buffer.alloc(4+keys.size*width);plain.writeUInt32BE(keys.size);let offset=4;
 try{
  for(const [projectId,vault] of keys){
   if(!uuid(projectId)||!uuid(vault?.id)||!Buffer.isBuffer(vault.key)||vault.key.length!==32)throw new AppError('ACCESS_LOCKED');
   plain.write(projectId,offset,36,'ascii');plain.write(vault.id,offset+36,36,'ascii');vault.key.copy(plain,offset+72);offset+=width;
  }
  const encrypted=seal(plain,workspace.vault.key,aad);
  await atomicWrite(keyFile(workspace,file),encrypted);return digest(encrypted);
 }finally{plain.fill(0);}
}
export async function loadOwnerKeys(workspace,id,expected,selectedFile=RENAME_KEYS_FILE){
 const aad=authority(workspace,id,selectedFile),file=keyFile(workspace,selectedFile),stat=await assertRegular(file);
 if(stat.size>4+limit*width+36||!/^([a-f0-9]{64})$/.test(expected??''))throw new AppError('STORAGE_RENAME_STATE');
 const encrypted=await readFile(file);if(digest(encrypted)!==expected)throw new AppError('STORAGE_RENAME_STATE');
 const plain=unseal(encrypted,workspace.vault.key,aad),keys=new Map();
 try{
  if(plain.length<4)throw new AppError('STORAGE_RENAME_STATE');const count=plain.readUInt32BE();
  if(!count||count>limit||plain.length!==4+count*width)throw new AppError('STORAGE_RENAME_STATE');
  for(let offset=4;offset<plain.length;offset+=width){
   const projectId=plain.toString('ascii',offset,offset+36),vaultId=plain.toString('ascii',offset+36,offset+72);
   if(!uuid(projectId)||!uuid(vaultId)||keys.has(projectId))throw new AppError('STORAGE_RENAME_STATE');
   keys.set(projectId,{id:vaultId,key:Buffer.from(plain.subarray(offset+72,offset+width))});
  }
  return keys;
 }catch(error){for(const key of keys.values())clearVault(key);throw error;}
 finally{plain.fill(0);}
}
