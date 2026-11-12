import path from 'node:path';
import {AppError} from './errors.js';
import {Workspace,assertRegular,serialize} from './storage.js';
import {resolveLocation,prepareCopyDestination,currentAccessReplacement} from './locations.js';
import {WorkspaceCopyRecovery} from './workspace-copy-recovery.js';
import {portableInventory,portableInventoryDigest} from './portable-inventory.js';
import {digest} from './storage-format.js';
import {withNativeDestination} from './native-destination.js';
import {withNativeWorkspaceCopy} from './native-workspace-copy.js';
import {withNativeTree} from './native-storage-tree.js';
import {withWriterLease} from './writer-lease.js';
import {PORTABLE_RESTORE_RECEIPT,WORKSPACE_COPY_LEASE} from './workspace-transfer-controls.js';

const marker='.observanda/copy-in-progress';
const inside=(parent,child)=>{
 const relative=path.relative(parent,child);
 return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);
};
const matches=(actual,expected)=>actual.sha256===expected.sha256&&actual.bytes===expected.bytes&&actual.files===expected.files;

export function inspectRestoreDestination(backup,destination,receipt){
 return withNativeTree(destination,async directory=>{
  if(!directory)return 'new';
  const internal=await directory.directory('.observanda',{missing:true});
  if(!internal){
   for await(const item of directory.entries())throw new AppError('EXISTS');
   return 'new';
  }
  await internal.close();
  return withNativeDestination(destination,async target=>{
    await target.admit();
    const file=path.join(destination,PORTABLE_RESTORE_RECEIPT);
    if(!await target.stat(file,{missing:true})){
     if(await new WorkspaceCopyRecovery(backup,destination).emptyPreparation())return 'resume';
     throw new AppError('EXISTS');
    }
    const restored=new Workspace(destination,backup.vault);
    let journal;
    try{journal=JSON.parse(await restored.readFile(file,'utf8',16384));}catch{throw new AppError('STORAGE_COPY');}
    if(journal?.binding?.id!==receipt.id||journal.binding.sha256!==receipt.inventory.sha256||journal.binding.directory!==target.identity||journal.binding.internal!==target.internalIdentity)throw new AppError('EXISTS');
    return journal.restoredAt&&!await target.stat(path.join(destination,marker),{missing:true})?'completed':'resume';
  });
 },{missing:true});
}

// Restoring reads the chosen backup independently of the former installation.
// Only the reviewed, initially empty destination can be resumed or published.
export async function restorePortable(backup,destinationInput,{expectedId,signal,deviceStore}={}){
 const destination=await resolveLocation(destinationInput);
 if(inside(backup.root,destination)||inside(destination,backup.root))throw new AppError('STORAGE_PATH');
 return withNativeDestination(backup.root,async source=>{
  await source.admit();
  const copy=new WorkspaceCopyRecovery(backup,backup.root);
  const receipt=await copy.portableCompletion({detachedPortable:true});
  if(!receipt.inventory)throw new AppError('STORAGE_INCOMPLETE');
  if(expectedId!==receipt.id)throw new AppError('CONFLICT');
  let result;
  await portableInventory(backup.root,receipt.id,{signal,consume:async(inventory,items)=>{
   if(!matches(inventory,receipt.inventory))throw new AppError('STORAGE_COPY');
   result=await withNativeDestination(destination,async target=>{
    const restored=new Workspace(destination,backup.vault);
    const file=path.join(destination,PORTABLE_RESTORE_RECEIPT),incomplete=path.join(destination,marker);
    const existing=await assertRegular(destination,{directory:true,missing:true})&&await assertRegular(path.join(destination,'.observanda'),{directory:true,missing:true});
    if(existing){
     await target.admit();
     if(!await target.stat(file,{missing:true})&&!await new WorkspaceCopyRecovery(backup,destination).emptyPreparation())throw new AppError('EXISTS');
    }else await prepareCopyDestination(destination);
    return withWriterLease(path.join(destination,WORKSPACE_COPY_LEASE),async()=>{
     const binding={version:1,id:receipt.id,sha256:inventory.sha256,directory:target.identity,internal:target.internalIdentity};
     let journal;
     if(await target.stat(file,{missing:true})){
      try{journal=JSON.parse(await restored.readFile(file,'utf8',16384));}catch{throw new AppError('STORAGE_COPY');}
      if(!journal?.binding||serialize(journal.binding)!==serialize(binding))throw new AppError('CONFLICT');
     }else{
      if(!await new WorkspaceCopyRecovery(backup,destination).emptyPreparation())throw new AppError('EXISTS');
      if(!await target.stat(incomplete,{missing:true}))await target.write(incomplete,'incomplete\n');
      journal={binding,restoredAt:null};await restored.writeFile(file,serialize(journal));
     }
     if(!await target.stat(incomplete,{missing:true})){
      if(!journal.restoredAt)throw new AppError('STORAGE_INCOMPLETE');
      return {...receipt,destination,restoredInventory:journal.restoredInventory,restoredAt:journal.restoredAt};
     }
     const grants=await currentAccessReplacement(backup.root,backup.vault,{deviceStore});
     const expected=grants?portableInventoryDigest():null;
     let applied=false;
     await withNativeWorkspaceCopy(backup.root,destination,async copyFile=>{
      for await(const row of items()){
       signal?.throwIfAborted();
       const [name,bytes,sha256]=row;
       if(grants&&name==='.observanda/access.json'){
        // Current grants belong to the restored workspace. The authenticated
        // archive keeps its own access file and retains its original digest.
        await target.write(path.join(destination,name),grants);
        expected.file([name,grants.length,digest(grants)]);applied=true;
       }else{
        await copyFile({path:name,bytes,sha256},{temporary:'.stream-portable-restore-'+receipt.id});
        expected?.file(row);
       }
      }
     });
     if(grants&&!applied)throw new AppError('STORAGE_COPY');
     const restoredInventory=await portableInventory(destination,receipt.id,{sealing:true,signal});
     if(!matches(restoredInventory,expected?expected.finish():inventory))throw new AppError('STORAGE_COPY');
     const latest=await copy.portableCompletion({detachedPortable:true});
     if(serialize(latest)!==serialize(receipt))throw new AppError('CONFLICT');
     await source.assertNamed();await target.assertNamed();signal?.throwIfAborted();
     const latestGrants=await currentAccessReplacement(backup.root,backup.vault,{deviceStore});
     if(grants?!latestGrants||!grants.equals(latestGrants):latestGrants)throw new AppError('ACCESS_STATE_CHANGED');
     journal.restoredInventory=restoredInventory;
     journal.restoredAt??=new Date().toISOString();await restored.writeFile(file,serialize(journal));
     await target.remove(incomplete);return {...receipt,destination,restoredInventory,restoredAt:journal.restoredAt};
    });
   });
  }});
  return result;
 });
}
