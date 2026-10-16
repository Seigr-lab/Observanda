import {LAB_BOOK_ARCHIVE_IDENTITY} from './lab-book-archive.js';
import {ownedStorageLeaseFile} from './owned-storage-control.js';
import {PROJECT_ARCHIVE_IDENTITY} from './project-archive.js';
// Retire only the selected owner. Nested child owners keep their original paths.
import path from 'node:path';
import {opendir,unlink,rmdir,realpath} from 'node:fs/promises';
import {assertRegular} from './storage.js';
import {MOVE_SOURCE,moveSource} from './workspace-move-state.js';
import {hashWorkspaceFile} from './workspace-inventory.js';
import {isStorageTemporary} from './storage-temporary.js';
import {protectsDirectory,assertProjectMoveDirectory} from './project-move-boundaries.js';
import {operationAdvance,operationItem} from './operation-progress.js';
import {AppError} from './errors.js';
const inside=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
export async function removeRetiredProject(value,{verify,checkpoint}){
 const boundaries=value.boundaries??[],nested=!!boundaries.length,root=nested?value.source:path.join(path.dirname(value.source),'.observanda-project-move-'+value.id);
 if(!await assertRegular(root,{directory:true,missing:true})){if(nested)throw new AppError('STORAGE_MOVE_STATE');return;}
 if(await realpath(path.dirname(root))!==path.dirname(root))throw new AppError('UNSAFE');
 if(nested)await assertProjectMoveDirectory(root,value.sourceDirectory);
 const marker=await moveSource(root),bookNames=new Set((value.books??[]).map(book=>book.directory));
 const ownedRelative=relative=>{const parts=relative.split('/');return bookNames.has(parts[0])?parts.slice(1).join('/'):relative;};
 if(marker&&(marker.id!==value.id||marker.destination!==value.destination))throw new AppError('STORAGE_MOVE_STATE');
 async function remove(relative,directory){
  const own=ownedRelative(relative),file=path.join(root,relative);if(!inside(root,file))throw new AppError('UNSAFE');
  const stat=await assertRegular(file,{directory,missing:true});if(!stat)return;
  if(boundaries.includes(relative)){if(!stat.isDirectory())throw new AppError('UNSAFE');return;}
  if(stat.isDirectory()){
   // An undeclared directory added after the snapshot cannot become move-owned.
   if(nested&&marker&&!protectsDirectory(boundaries,relative)&&!own.startsWith('.observanda/postgresql/')&&own!=='.observanda/postgresql'&&!await assertRegular(path.join(value.destination,relative),{directory:true,missing:true})){
    // Empty directories and lease-only directories carry no retained data.
    // Any untransferred content still prevents retirement.
    for await(const child of await opendir(file))if(!ownedStorageLeaseFile(path.posix.join(own,child.name)))throw new AppError('STORAGE_MOVE_CONTENTS');
   }
   for await(const child of await opendir(file)){const next=path.posix.join(relative,child.name);if(next!==MOVE_SOURCE)await remove(next,child.isDirectory());}
   if(relative!=='.observanda'&&!protectsDirectory(boundaries,relative))await rmdir(file);
  }else{
   // Without the marker only empty container directories may remain. This also
   // handles a crash between marker removal and the completed receipt.
   if(!marker)throw new AppError('STORAGE_MOVE_STATE');
   const internal=ownedStorageLeaseFile(own)||own.startsWith('.observanda/project-transfer-files/')||own.startsWith('.observanda/lab-book-transfer-files/')||own.startsWith('.observanda/postgresql/')||[PROJECT_ARCHIVE_IDENTITY,LAB_BOOK_ARCHIVE_IDENTITY,'.observanda/lab-book-transfer.lock','.observanda/lab-book-transfer.observanda','.observanda/lab-book-initialization.lock','.observanda/research.observanda','.observanda/write.lock','.observanda/project-retention.lock','.observanda/project-transfer.lock','.observanda/project-transfer.observanda','.observanda/project-initialization.lock'].includes(own)||isStorageTemporary(path.basename(relative));
   if((verify||nested)&&!internal&&await hashWorkspaceFile(file)!==await hashWorkspaceFile(path.join(value.destination,relative)))throw new AppError('STORAGE_COPY');
   operationItem(relative);await unlink(file);operationAdvance();await checkpoint('removed',relative);
  }
 }
 for await(const child of await opendir(root))await remove(child.name,child.isDirectory());
 if(marker){await unlink(path.join(root,MOVE_SOURCE));await checkpoint('marker-removed');}
 if(!protectsDirectory(boundaries,'.observanda'))await rmdir(path.join(root,'.observanda')).catch(error=>{if(error.code!=='ENOENT')throw error;});
 if(!nested)await rmdir(root);
}
