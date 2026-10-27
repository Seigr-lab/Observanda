import {validWorkspaceCopyDirectory} from './workspace-copy-directory.js';
import {withWorkspaceMoveDirectory} from './workspace-move-directory.js';
import {ownedStorageLeaseFile} from './owned-storage-control.js';
import {workspaceTransferControl} from './workspace-transfer-controls.js';
import {withRetiredRecordCopy} from './project-retired-records.js';
// A verified transfer followed by activation and separately retryable cleanup.
// Only a dedicated workspace folder can be retired. The original is first
// renamed to a receipt-owned sibling, so retries never delete a reused path.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile,readdir,opendir,realpath} from 'node:fs/promises';
import {atomicReplace as rename} from './atomic-replace.js';
import {unlinkPersistent as unlink,removePersistentDirectory as rmdir,persistRename} from './filesystem-persistence.js';
import {Workspace,workspaceFile,assertRegular,atomicWrite,serialize} from './storage.js';
import {copyPlan,copyWorkspace,resolveLocation,transferDestination} from './locations.js';
import {workspaceInventory,hashWorkspaceFile} from './workspace-inventory.js';
import {isStorageTemporary} from './storage-temporary.js';
import {MOVE_RECEIPT,MOVE_SOURCE,moveSource} from './workspace-move-state.js';
import {withOperationProgress,operationStage,operationTransfer,operationAdvance,operationItem} from './operation-progress.js';
import {AppError,safeError} from './errors.js';
import {releaseWriterLease} from './writer-lease.js';
import {databaseProvider} from './workspace-database-context.js';
import {catalogueBinding} from './postgres-activation.js';
import {databaseRetention,validDatabaseRetention,verifyDatabaseRetention} from './workspace-database-retention.js';
import {unseal,cloneVault,clearVault} from './encryption.js';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const retired=receipt=>path.join(path.dirname(receipt.source),'.observanda-move-'+receipt.id);
const within=(a,b)=>{const relative=path.relative(a,b);return relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
async function save(receipt){await atomicWrite(path.join(receipt.destination,MOVE_RECEIPT),serialize(receipt));}
async function ownedFolder(root,projectRoots=[],moveDirectory){
 const descriptor=path.basename(await workspaceFile(root));
 const relativeRoots=projectRoots.map(project=>{if(!within(root,project)||project===root)throw new AppError('STORAGE_MOVE_STATE');return path.relative(root,project).split(path.sep).join('/');});
 async function empty(directory){await assertRegular(directory,{directory:true});for await(const item of await opendir(directory)){if(!item.isDirectory())throw new AppError('STORAGE_MOVE_CONTENTS');await empty(path.join(directory,item.name));}}
 // Retired project containers may remain after their independent child owners
 // moved. Only empty directories can be claimed by the workspace cleanup.
 for(const project of projectRoots)if(await assertRegular(project,{directory:true,missing:true}))await empty(project);
 for(const name of await readdir(root))if(!['.observanda',descriptor].includes(name)){
  if(moveDirectory?!await moveDirectory.sourceContainer(path.join(root,name)):!relativeRoots.some(relative=>relative===name||relative.startsWith(name+'/')))throw new AppError('STORAGE_MOVE_CONTENTS');await empty(path.join(root,name));
 }
}
export async function readMoveReceipt(root){
 const file=path.join(root,MOVE_RECEIPT),stat=await assertRegular(file,{missing:true});if(!stat)return null;
 if(stat.size>16384)throw new AppError('STORAGE_MOVE_STATE');
 let value;try{value=JSON.parse(await readFile(file,'utf8'));}catch{throw new AppError('STORAGE_MOVE_STATE');}
 if(![1,2].includes(value?.version)||!uuid.test(value.id)||value.destination!==root||!path.isAbsolute(value.source??'')||path.resolve(value.source)!==value.source||value.source===path.parse(value.source).root||within(root,value.source)||within(value.source,root)||!['verified','cleanup','complete'].includes(value.phase)||!uuid.test(value.inventorySalt)||![value.fingerprint,value.fingerprintFiles].every(hash=>/^[a-f0-9]{64}$/.test(hash))||!['fileCount','bytes','transferFiles','fileBytes'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0)||value.retired!==undefined&&value.retired!==true)throw new AppError('STORAGE_MOVE_STATE');
 if(value.version===2&&(!validWorkspaceCopyDirectory(value.directory)||value.projectRoots!==undefined||value.ownedDatabase!==true)||value.version===1&&value.directory!==undefined)throw new AppError('STORAGE_MOVE_STATE');
 if(value.ownedDatabase!==undefined&&(value.ownedDatabase!==true||!validDatabaseRetention(value.databaseRetention)))throw new AppError('STORAGE_MOVE_STATE');
 return value;
}
export async function workspaceMoveStatus(root){
 const receipt=await readMoveReceipt(root);return receipt?{id:receipt.id,source:receipt.source,destination:root,phase:receipt.phase,error:receipt.error??null}:null;
}
export async function planWorkspaceMove(source,input,{onProgress,inspect=true,vault=null}={}){
 const destination=await resolveLocation(input),receipt=await readMoveReceipt(destination);
 if(receipt&&receipt.source===await realpath(source)&&receipt.phase==='verified')return {...receipt,resume:true};
 await ownedFolder(source);return {...await (inspect?copyPlan(source,destination,{onProgress,vault}):transferDestination(source,destination)),id:randomUUID()};
}
export async function moveWorkspaceTo(source,input,options={}){
 return withOperationProgress(options.onProgress,async()=>moveWorkspace(await planWorkspaceMove(source,input,{inspect:false}),options));
}
async function removeRetired(receipt,{verifyDestination=false}={}){
 const root=retired(receipt),stat=await assertRegular(root,{directory:true,missing:true});if(!stat)return;
 if(await realpath(path.dirname(root))!==path.dirname(root))throw new AppError('UNSAFE');
 const marker=await moveSource(root);
 if(!marker){
  // Only empty directories may remain if the process stopped after removing
  // the last file. rmdir never removes newly introduced content.
  await rmdir(path.join(root,'.observanda')).catch(error=>{if(error.code!=='ENOENT')throw error;});await rmdir(root);return;
 }
 if(marker.id!==receipt.id||marker.destination!==receipt.destination)throw new AppError('STORAGE_MOVE_STATE');
 async function remove(relative){
  const file=path.join(root,relative);if(!within(root,file)||file===root)throw new AppError('UNSAFE');
  const stat=await assertRegular(file,{directory:relative.endsWith('/'),missing:true});if(!stat)return;
  if(stat.isDirectory()){
   for await(const entry of await opendir(file)){
    const child=path.posix.join(relative,entry.name);if(child===MOVE_SOURCE)continue;
    await remove(child+(entry.isDirectory()?'/':''));
   }
   if(relative!=='.observanda/')await rmdir(file);
  }else{
   // A retry can happen long after the verified transfer. Keep any remaining
   // original whose destination bytes have since been lost or changed.
   const databaseInternal=receipt.ownedDatabase&&(relative.startsWith('.observanda/postgresql/')||relative.startsWith('.observanda/database-transition/')||['.observanda/research.observanda','.observanda/database-conversion.observanda'].includes(relative));
   if(verifyDestination&&!databaseInternal&&!workspaceTransferControl(relative)&&relative!==MOVE_RECEIPT&&!ownedStorageLeaseFile(relative)&&!isStorageTemporary(path.basename(relative))){
    if(await hashWorkspaceFile(file)!==await hashWorkspaceFile(path.join(receipt.destination,relative)))throw new AppError('STORAGE_COPY');
   }
   operationItem(relative);await unlink(file);operationAdvance();
  }
 }
 for await(const entry of await opendir(root))await remove(entry.name+(entry.isDirectory()?'/':''));
 await unlink(path.join(root,MOVE_SOURCE));await rmdir(path.join(root,'.observanda'));await rmdir(root);
}
async function retireSource(receipt,moveDirectory){
 const target=retired(receipt);
 if(await assertRegular(target,{directory:true,missing:true})){await persistRename(receipt.source,target);return;}
 if(!await assertRegular(receipt.source,{directory:true,missing:true}))throw new AppError('STORAGE_MOVE_STATE');
 if(await realpath(receipt.source)!==receipt.source)throw new AppError('UNSAFE');
 await ownedFolder(receipt.source,receipt.projectRoots??[],moveDirectory);
 await workspaceInventory(receipt.source,receipt.inventorySalt,{expectedFiles:receipt,projectRoots:receipt.projectRoots??[],excludeProject:moveDirectory?.source});
 const marker=await moveSource(receipt.source);
 if(marker&&(marker.id!==receipt.id||marker.destination!==receipt.destination))throw new AppError('STORAGE_MOVE_STATE');
 await atomicWrite(path.join(receipt.source,MOVE_SOURCE),serialize({id:receipt.id,destination:receipt.destination}));
  await releaseWriterLease(path.join(receipt.source,'.observanda','write.lock'));
 await rename(receipt.source,target);
}
async function cleanup(receipt,{locked=false,vault,verified=false,moveDirectory}={}){
 if(receipt.directory&&!moveDirectory)return withWorkspaceMoveDirectory(new Workspace(receipt.destination,vault),receipt,directory=>cleanup(receipt,{locked,vault,verified,moveDirectory:directory}));
 operationTransfer({phase:'cleanup'});
 try{
  receipt.phase='cleanup';delete receipt.error;await save(receipt);
  if(receipt.ownedDatabase){
   // A resumed cleanup may follow new destination edits. Verify that all
   // transferred revision/event history is still retained before retiring it.
   await verifyDatabaseRetention(new Workspace(receipt.destination,vault),receipt.databaseRetention,{verify:!verified});
   const source=await assertRegular(retired(receipt),{directory:true,missing:true})?retired(receipt):receipt.source;
   if(await assertRegular(source,{directory:true,missing:true})){
    if(source===receipt.source)await databaseProvider()?.closeWorkspace(source);
    const file=path.join(source,'.observanda/postgresql/service.observanda');
    if(await assertRegular(file,{missing:true})){
     const bytes=unseal(await readFile(file),vault?.key,'Observanda/workspace-postgresql/v1/'+vault?.id);
     try{const state=JSON.parse(bytes.toString());if(state.workspaceId!==vault.id||state.running!==false)throw new AppError('DATABASE_WORKSPACE_RUNNING');}finally{bytes.fill(0);}
    }
   }
  }
  await operationStage('remove-original',{unit:'files'},async()=>{
   if(!receipt.retired){
    if(locked||receipt.ownedDatabase)await retireSource(receipt,moveDirectory);
    else if(!await assertRegular(retired(receipt),{directory:true,missing:true}))await new Workspace(receipt.source).withLock(()=>retireSource(receipt,moveDirectory),{detached:true,moveId:receipt.id,existing:true});
    receipt.retired=true;await save(receipt);
   }
   await removeRetired(receipt,{verifyDestination:!locked});
  });
  receipt.phase='complete';await save(receipt);operationTransfer({phase:'complete'});
 }catch(error){receipt.phase='cleanup';receipt.error=safeError(error);await save(receipt);}
 return {id:receipt.id,source:receipt.source,destination:receipt.destination,phase:receipt.phase,error:receipt.error??null};
}
export async function moveWorkspace(plan,{vault,onProgress,activate,recovery,moveDirectory}={}){
 if(typeof activate!=='function')throw new AppError('INVALID');
 return withOperationProgress(onProgress,async()=>{
  if(plan.ownedDatabase||(await catalogueBinding(plan.source))?.placement==='workspace'){
   const retainedVault=cloneVault(vault);try{return await withRetiredRecordCopy(new Workspace(plan.source,vault),new Workspace(plan.source,retainedVault),()=>moveOwnedWorkspace(plan,{vault:retainedVault,activate,recovery,moveDirectory}));}finally{clearVault(retainedVault);}
  }
  let receipt;
  const freeze=async destination=>{
   receipt={...plan,version:1,destination,phase:'verified'};delete receipt.resume;
   await save(receipt);
   await atomicWrite(path.join(plan.source,MOVE_SOURCE),serialize({id:receipt.id,destination}));plan.resume=true;
  };
  if(plan.resume){
   operationTransfer({phase:'verifying',files:plan.transferFiles,bytes:plan.fileBytes,totalFiles:plan.transferFiles,totalBytes:plan.fileBytes});
   await new Workspace(plan.source,vault).withStorageHandoff(async()=>{
    await workspaceInventory(plan.source,plan.inventorySalt,{expected:plan});
    await workspaceInventory(plan.destination,plan.inventorySalt,{expectedFiles:plan});
    await freeze(plan.destination);
   },{detached:true,moveId:plan.id,existing:true});
  }else await copyWorkspace(plan,{vault,relocation:true,reuseCatalogue:true,afterSnapshotVerified:freeze});
  // Activation may write the canonical folder name into the retained database.
  // Persist the source guard before releasing that database's writer.
  operationTransfer({phase:'opening'});await activate(plan.destination,plan.source);
  return cleanup(receipt,{vault});
 });
}
export async function finishWorkspaceMove(root,{onProgress,vault}={}){
 return withOperationProgress(onProgress,async()=>{
  const receipt=await readMoveReceipt(root);if(!receipt)throw new AppError('STORAGE_MOVE_STATE');
  if(receipt.phase==='complete')return workspaceMoveStatus(root);
  // Never retire the recovery source while the active destination cannot open.
  await new Workspace(root,vault).outline();
  operationTransfer({phase:'cleanup',files:receipt.transferFiles,bytes:receipt.fileBytes,totalFiles:receipt.transferFiles,totalBytes:receipt.fileBytes});
  return cleanup(receipt,{vault});
 });
}

async function moveOwnedWorkspace(plan,{vault,activate,recovery,moveDirectory}){
 if(plan.directory&&!moveDirectory)return withWorkspaceMoveDirectory(new Workspace(plan.resume?plan.destination:plan.source,vault),{...plan,version:2},directory=>moveOwnedWorkspace(plan,{vault,activate,recovery,moveDirectory:directory}));
 let receipt;
 const freeze=async destination=>{
  const workspace=new Workspace(plan.source,vault),proof=await workspace.catalogue(store=>databaseRetention(store.db));
  await verifyDatabaseRetention(new Workspace(destination,vault),proof,{verify:false});
  receipt={...plan,version:plan.directory?2:1,destination,phase:'verified',ownedDatabase:true,databaseRetention:proof};delete receipt.resume;
  await save(receipt);
  await atomicWrite(path.join(plan.source,MOVE_SOURCE),serialize({id:receipt.id,destination}));
 };
 if(plan.resume){
  receipt=plan;
  // The marker was persisted while the source writer lock was held. Recheck
  // only the files here: its database is deliberately stopped and frozen.
  const marker=await moveSource(plan.source);if(marker?.id!==plan.id)throw new AppError('STORAGE_MOVE_STATE');
  await workspaceInventory(plan.source,plan.inventorySalt,{expectedFiles:plan,projectRoots:plan.projectRoots??[],excludeProject:moveDirectory?.source});
  await workspaceInventory(plan.destination,plan.inventorySalt,{expectedFiles:plan,projectRoots:(plan.projectRoots??[]).map(root=>path.resolve(plan.destination,path.relative(plan.source,root))),excludeProject:moveDirectory?.destination});
  await verifyDatabaseRetention(new Workspace(plan.destination,vault),plan.databaseRetention);
 }else await copyWorkspace(plan,{vault,relocation:true,activateCatalogue:true,excludeProject:moveDirectory?.source,...(recovery?{recovery,afterSnapshotVerified:freeze}:{afterVerified:freeze})});
 await databaseProvider()?.closeWorkspace(plan.source);
 operationTransfer({phase:'opening'});await activate(plan.destination,plan.source);
 return cleanup(receipt,{vault,verified:true,moveDirectory});
}
