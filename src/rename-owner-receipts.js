// Receipt shape validation has no database runtime dependencies.
import path from 'node:path';
import {nestedRenameRoot} from './workspace-rename-paths.js';
import {validateStorageName} from './storage-names.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export function validateRenameBooks(value){
 if(!Array.isArray(value)||value.length>50000)throw new AppError('STORAGE_RENAME_STATE');
 const ids=new Set(),names=new Set();
 for(const item of value){
  if(!item||Object.keys(item).sort().join()!=='accessHash,directory,identity,labBookId,namespaceId,vaultId'||![item.labBookId,item.namespaceId,item.vaultId].every(researchId)||ids.has(item.labBookId)||names.has(item.directory)||!item.identity||Object.keys(item.identity).sort().join()!=='dev,ino'||Object.values(item.identity).some(part=>typeof part!=='string')||!/^[a-f0-9]{64}$/.test(item.accessHash??''))throw new AppError('STORAGE_RENAME_STATE');
  validateStorageName(item.directory,{nameError:'STORAGE_RENAME_STATE'});if(item.directory.toLowerCase()==='.observanda')throw new AppError('STORAGE_RENAME_STATE');ids.add(item.labBookId);names.add(item.directory);
 }
 return value;
}
export function validateRenameProjects(value){
 if(!Array.isArray(value)||value.length>50000)throw new AppError('STORAGE_RENAME_STATE');
 const ids=new Set(),paths=new Set();
 for(const item of value){
  nestedRenameRoot(path.resolve('.'),item.relative);
  if(![item.projectId,item.namespaceId,item.vaultId].every(researchId)||ids.has(item.projectId)||paths.has(item.relative)||!item.identity||!['dev','ino'].every(key=>typeof item.identity[key]==='string')||!/^[a-f0-9]{64}$/.test(item.accessHash??''))throw new AppError('STORAGE_RENAME_STATE');
  if(item.books!==undefined){validateRenameBooks(item.books);if(!/^[a-f0-9]{64}$/.test(item.bookKeysHash??'')||!/^[a-f0-9]{64}$/.test(item.bookRegistryRevision??''))throw new AppError('STORAGE_RENAME_STATE');}
  ids.add(item.projectId);paths.add(item.relative);
 }
 return value;
}
