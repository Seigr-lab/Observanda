import {createKeyring,validateKeyring,unlockKeyring,changeKeyringPassword,ACCESS_LIMIT} from './security/keyring.js';
import {defaultDeviceStore} from './security/device-store.js';
import {accessDevice} from './security/access-context.js';
import {keyringFingerprint} from './security/access-trust.js';
import {clearVault,cloneVault} from './encryption.js';
import path from 'node:path';
import {Workspace,assertRegular,atomicWrite,digest,serialize,readStorageFile as readFile} from './storage.js';
import {AppError} from './errors.js';

const createdVaults=new WeakMap();
const accessRoots=new WeakMap();
export const takeCreatedVault=access=>{const value=createdVaults.get(access)??null;createdVaults.delete(access);return value;};

// Every access file is an encrypted keyring (format 3). A null value means no
// access file: only the server's no-workspace context reads that as "no access".
export async function createWorkspaceAccess(username='',password='',deviceStore=defaultDeviceStore){
 const {value,vault}=await createKeyring({username,password,deviceStore});createdVaults.set(value,vault);return value;
}
export async function accessSummary(value,deviceStore=defaultDeviceStore){
 if(value===null)return {protected:false,encrypted:false,version:null,deviceAvailable:deviceStore.available(),deviceAuthorized:false,passwordAvailable:false,recoveryAvailable:false,username:'',usernameRequired:false};
 const device=await deviceStore.read().catch(()=>null);
 return {protected:true,encrypted:true,version:value.formatVersion,
  deviceAvailable:deviceStore.available(),deviceAuthorized:value.devices.some(d=>d.identity.id===device?.public.id),
  passwordAvailable:!!value.password,recoveryAvailable:!!value.recovery,username:value.username,usernameRequired:!!value.username};
}
export async function resolveAccess(access,{deviceStore=accessDevice(),root=accessRoots.get(access)}={}){
 if(access.value===null)throw new AppError('ACCESS_FORMAT');
 if(!deviceStore)return access;
 deviceStore.accessTrust.assertExternal(root);
 const value=await deviceStore.accessTrust.resolve(access.value);
 if(keyringFingerprint(value)===keyringFingerprint(access.value))return access;
 const resolved={value,etag:digest(access.etag+':'+keyringFingerprint(value))};if(root)accessRoots.set(resolved,root);return resolved;
}
export async function readAccess(root,{deviceStore=accessDevice()}={}){
  try{
    await assertRegular(path.join(root,'.observanda'),{directory:true});
    const file=path.join(root,'.observanda','access.json'),stat=await assertRegular(file);
    if(stat.size>ACCESS_LIMIT)throw new AppError('ACCESS_FORMAT');
    const raw=await readFile(file,'utf8',ACCESS_LIMIT);let value;try{value=JSON.parse(raw);}catch{throw new AppError('ACCESS_FORMAT');}
    if(value?.formatVersion!==3)throw new AppError('ACCESS_FORMAT');
    validateKeyring(value);
    const access={value,etag:digest(raw)};accessRoots.set(access,root);return resolveAccess(access,{deviceStore,root});
  }catch(e){if(e.code==='ENOENT')return {value:null,etag:'none'};throw e;}
}
// Every workspace, project and lab book owns an access file; its absence is damage, not an open folder.
export async function requireAccess(root,options){
  const access=await readAccess(root,options);if(access.value===null)throw new AppError('ACCESS_FORMAT');return access;
}
export async function verifyAccess(access,username,password,{deviceStore=accessDevice()??defaultDeviceStore,recovery=''}={}){
  if(access.updateRequired)throw new AppError('ACCESS_STATE_CHANGED');
  if(access.value===null)throw new AppError('ACCESS_FORMAT');
  access=await resolveAccess(access,{deviceStore});
  if(access.value.formatVersion!==3)throw new AppError('ACCESS_FORMAT');
  const vault=await unlockKeyring(access.value,{username,password,recovery,deviceStore});
  try{await deviceStore.accessTrust.remember(access.value,vault);return vault;}catch(error){await clearVault(vault);throw error;}
}
export async function changeAccess(root,{username,password,currentPassword},expected,{deviceStore=accessDevice()??defaultDeviceStore,vault:sessionVault=null}={}){
  const workspace=new Workspace(root);
  return workspace.withLock(async()=>{
    const current=await requireAccess(root,{deviceStore});if(current.etag!==expected)throw new AppError('CONFLICT');
    const vault=sessionVault?cloneVault(sessionVault):await verifyAccess(current,current.value.username,currentPassword??'',{deviceStore});
    try{
      const next=await changeKeyringPassword(current.value,vault,{username,password,deviceStore});
      await deviceStore.accessTrust.replace(current.value,next,vault,()=>atomicWrite(path.join(workspace.root,'.observanda','access.json'),serialize(next)));return readAccess(root,{deviceStore});
    }finally{await clearVault(vault);}
  });
}
