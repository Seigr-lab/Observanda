import {createKeyring,validateKeyring,unlockKeyring,changeKeyringPassword,ACCESS_LIMIT} from './security/keyring.js';
import {defaultDeviceStore} from './security/device-store.js';
import {passwordKey,seal,unseal,clearVault,cloneVault} from './encryption.js';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {Workspace,assertRegular,atomicWrite,digest,serialize} from './storage.js';
import {AppError} from './errors.js';

const derive=promisify(scrypt);
// OWASP's scrypt baseline; fixed parameters keep imported credentials bounded.
const parameters={N:131072,r:8,p:1,maxmem:160*1024*1024};
const usernameOK=v=>typeof v==='string'&&v.length<=80&&!/[\x00-\x1f]/.test(v);
const passwordOK=v=>typeof v==='string'&&v.length>=12&&v.length<=1024;
const createdVaults=new WeakMap();
export const takeCreatedVault=access=>{const value=createdVaults.get(access)??null;createdVaults.delete(access);return value;};
const keyAAD=value=>'Observanda/key/v2/'+value.vaultId+'/'+value.username;
// Legacy format builder retained for compatibility fixtures. Application creation uses createWorkspaceAccess.
export async function createAccess(username='',password='',existingVault=null){
  if(!usernameOK(username)||typeof password!=='string'||(password&&!passwordOK(password)))throw new AppError('ACCESS_INVALID');
  if(!password)return {formatVersion:1,username:username.trim(),password:null};
  const vault=existingVault??{id:randomUUID(),key:randomBytes(32)},salt=randomBytes(32).toString('hex');
  const result={formatVersion:2,username:username.trim(),vaultId:vault.id,password:{algorithm:'scrypt-aes-256-gcm',salt,wrapped:''}};
  const wrapping=await passwordKey(password,salt);
  try{result.password.wrapped=seal(vault.key,wrapping,keyAAD(result)).toString('hex');}finally{wrapping.fill(0);}
  createdVaults.set(result,vault);return result;
}

export async function createWorkspaceAccess(username='',password='',deviceStore=defaultDeviceStore){
 const {value,vault}=await createKeyring({username,password,deviceStore});createdVaults.set(value,vault);return value;
}
export const isEncryptedAccess=value=>value?.formatVersion===2||value?.formatVersion===3;
export const requiresAccess=value=>!!value?.password||value?.formatVersion===3;
export async function accessSummary(value,deviceStore=defaultDeviceStore){
 const device=value.formatVersion===3?await deviceStore.read().catch(()=>null):null;
 return {protected:requiresAccess(value),encrypted:isEncryptedAccess(value),version:value.formatVersion,
  deviceAvailable:deviceStore.available(),deviceAuthorized:value.formatVersion===3&&value.devices.some(d=>d.identity.id===device?.public.id),
  passwordAvailable:!!value.password,recoveryAvailable:!!value.recovery,username:value.username,usernameRequired:!!value.username};
}
export async function readAccess(root){
  try{
    await assertRegular(path.join(root,'.observanda'),{directory:true});
    const file=path.join(root,'.observanda','access.json'),stat=await assertRegular(file);
    if(stat.size>ACCESS_LIMIT)throw new AppError('ACCESS_FORMAT');
    const raw=await readFile(file,'utf8');let value;try{value=JSON.parse(raw);}catch{throw new AppError('ACCESS_FORMAT');}
    const p=value.password;
    if(value.formatVersion===3){validateKeyring(value);}else if(value.formatVersion===2){
      if(Object.keys(value).sort().join()!=='formatVersion,password,username,vaultId'||!usernameOK(value.username)||!/^[-a-f0-9]{36}$/.test(value.vaultId)||!p||Object.keys(p).sort().join()!=='algorithm,salt,wrapped'||p.algorithm!=='scrypt-aes-256-gcm'||!/^[a-f0-9]{64}$/.test(p.salt)||!/^[a-f0-9]{136}$/.test(p.wrapped))throw new AppError('ACCESS_FORMAT');
    }else {if(value.formatVersion!==1||!usernameOK(value.username)||Object.keys(value).sort().join()!=='formatVersion,password,username'||(p!==null&&(!p||Object.keys(p).sort().join()!=='algorithm,hash,salt'||p.algorithm!=='scrypt'||!/^[a-f0-9]{64}$/.test(p.salt)||!/^[a-f0-9]{128}$/.test(p.hash))))throw new AppError('ACCESS_FORMAT');
}
    return {value,etag:digest(raw)};
  }catch(e){if(e.code==='ENOENT')return {value:{formatVersion:1,username:'',password:null},etag:'none'};throw e;}
}
export async function verifyAccess(access,username,password,{deviceStore=defaultDeviceStore,recovery=''}={}){
  if(access.value.formatVersion===3)return unlockKeyring(access.value,{username,password,recovery,deviceStore});
  if(!access.value.password)return null;
  if(!usernameOK(username)||typeof password!=='string'||password.length>1024)throw new AppError('ACCESS_DENIED');
  if(access.value.formatVersion===2){
    const wrapping=await passwordKey(password,access.value.password.salt);
    try{const key=unseal(Buffer.from(access.value.password.wrapped,'hex'),wrapping,keyAAD(access.value));if(username.trim()!==access.value.username){key.fill(0);throw new AppError('ACCESS_DENIED');}return {id:access.value.vaultId,key};}
    catch{throw new AppError('ACCESS_DENIED');}finally{wrapping.fill(0);}
  }
  const actual=await derive(password,access.value.password.salt,64,parameters);
  if(!timingSafeEqual(actual,Buffer.from(access.value.password.hash,'hex'))||username.trim()!==access.value.username)throw new AppError('ACCESS_DENIED');
  return null;
}
export async function changeAccess(root,{username,password,currentPassword},expected,{deviceStore=defaultDeviceStore,vault:sessionVault=null}={}){
  const workspace=new Workspace(root);
  return workspace.withLock(async()=>{
    const current=await readAccess(root);if(current.etag!==expected)throw new AppError('CONFLICT');
    const vault=current.value.formatVersion===3&&sessionVault?cloneVault(sessionVault):await verifyAccess(current,current.value.username,currentPassword??'',{deviceStore});
    try{
      if(current.value.formatVersion===3){
       const next=await changeKeyringPassword(current.value,vault,{username,password,deviceStore});
       await atomicWrite(path.join(workspace.root,'.observanda','access.json'),serialize(next));return readAccess(root);
      }
      if(!vault&&password)throw new AppError('ENCRYPT_COPY');
      if(vault&&!password)throw new AppError('ENCRYPT_PASSWORD');
      const next=await createAccess(username,password,vault);takeCreatedVault(next);
      await atomicWrite(path.join(workspace.root,'.observanda','access.json'),serialize(next));return readAccess(root);
    }finally{clearVault(vault);}
  });
}
