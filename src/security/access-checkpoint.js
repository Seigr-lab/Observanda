import path from 'node:path';
import {readAccess,accessSummary} from '../access.js';
import {Workspace,atomicWrite,serialize} from '../storage.js';
import {withAccessDevice} from './access-context.js';
import {clearVault} from '../encryption.js';
import {validateKeyring,authenticateKeyring,unlockKeyring} from './keyring.js';
import {keyringFingerprint} from './access-trust.js';
import {AppError} from '../errors.js';

function keyring(checkpoint){
 if(!checkpoint||Object.keys(checkpoint).sort().join()!=='format,keyring'||checkpoint.format!=='observanda-access-v1')throw new AppError('ACCESS_FORMAT');
 return validateKeyring(checkpoint.keyring);
}
export async function exportAccessCheckpoint(root,vault,deviceStore){
 const access=await readAccess(root,{deviceStore});authenticateKeyring(access.value,vault);
 return {checkpoint:{format:'observanda-access-v1',keyring:access.value},fingerprint:keyringFingerprint(access.value)};
}
export async function inspectAccessCheckpoint(checkpoint,deviceStore){
 const value=keyring(checkpoint),current=await deviceStore.accessTrust.current(value.vaultId);
 return {vaultId:value.vaultId,fingerprint:keyringFingerprint(value),authentication:await accessSummary(current?.keyring??value,deviceStore),known:!!current};
}
// Import is an explicit authenticated trust decision, like approving a device
// fingerprint. It never runs automatically because a workspace HMAC is valid:
// someone retaining an old vault key could forge such an unknown successor.
export async function importAccessCheckpoint(root,checkpoint,{verifiedFingerprint,confirmed,username='',password='',recovery=''},deviceStore,{authorize=value=>unlockKeyring(value,{username,password,recovery,deviceStore})}={}){
 const value=keyring(checkpoint);
 if(confirmed!==true||verifiedFingerprint!==keyringFingerprint(value))throw new AppError('ACCESS_CONFIRM');
 deviceStore.accessTrust.assertExternal(root);
 const original=await readAccess(root,{deviceStore:null});if(original.value.vaultId!==value.vaultId)throw new AppError('WORKSPACE_CHANGED');
 const trusted=await deviceStore.accessTrust.current(value.vaultId),vault=await authorize(trusted?.keyring??value);
 try{
  authenticateKeyring(value,vault);authenticateKeyring(original.value,vault);
  // Explicitly authenticated import may repair an unknown workspace keyring.
  // Take the normal workspace writer lock using the authenticated vault, then
  // compare both the workspace snapshot and external authority under their locks.
  await withAccessDevice(null,()=>new Workspace(root,vault).withLock(async()=>{
   const latest=await readAccess(root,{deviceStore:null});if(latest.etag!==original.etag)throw new AppError('CONFLICT');
   await deviceStore.accessTrust.installCheckpoint(value,vault,{expected:trusted?.sha256??null,obsolete:original.value,write:()=>atomicWrite(path.join(root,'.observanda/access.json'),serialize(value))});
  },{existing:true}));
  return {ok:true};
 }finally{clearVault(vault);}
}
