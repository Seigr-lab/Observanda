// Deleting a project includes its authenticated book owners. Recovery retains
// bounded, encrypted child capabilities only until the containing folder is gone.
import path from 'node:path';
import {ProjectBookOwners} from './project-book-owners.js';
import {saveOwnerKeys,loadOwnerKeys,DELETE_BOOK_KEYS_FILE} from './owned-operation-keys.js';
import {validateRenameBooks} from './rename-owner-receipts.js';
import {DELETE_MARKER,workspaceDeletion} from './workspace-delete-state.js';
import {assertRegular,atomicWrite,serialize} from './storage.js';
import {databaseProvider} from './workspace-database-context.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {assertLabBookDatabaseStopped} from './lab-book-postgres.js';
import {operationStage,operationAdvance,operationItem} from './operation-progress.js';
import {AppError} from './errors.js';
export class ProjectBookDeletion extends ProjectBookOwners{
 constructor(project){super(project,{busyCode:'STORAGE_DELETE_BUSY',missingAccessCode:'ACCESS_LOCKED'});}
 async persist(id,value){
  await this.ready();if((await this.registry.read()).revision!==this.revision)throw new AppError('CONFLICT');
  if(!this.books.length)return;value.books=this.books;value.bookRegistryRevision=this.revision;
  if(this.books.length)value.bookKeysHash=await saveOwnerKeys(this.project,id,this.keys,DELETE_BOOK_KEYS_FILE);
 }
 async load(value){
  this.books=validateRenameBooks(value.books??[]);if(!this.books.length)return;
  if((await this.registry.read()).revision!==value.bookRegistryRevision)throw new AppError('STORAGE_DELETE_STATE');
  this.keys=await loadOwnerKeys(this.project,value.id,value.bookKeysHash,DELETE_BOOK_KEYS_FILE);
  if(this.keys.size!==this.books.length||this.books.some(book=>this.keys.get(book.labBookId)?.id!==book.vaultId))throw new AppError('STORAGE_DELETE_STATE');
 }
 async stop(value,{checkpoint=async()=>{}}={}){
  if(!this.books.length)return;
  return operationStage('delete-book-databases',{unit:'books',total:this.books.length},async()=>{
   for(const item of this.books){
    operationItem(item.directory);const storage=await this.checked(item),marker={version:1,id:value.id,source:storage.root},prior=await workspaceDeletion(storage.root);
    if(prior&&serialize(prior)!==serialize(marker))throw new AppError('STORAGE_DELETE_STATE');
    if(!prior)await atomicWrite(path.join(storage.root,DELETE_MARKER),serialize(marker));
    await checkpoint('book-frozen',value,item.labBookId);
    const provider=databaseProvider();if(!provider?.stopLabBookForDeletion)throw new AppError('DATABASE_LOCATION');
    await provider.stopLabBookForDeletion(storage.root,item.labBookId,storage.vault,value.id);
    const lease=await workspaceDatabaseLease(path.join(storage.root,'.observanda/postgresql'));
    try{await assertLabBookDatabaseStopped(storage.root,item.labBookId,storage.vault);}finally{await lease.close();}
    await checkpoint('book-stopped',value,item.labBookId);operationAdvance();
   }
  });
 }
}
