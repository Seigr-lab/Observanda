// An independently owned catalogue changes its access grants without rewriting data.
import path from 'node:path';
import {readAccess,verifyAccess} from './access.js';
import {clearVault} from './encryption.js';
import {authenticateKeyring,changeKeyringPassword} from './security/keyring.js';
import {atomicWrite,serialize} from './storage.js';
import {AppError} from './errors.js';
import {accessDevice} from './security/access-context.js';
import {defaultDeviceStore} from './security/device-store.js';
import {keyringFingerprint} from './security/access-trust.js';
export class OwnedAccessSettings{
 constructor(storage){this.storage=storage;}
 async details({deviceStore=accessDevice()??defaultDeviceStore}={}){const access=await readAccess(this.storage.root,{deviceStore});authenticateKeyring(access.value,this.storage.vault);return {etag:access.etag,username:access.value.username,passwordAvailable:!!access.value.password,recoveryAvailable:!!access.value.recovery,fingerprint:keyringFingerprint(access.value),checkpoint:{format:'observanda-access-v1',keyring:access.value}};}
 async password(data,{deviceStore=accessDevice()??defaultDeviceStore,authenticate=(root,access,username,password)=>verifyAccess(access,username,password,{deviceStore}),check=async()=>{},changed=async()=>{}}={}){
  if(!data||!['etag,password,username','currentPassword,etag,password,username'].includes(Object.keys(data).sort().join())||typeof data.etag!=='string'||typeof data.username!=='string'||typeof data.password!=='string'||!data.password||data.currentPassword!==undefined&&typeof data.currentPassword!=='string')throw new AppError('INVALID');
  return this.storage.withLock(async()=>{
   await check();const current=await readAccess(this.storage.root,{deviceStore});if(current.etag!==data.etag)throw new AppError('CONFLICT');authenticateKeyring(current.value,this.storage.vault);
   // A password-protected owner changes its credentials only with its current password, even while unlocked. An empty password would fall back to this device's trust, so it is refused before checking.
   if(current.value.password){if(!data.currentPassword)throw new AppError('ACCESS_DENIED');await clearVault(await authenticate(this.storage.root,current,current.value.username,data.currentPassword));await check();}
   const value=await changeKeyringPassword(current.value,this.storage.vault,{username:data.username,password:data.password,deviceStore});await check();
   await deviceStore.accessTrust.replace(current.value,value,this.storage.vault,()=>atomicWrite(path.join(this.storage.root,'.observanda/access.json'),serialize(value)));const result=await this.details({deviceStore});await changed(result.etag);return result;
  });
 }
}
