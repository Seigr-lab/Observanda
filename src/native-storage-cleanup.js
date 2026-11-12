import {withNativeTree,nativeControl,nativeTreeFiles,nativeMemberCursor,removeNativeTree} from './native-storage-tree.js';
import {operationStage,operationItem,operationAdvance,operationWork} from './operation-progress.js';
import {DELETE_MARKER,MOVE_SOURCE,MOVE_RECEIPT} from './storage-lifecycle-markers.js';
import {workspaceTransferControl} from './workspace-transfer-controls.js';
import {ownedStorageLeaseFile,ownerNativeControl} from './owned-storage-control.js';
import {isStorageTemporary} from './storage-temporary.js';
import {websiteUpgradeControlFile} from './website-upgrade-lease.js';
import {AppError} from './errors.js';

export async function removeNativeDeletion(directory,value,{checkpoint=async()=>{}}={}){
 return withNativeTree(directory,async(root,context)=>{
  if(!root)return;
  const marker=await nativeControl(root,DELETE_MARKER,{code:'STORAGE_DELETE_STATE'});
  if(marker&&(marker.value?.version!==1||marker.value.id!==value.id||marker.value.source!==value.source))throw new AppError('STORAGE_DELETE_STATE');
  if(!marker){if(value.phase!=='retired')throw new AppError('STORAGE_DELETE_STATE');return removeNativeTree(root,context,DELETE_MARKER);}
  await operationStage('delete-count',{unit:'files'},async()=>{
   let total=0;for await(const file of nativeTreeFiles(root)){operationItem(file.name);operationAdvance();total++;}
   await operationStage('delete-files',{total,unit:'files'},async()=>{
    await removeNativeTree(root,context,DELETE_MARKER,{identity:marker.identity,afterFile:async(name,stat)=>{operationItem(name);operationAdvance();operationWork({bytes:stat.bytes});await checkpoint('file',value);},afterFiles:()=>checkpoint('files',value)});operationAdvance();
   });
  });
 },{missing:true});
}
export async function removeNativeMove(directory,receipt,{verifyDestination=false,signal}={}){
 return withNativeTree(directory,async(root,context)=>{
  if(!root)return;
  signal?.throwIfAborted();
  if(receipt.sourceIdentity&&root.identity!==receipt.sourceIdentity)throw new AppError('STORAGE_MOVE_STATE');
  const marker=await nativeControl(root,MOVE_SOURCE,{limit:65536,code:'STORAGE_MOVE_STATE'});
  if(marker&&(marker.value?.id!==receipt.id||marker.value.destination!==receipt.destination))throw new AppError('STORAGE_MOVE_STATE');
  if(!marker)return removeNativeTree(root,context,MOVE_SOURCE);
  // Reject an already present link or invalid entry before removing anything.
  for await(const file of nativeTreeFiles(root)){signal?.throwIfAborted();operationItem(file.name);}
  let destination,cursor;
  try{
   if(verifyDestination){destination=await context.service.open(receipt.destination);cursor=nativeMemberCursor(destination);}
   await removeNativeTree(root,context,MOVE_SOURCE,{identity:marker.identity,beforeFile:async(parent,name,relative,stat)=>{
    signal?.throwIfAborted();
    const databaseInternal=receipt.ownedDatabase&&(relative.startsWith('.observanda/postgresql/')||relative.startsWith('.observanda/database-transition/')||['.observanda/research.observanda','.observanda/database-conversion.observanda'].includes(relative));
    if(verifyDestination&&!databaseInternal&&!workspaceTransferControl(relative)&&relative!==MOVE_RECEIPT&&!ownedStorageLeaseFile(relative)&&!ownerNativeControl(relative)&&!websiteUpgradeControlFile(relative)&&!isStorageTemporary(name)){
     const source=await parent.hash(name),target=await cursor.member(relative),copy=await target.directory.hash(target.name);
     if(source.identity!==stat.identity||source.bytes!==copy.bytes||source.sha256!==copy.sha256)throw new AppError('STORAGE_COPY');
    }
    signal?.throwIfAborted();
   },afterFile:async name=>{operationItem(name);operationAdvance();}});
  }finally{try{await cursor?.close();}finally{await destination?.close();}}
 },{missing:true});
}
