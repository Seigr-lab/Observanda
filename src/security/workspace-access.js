import path from 'node:path';
import {Workspace,atomicWrite,serialize} from '../storage.js';
import {readAccess} from '../access.js';
import {authenticateKeyring,grantDevice,recoveryKey} from './keyring.js';
import {AppError} from '../errors.js';
import {defaultDeviceStore} from './device-store.js';
import {accessDevice} from './access-context.js';
import {keyringFingerprint} from './access-trust.js';

export async function workspaceAccess(root,vault,{deviceStore=accessDevice()??defaultDeviceStore}={}){
 const access=await readAccess(root,{deviceStore});if(access.value.formatVersion!==3)throw new AppError('ACCESS_UPGRADE');
 authenticateKeyring(access.value,vault);
 return {etag:access.etag,vaultId:access.value.vaultId,fingerprint:keyringFingerprint(access.value),recoveryAvailable:!!access.value.recovery,
 devices:access.value.devices.map(d=>({id:d.identity.id})),passwordAvailable:!!access.value.password,scope:'workspace'};
}
export async function updateWorkspaceAccess(root,vault,{action,etag,identity,verifiedFingerprint,confirmed},{deviceStore=accessDevice()??defaultDeviceStore}={}){
 return new Workspace(root,vault).withLock(async()=>{
  const current=await readAccess(root,{deviceStore});if(current.etag!==etag)throw new AppError('CONFLICT');
  if(current.value.formatVersion!==3)throw new AppError('ACCESS_UPGRADE');
  authenticateKeyring(current.value,vault);let value,result={};
  if(action==='grant'){
   if(confirmed!==true||!identity||verifiedFingerprint!==identity.id)throw new AppError('ACCESS_CONFIRM');
   value=grantDevice(current.value,vault,identity);
  }else if(action==='recovery'){
   if(confirmed!==true)throw new AppError('ACCESS_CONFIRM');
   const generated=recoveryKey(current.value,vault);value=generated.value;result.recovery=generated.recovery;
  }else throw new AppError('INVALID');
  await deviceStore.accessTrust.replace(current.value,value,vault,()=>atomicWrite(path.join(root,'.observanda','access.json'),serialize(value)));
  return {...await workspaceAccess(root,vault,{deviceStore}),...result};
 });
}
