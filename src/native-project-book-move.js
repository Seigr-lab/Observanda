// A selected project moves only its immediate independently keyed books.
// Native metadata and temporary recovery capabilities are paged separately.
import path from 'node:path';
import {readFile,realpath,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {NativePortabilityCollection,createPortabilityCollection,portabilityCollection,releasePortabilityCollection} from './portability-collection.js';
import {captureProjectBookCopyDirectory,withProjectBookCopyDirectory} from './native-project-book-copy.js';
import {ProjectBookOwners} from './project-book-owners.js';
import {ProjectStorage} from './project-storage.js';
import {LabBookStorage} from './lab-book-storage.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {copyLabBookLocation,labBookTransferReceipt} from './lab-book-transfer.js';
import {workspaceCopyTransferId} from './workspace-copy-directory.js';
import {catalogueBinding} from './postgres-activation.js';
import {databaseRetention,validDatabaseRetention,verifyDatabaseRetention} from './workspace-database-retention.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {clearVault} from './encryption.js';
import {assertRegular,atomicWrite,privateDirectory,digest,serialize} from './storage.js';
import {projectMoveDirectory,assertProjectMoveDirectory} from './project-move-boundaries.js';
import {withScratch} from './scratch-work.js';
import {withWriterLease} from './writer-lease.js';
import {MOVE_SOURCE,moveSource} from './workspace-move-state.js';
import {databaseProvider} from './workspace-database-context.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {assertLabBookDatabaseStopped} from './lab-book-postgres.js';
import {operationStage,operationItem,operationAdvance} from './operation-progress.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {validateStorageName} from './storage-names.js';
export function validateNativeMoveBook(item,projectId){
 if(!item||item.kind!=='lab-book'||item.projectId!==projectId||!['labBookId','namespaceId','vaultId','sourceId'].every(key=>researchId(item[key]))||item.relative!==item.directory||item.directory?.toLowerCase()==='.observanda'||typeof item.accessHash!=='string'||!/^[a-f0-9]{64}$/.test(item.accessHash)||!item.identity||!['dev','ino'].every(key=>/^[0-9]+$/.test(item.identity[key]))||Object.hasOwn(item,'key'))throw new AppError('STORAGE_MOVE_STATE');validateStorageName(item.directory,{nameError:'STORAGE_MOVE_STATE'});
 if(item.destinationIdentity!==undefined&&(!item.destinationIdentity||!['dev','ino'].every(key=>/^[0-9]+$/.test(item.destinationIdentity[key])))||item.destinationId!==undefined&&(!researchId(item.destinationId)||!item.destinationIdentity||!validDatabaseRetention(item.retention)))throw new AppError('STORAGE_MOVE_STATE');return item;
}
const hash=async root=>digest(await readFile(path.join(root,'.observanda/access.json')));
export class NativeProjectMoveBooks{
 constructor(command,value,vault){this.command=command;this.value=value;this.vault=vault;this.source=new ProjectStorage(value.source,value.projectId,vault);this.registry=new LabBookRegistry(this.source);this.owners=portabilityCollection(command.workspace,value.bookOwners);}
 static async prepare(command,value,vault,withBook){
  const source=new ProjectStorage(value.source,value.projectId,vault),registry=new LabBookRegistry(source);await new ProjectBookOwners(source).ready();value.bookDirectory=await captureProjectBookCopyDirectory(registry);
  value.bookOwners=new NativePortabilityCollection(null,randomUUID()).empty();value.bookKeys=new NativePortabilityCollection(null,randomUUID()).empty();await command.save(value);
  await withScratch(async owners=>withScratch(async keys=>{
   await withProjectBookCopyDirectory(registry,value.bookDirectory,async view=>{if(view.count&&typeof withBook!=='function')throw new AppError('ACCESS_LOCKED');for await(const {entry} of view.entries())await withBook(entry.labBookId,async storage=>{
    const root=path.join(source.root,entry.directory),binding=await catalogueBinding(root),metadata=(await storage.outline()).metadata;
    if(storage.root!==root||storage.labBookId!==entry.labBookId||storage.vault?.id!==entry.vaultId||await realpath(root)!==root||binding?.placement!=='lab-book'||binding.labBookId!==entry.labBookId||metadata.id!==entry.namespaceId||metadata.notebooks[0].projectId!==value.projectId)throw new AppError('DATABASE_LOCATION');authenticateKeyring((await readAccess(root)).value,storage.vault);
    const item={...entry,kind:'lab-book',relative:entry.directory,projectId:value.projectId,identity:await projectMoveDirectory(root),accessHash:await hash(root),sourceId:binding.id};await owners.add(item.relative,item);await keys.add(item.relative,{kind:'lab-book',relative:item.relative,labBookId:item.labBookId,namespaceId:item.namespaceId,vaultId:item.vaultId,key:storage.vault.key.toString('base64')});
   });});
   value.bookOwners=await createPortabilityCollection(command.workspace,owners.items(),{id:value.bookOwners.id});value.bookKeys=await createPortabilityCollection(source,keys.items(),{id:value.bookKeys.id});
  }));
  if(await registry.version()!==value.bookDirectory.revision)throw new AppError('CONFLICT');await command.save(value);return new NativeProjectMoveBooks(command,value,vault);
 }
 async verifyOwners(){await this.owners.verify();for await(const item of this.owners.entries())validateNativeMoveBook(item,this.value.projectId);}
 async current(){await new ProjectBookOwners(this.source).ready();if(await this.registry.version()!==this.value.bookDirectory.revision)throw new AppError('CONFLICT');}
 async use(root,item,operation,{keysRoot=root,identity=true}={}){
  validateNativeMoveBook(item,this.value.projectId);const value=this.value,keys=portabilityCollection(new ProjectStorage(keysRoot,value.projectId,this.vault),value.bookKeys),saved=await keys.get(item.relative);
  if(!saved||['relative','labBookId','namespaceId','vaultId'].some(key=>saved[key]!==item[key])||typeof saved.key!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(saved.key))throw new AppError('STORAGE_MOVE_STATE');const vault={id:item.vaultId,key:Buffer.from(saved.key,'base64')};
  try{const location=path.join(root,item.directory),storage=new LabBookStorage(location,item.labBookId,vault),binding=await catalogueBinding(location);if(await realpath(location)!==location||await hash(location)!==item.accessHash)throw new AppError('STORAGE_MOVE_STATE');if(identity)await assertProjectMoveDirectory(location,root===value.source?item.identity:item.destinationIdentity);authenticateKeyring((await readAccess(location)).value,vault);
   if(binding?.placement!=='lab-book'||binding.labBookId!==item.labBookId||binding.id!==(root===value.source?item.sourceId:item.destinationId)||(await storage.catalogue(async store=>(await store.snapshot()).metadata)).id!==item.namespaceId)throw new AppError('DATABASE_LOCATION');return await operation(storage);
  }finally{clearVault(vault);}
 }
 async freeze(checkpoint){
  const value=this.value,directory=await privateDirectory(value.source,'.observanda/lab-book-creation');
  for await(const item of this.owners.entries())await withWriterLease(path.join(directory,'book-'+item.labBookId+'.lock'),()=>this.use(value.source,item,storage=>storage.withStorageHandoff(async()=>{
   const marker=await moveSource(storage.root),expected={id:value.id,destination:path.join(value.destination,item.directory)};if(marker&&serialize(marker)!==serialize(expected))throw new AppError('STORAGE_MOVE_STATE');if(!marker)await atomicWrite(path.join(storage.root,MOVE_SOURCE),serialize(expected));await checkpoint('book-frozen',item.labBookId);
  },{existing:true,moveId:value.id})),{wait:false});
 }
 async copy(checkpoint){
  const value=this.value;await operationStage('copy-project-books',{unit:'books',total:this.owners.count},async()=>{for await(const item of this.owners.entries()){
   operationItem(item.directory);await this.use(value.source,item,async source=>{
    const destination=path.join(value.destination,item.directory);if(item.destinationIdentity)await assertProjectMoveDirectory(destination,item.destinationIdentity);
    try{await copyLabBookLocation(source,destination,{id:workspaceCopyTransferId(value.id,item.labBookId),relocation:true,retainIncomplete:true,checkpoint:async(stage,...args)=>{if(stage==='files'){const identity=await projectMoveDirectory(destination);if(item.destinationIdentity&&serialize(item.destinationIdentity)!==serialize(identity))throw new AppError('STORAGE_MOVE_STATE');await this.owners.update(item.relative,{destinationIdentity:identity});await this.command.save(value);}await checkpoint('copy:book-'+stage,item.labBookId,...args);},onVerified:async(target,receipt)=>{
     const binding=await catalogueBinding(target.root);if(receipt.sourceId!==item.sourceId||receipt.namespaceId!==item.namespaceId||binding?.placement!=='lab-book'||binding.labBookId!==item.labBookId||item.destinationId&&item.destinationId!==binding.id)throw new AppError('DATABASE_LOCATION');
     await this.owners.update(item.relative,{destinationId:binding.id,destinationIdentity:await projectMoveDirectory(target.root),retention:await source.catalogue(store=>databaseRetention(store.db))});await this.command.save(value);
    }});}finally{await databaseProvider()?.closeLabBook(destination);}
   });operationAdvance();await checkpoint('copy:book',item.labBookId);
  }});
 }
 async activate(){for await(const item of this.owners.entries())await unlink(path.join(this.value.destination,item.directory,'.observanda/copy-in-progress')).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 async verify({retention=true,onCopiedBook}={}){
  const value=this.value,registry=new LabBookRegistry(new ProjectStorage(value.destination,value.projectId,this.vault));if(await registry.version()!==value.bookDirectory.revision)throw new AppError('STORAGE_MOVE_STATE');
  for await(const item of this.owners.entries())await this.use(value.destination,item,async storage=>{
   const entry=await registry.locate(item.labBookId),receipt=await labBookTransferReceipt(storage);if(['directory','namespaceId','vaultId'].some(key=>entry[key]!==item[key])||receipt?.phase!=='verified'||receipt.id!==workspaceCopyTransferId(value.id,item.labBookId)||receipt.sourceId!==item.sourceId||receipt.source!==path.join(value.source,item.directory))throw new AppError('STORAGE_MOVE_STATE');if(retention)await verifyDatabaseRetention(storage,item.retention);if(onCopiedBook)await onCopiedBook(storage);
  });
 }
 async stop(checkpoint){for await(const item of this.owners.entries())await this.use(this.value.source,item,async storage=>{
  const marker=await moveSource(storage.root);if(marker?.id!==this.value.id||marker.destination!==path.join(this.value.destination,item.directory))throw new AppError('STORAGE_MOVE_STATE');const provider=databaseProvider();if(!provider?.stopLabBookForMove)throw new AppError('DATABASE_RUNTIME');await provider.stopLabBookForMove(storage.root,item.labBookId,storage.vault,this.value.id);const lease=await workspaceDatabaseLease(path.join(storage.root,'.observanda/postgresql'));try{await assertLabBookDatabaseStopped(storage.root,item.labBookId,storage.vault);}finally{await lease.close();}await checkpoint('book-stopped',item.labBookId);
 },{keysRoot:this.value.destination});}
 async clear(root){await releasePortabilityCollection(new ProjectStorage(root,this.value.projectId,this.vault),this.value.bookKeys);}
}
