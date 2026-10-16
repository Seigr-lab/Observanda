// An encrypted identity accompanies a portable lab-book archive. It identifies
// the independent owner before its database is restored on another installation.
import path from 'node:path';
import {Workspace,assertRegular,serialize} from './storage.js';
import {hashWorkspaceFile} from './workspace-inventory.js';
import {CATALOGUE_ARCHIVE} from './postgres-activation.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export const LAB_BOOK_ARCHIVE_IDENTITY='.observanda/lab-book-archive.observanda';
const file=LAB_BOOK_ARCHIVE_IDENTITY;
export async function writeLabBookArchiveIdentity(storage,{namespaceId,archiveDigest}){
 await storage.writeFile(path.join(storage.root,file),serialize({version:1,labBookId:storage.labBookId,namespaceId,vaultId:storage.vault.id,archiveDigest}));
}
export async function readLabBookArchiveIdentity(root,vault,{verify=true}={}){
 const storage=new Workspace(root,vault),stat=await assertRegular(path.join(root,file),{missing:true});if(!stat)throw new AppError('LAB_BOOK_FOLDER');if(stat.size>2048)throw new AppError('STORAGE_COPY');
 let value;try{value=JSON.parse(await storage.readFile(path.join(root,file),'utf8'));}catch{throw new AppError('STORAGE_COPY');}
 if(value?.version!==1||Object.keys(value).sort().join()!=='archiveDigest,labBookId,namespaceId,vaultId,version'||!['labBookId','namespaceId','vaultId'].every(key=>researchId(value[key]))||value.vaultId!==vault?.id||!/^[a-f0-9]{64}$/.test(value.archiveDigest))throw new AppError('STORAGE_COPY');
 if(verify&&await hashWorkspaceFile(path.join(root,CATALOGUE_ARCHIVE))!==value.archiveDigest)throw new AppError('STORAGE_COPY');return value;
}
