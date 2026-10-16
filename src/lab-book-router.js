import {bookPlacementPending} from './lab-book-placement-state.js';
import {readLabBookArchiveIdentity} from './lab-book-archive.js';
import {LabBookStorage} from './lab-book-storage.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {catalogueBinding} from './postgres-activation.js';
import {AppError} from './errors.js';
export class LabBookRouter{
 constructor(registry,{authorize,unlock}){if(typeof authorize!=='function'||typeof unlock!=='function')throw new AppError('INVALID');this.registry=registry;this.authorize=authorize;this.unlock=unlock;}
 async withLabBook(labBookId,operation,{action='read'}={}){
  if(!['read','write'].includes(action)||typeof operation!=='function')throw new AppError('INVALID');
  if(await this.authorize({labBookId,action})!==true)throw new AppError('ACCESS_DENIED');
  if((await bookPlacementPending(this.registry.project,labBookId))?.kind==='import')throw new AppError('LAB_BOOK_IMPORT_PENDING');
  const entry=await this.registry.locate(labBookId),binding=await catalogueBinding(entry.root),access=await readAccess(entry.root);
  if(binding&&(binding.placement!=='lab-book'||binding.labBookId!==labBookId)||access.value.formatVersion!==3||access.value.vaultId!==entry.vaultId)throw new AppError('DATABASE_LOCATION');
  const vault=await this.unlock(entry,access);if(!vault?.key)throw new AppError('ACCESS_LOCKED');authenticateKeyring(access.value,vault);
  if(!binding){const identity=await readLabBookArchiveIdentity(entry.root,vault);if(identity.labBookId!==labBookId||identity.namespaceId!==entry.namespaceId)throw new AppError('DATABASE_LOCATION');}
  const storage=new LabBookStorage(entry.root,labBookId,vault),outline=await storage.outline();
  if(outline.metadata.id!==entry.namespaceId||outline.metadata.notebooks[0].projectId!==this.registry.project.projectId||outline.metadata.notebooks[0].title!==entry.directory)throw new AppError('DATABASE_LOCATION');
  return operation(storage,outline);
 }
}
