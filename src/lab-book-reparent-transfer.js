// Cross-filesystem book moves reuse the authenticated owner transfer. Only the
// verified destination becomes current; retirement stays beside the old owner.
import path from 'node:path';
import {rename,unlink} from 'node:fs/promises';
import {LabBookStorage} from './lab-book-storage.js';
import {copyLabBookLocation,labBookTransferReceipt} from './lab-book-transfer.js';
import {catalogueBinding} from './postgres-activation.js';
import {databaseRetention,validDatabaseRetention,verifyDatabaseRetention} from './workspace-database-retention.js';
import {projectMoveDirectory,assertProjectMoveDirectory,ownedProjectFolder} from './project-move-boundaries.js';
import {removeRetiredLabBook} from './owned-storage-retirement.js';
import {assertRegular,atomicWrite,serialize} from './storage.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {workspaceRename} from './workspace-rename-state.js';
import {MOVE_SOURCE,moveSource} from './workspace-move-state.js';
import {databaseProvider} from './workspace-database-context.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {assertLabBookDatabaseStopped,LAB_BOOK_DATABASE_DIRECTORY} from './lab-book-postgres.js';
import {researchId} from './web/research-reference.js';
import {operationStage} from './operation-progress.js';
import {AppError} from './errors.js';
const exact=(value,keys)=>value&&Object.keys(value).sort().join()===keys;
export function validBookRelocationTransfer(value){
 const transfer=value.transfer;
 if(value.version===1)return transfer===undefined&&['prepared','frozen','moved','registered','complete','cancelling','cancelled'].includes(value.phase);
 if(value.version!==2||!transfer||!researchId(transfer.sourceId))return false;
 if(value.phase==='copying')return exact(transfer,'sourceId');
 return ['moved','registered','retiring','retired','complete'].includes(value.phase)&&exact(transfer,'destinationId,identity,retention,sourceId')&&researchId(transfer.destinationId)&&transfer.destinationId!==transfer.sourceId&&exact(transfer.identity,'dev,ino')&&Object.values(transfer.identity).every(part=>typeof part==='string'&&/^\d+$/.test(part))&&validDatabaseRetention(transfer.retention);
}
export class LabBookRelocationTransfer{
 constructor(command,value,vault,options){this.command=command;this.value=value;this.vault=vault;Object.assign(this,options);this.fresh=false;}
 async storage(root){const storage=new LabBookStorage(root,this.value.labBookId,this.vault);authenticateKeyring((await readAccess(root)).value,this.vault);return storage;}
 async copy(){
  const value=this.value,roots=await this.command.roots(value),source=await this.storage(roots.source);
  if(await this.command.locate(value)!==source.root||(await workspaceRename(source.root))?.id!==value.id)throw new AppError('STORAGE_RENAME_STATE');
  if((await catalogueBinding(source.root))?.id!==value.transfer.sourceId)throw new AppError('DATABASE_LOCATION');
  await ownedProjectFolder(source.root);await this.check();let verified=false;
  await copyLabBookLocation(source,roots.destination,{id:value.id,retainIncomplete:true,relocation:true,
   checkpoint:async(stage,...args)=>{if(stage==='verified')verified=true;await this.check();await this.checkpoint('copy:'+stage,...args);},
   onVerified:async(target,receipt)=>{
    const binding=await catalogueBinding(target.root);
    if(receipt.id!==value.id||receipt.sourceId!==value.transfer.sourceId||receipt.namespaceId!==value.namespaceId||binding?.placement!=='lab-book'||binding.labBookId!==value.labBookId)throw new AppError('DATABASE_LOCATION');
    value.transfer={sourceId:receipt.sourceId,destinationId:binding.id,identity:await projectMoveDirectory(target.root),retention:await source.catalogue(store=>databaseRetention(store.db))};
    value.phase='moved';await this.command.save(value);await this.checkpoint('transferred',value);
   }
  });this.fresh=verified;
 }
 async target(){
  const value=this.value,roots=await this.command.roots(value);
  if(await this.command.locate(value)!==roots.destination)throw new AppError('STORAGE_RENAME_STATE');
  const target=await this.storage(roots.destination);
  const binding=await catalogueBinding(target.root),receipt=await labBookTransferReceipt(target);
  if(binding?.id!==value.transfer.destinationId||binding.placement!=='lab-book'||binding.labBookId!==value.labBookId||receipt?.phase!=='verified'||receipt.id!==value.id||receipt.source!==roots.source||receipt.sourceId!==value.transfer.sourceId||receipt.namespaceId!==value.namespaceId)throw new AppError('STORAGE_MOVE_STATE');
  return target;
 }
 async retire(){
  const value=this.value,roots=await this.command.roots(value),retired=path.join(path.dirname(roots.source),'.observanda-lab-book-move-'+value.id),target=await this.target();
  if(!this.fresh)await verifyDatabaseRetention(target,value.transfer.retention);
  return operationStage('remove-original',{unit:'files'},async()=>{
   await this.check();
   if(value.phase==='registered'){value.phase='retiring';await this.command.save(value);await this.checkpoint('retiring',value);}
   if(value.phase==='retiring'){
    if(await assertRegular(retired,{directory:true,missing:true})){
     await assertProjectMoveDirectory(retired,value.identity);const marker=await moveSource(retired);
     if(marker?.id!==value.id||marker.destination!==target.root)throw new AppError('STORAGE_MOVE_STATE');
    }else{
     await assertProjectMoveDirectory(roots.source,value.identity);await this.storage(roots.source);await ownedProjectFolder(roots.source);
     if((await catalogueBinding(roots.source))?.id!==value.transfer.sourceId||(await workspaceRename(roots.source))?.id!==value.id)throw new AppError('STORAGE_MOVE_STATE');
     const provider=databaseProvider();if(!provider?.stopLabBookForRename)throw new AppError('DATABASE_LOCATION');
     const pending=await moveSource(roots.source);if(pending&&(pending.id!==value.id||pending.destination!==target.root))throw new AppError('STORAGE_MOVE_STATE');
     if(pending)await provider.stopLabBookForMove(roots.source,value.labBookId,this.vault,value.id);else await provider.stopLabBookForRename(roots.source,value.labBookId,this.vault,value.id);
     const lease=await workspaceDatabaseLease(path.join(roots.source,LAB_BOOK_DATABASE_DIRECTORY));
     try{
      await assertLabBookDatabaseStopped(roots.source,value.labBookId,this.vault);await assertProjectMoveDirectory(roots.source,value.identity);
      await atomicWrite(path.join(roots.source,MOVE_SOURCE),serialize({id:value.id,destination:target.root}));await this.checkpoint('retire-frozen',value);await this.check();
     }finally{await lease.close();}
     await rename(roots.source,retired);await this.checkpoint('source-retired',value);
    }
    value.phase='retired';await this.command.save(value);await this.checkpoint('retired',value);
   }
   if(value.phase!=='retired')throw new AppError('STORAGE_MOVE_STATE');
   await removeRetiredLabBook({...value,...roots,sourceDirectory:value.identity},{verify:!this.fresh,checkpoint:async(stage,...args)=>{await this.check();await this.checkpoint('retire:'+stage,...args);}});
   await this.checkpoint('source-removed',value);
  });
 }
 async activate(){const roots=await this.command.roots(this.value);await unlink(path.join(roots.destination,'.observanda/copy-in-progress')).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
