import {ProjectBookCopy} from './project-book-copy.js';
import {ProjectStorage} from './project-storage.js';
import {ownedStorageTransfer} from './owned-storage-transfer.js';
import {PROJECT_ARCHIVE_IDENTITY,readProjectArchiveIdentity,writeProjectArchiveIdentity} from './project-archive.js';
const transfer=ownedStorageTransfer({Storage:ProjectStorage,placement:'project',ownerId:'projectId',archiveFile:PROJECT_ARCHIVE_IDENTITY,readArchive:readProjectArchiveIdentity,writeArchive:writeProjectArchiveIdentity});
export async function copyProjectLocation(source,input,options={}){
 const books=new ProjectBookCopy(source);
 try{
  await books.prepare(options.withBook,{portable:options.portable});
  return await books.using(()=>transfer.copy(source,input,{...options,...(options.afterVerified?{afterVerified:(target,receipt)=>options.afterVerified(target,receipt,books)}:{}),onVerified:async(target,receipt)=>{await books.copied(target,receipt,options);if(options.onVerified)await options.onVerified(target,receipt);},beforeVerified:async(target,receipt,save)=>{await books.copy(target,receipt,save,options);if(options.beforeVerified)await options.beforeVerified(target,receipt,save);}}),{holdBooks:!!options.afterVerified});
 }finally{books.close();}
}
export const projectTransferReceipt=transfer.receipt;
export const verifyProjectTransfer=transfer.verify;

// The tree importer composes all owners itself, including mixed native/archive books.
export const copyProjectOwnerLocation=transfer.copy;
