// A project move freezes its book owners together and keeps encrypted recovery
// capabilities at the verified destination until source retirement completes.
import path from 'node:path';
import {unlink,readFile} from 'node:fs/promises';
import {ProjectBookOwners} from './project-book-owners.js';
import {LabBookStorage} from './lab-book-storage.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {saveOwnerKeys,loadOwnerKeys,MOVE_BOOK_KEYS_FILE} from './owned-operation-keys.js';
import {validateRenameBooks} from './rename-owner-receipts.js';
import {databaseRetention,validDatabaseRetention,verifyDatabaseRetention} from './workspace-database-retention.js';
import {catalogueBinding} from './postgres-activation.js';
import {labBookTransferReceipt} from './lab-book-transfer.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {assertRegular,digest} from './storage.js';
import {databaseProvider} from './workspace-database-context.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {assertLabBookDatabaseStopped} from './lab-book-postgres.js';
import {ownedMoveSource} from './workspace-move-state.js';
import {researchId} from './web/research-reference.js';
import {operationStage,operationItem,operationAdvance} from './operation-progress.js';
import {AppError} from './errors.js';
export function validateMoveBooks(value){
 const books=validateRenameBooks(value.books??[]);
 if(!books.length){if(value.bookRetention!==undefined||value.bookKeysHash!==undefined)throw new AppError('STORAGE_MOVE_STATE');return;}
 if(!/^[a-f0-9]{64}$/.test(value.bookKeysHash??'')||!Array.isArray(value.bookRetention)||value.bookRetention.length!==books.length)throw new AppError('STORAGE_MOVE_STATE');
 for(const [i,item] of value.bookRetention.entries())if(item?.labBookId!==books[i].labBookId||![item.sourceId,item.destinationId,item.transferId].every(researchId)||!validDatabaseRetention(item.retention))throw new AppError('STORAGE_MOVE_STATE');
}
export class ProjectBookMove extends ProjectBookOwners{
 constructor(project){super(project,{busyCode:'STORAGE_PROJECT_BUSY',missingAccessCode:'ACCESS_LOCKED'});}
 async persist(target,value,owners){
  if(!owners.books.length)return;
  value.books=owners.books;value.bookRetention=[];
  for(const book of owners.books){
   const source=await owners.checked(book),destination=new LabBookStorage(path.join(target.root,book.directory),book.labBookId,owners.keys.get(book.labBookId)),receipt=await labBookTransferReceipt(destination),binding=await catalogueBinding(destination.root),original=await catalogueBinding(source.root);
   if(receipt?.phase!=='verified'||receipt.source!==source.root||receipt.namespaceId!==book.namespaceId||receipt.sourceId!==original.id||binding?.placement!=='lab-book'||binding.labBookId!==book.labBookId)throw new AppError('STORAGE_MOVE_STATE');
   value.bookRetention.push({labBookId:book.labBookId,sourceId:original.id,destinationId:binding.id,transferId:receipt.id,retention:await source.catalogue(store=>databaseRetention(store.db))});
  }
  value.bookKeysHash=await saveOwnerKeys(target,value.id,owners.keys,MOVE_BOOK_KEYS_FILE);
 }
 async load(target,value){
  validateMoveBooks(value);this.books=value.books??[];
  if(!this.books.length)return;
  this.keys=await loadOwnerKeys(target,value.id,value.bookKeysHash,MOVE_BOOK_KEYS_FILE);
  if(this.keys.size!==this.books.length||this.books.some(book=>this.keys.get(book.labBookId)?.id!==book.vaultId))throw new AppError('STORAGE_MOVE_STATE');
 }
 async verify(target,value){
  const registry=new LabBookRegistry(target);
  for(const [i,book] of this.books.entries()){
   const entry=await registry.locate(book.labBookId),saved=value.bookRetention[i];
   if(entry.directory!==book.directory||entry.namespaceId!==book.namespaceId||entry.vaultId!==book.vaultId)throw new AppError('STORAGE_MOVE_STATE');
   const storage=new LabBookStorage(entry.root,book.labBookId,this.keys.get(book.labBookId)),binding=await catalogueBinding(entry.root),receipt=await labBookTransferReceipt(storage);
   authenticateKeyring((await readAccess(entry.root)).value,storage.vault);
   if(binding?.placement!=='lab-book'||binding.labBookId!==book.labBookId||binding.id!==saved.destinationId||receipt?.id!==saved.transferId||receipt.phase!=='verified'||(await storage.outline()).metadata.id!==book.namespaceId)throw new AppError('STORAGE_MOVE_STATE');
   await verifyDatabaseRetention(storage,saved.retention);
  }
 }
 async stop(value,{checkpoint=async()=>{}}={}){
  if(!this.books.length)return;
  return operationStage('move-book-databases',{unit:'books',total:this.books.length},async()=>{
   for(const [i,book] of this.books.entries()){
    operationItem(book.directory);const storage=await this.checked(book),binding=await catalogueBinding(storage.root),marker=await ownedMoveSource(storage.root);
    if(binding.id!==value.bookRetention[i].sourceId||marker?.id!==value.id||marker.destination!==path.join(value.destination,book.directory))throw new AppError('STORAGE_MOVE_STATE');
    const provider=databaseProvider();if(!provider?.stopLabBookForMove)throw new AppError('DATABASE_RUNTIME');
    await provider.stopLabBookForMove(storage.root,book.labBookId,storage.vault,value.id);
    const lease=await workspaceDatabaseLease(path.join(storage.root,'.observanda/postgresql'));
    try{await assertLabBookDatabaseStopped(storage.root,book.labBookId,storage.vault);}finally{await lease.close();}
    await checkpoint('book-stopped',book.labBookId);operationAdvance();
   }
  });
 }
}
export async function clearMoveBookKeys(target,value){
 if(!value.bookKeysHash)return;
 const file=path.join(target.root,MOVE_BOOK_KEYS_FILE);if(!await assertRegular(file,{missing:true}))return;
 if(digest(await readFile(file))!==value.bookKeysHash)throw new AppError('STORAGE_MOVE_STATE');await unlink(file);
}
