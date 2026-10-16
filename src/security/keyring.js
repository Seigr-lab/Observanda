import {randomBytes,randomUUID,publicEncrypt,privateDecrypt,constants,createHmac,hkdfSync,timingSafeEqual} from 'node:crypto';
import {seal,unseal,passwordKey} from '../encryption.js';
import {validatePublicDevice} from './device-store.js';
import {AppError} from '../errors.js';
export const ACCESS_LIMIT=262144;
const exact=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===names.split(',').sort().join();
const hex=(v,n)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);
const b64=(v,n)=>typeof v==='string'&&v.length<2000&&Buffer.from(v,'base64').length===n&&Buffer.from(v,'base64').toString('base64')===v;
const validPassword=v=>typeof v==='string'&&v.length>=12&&v.length<=1024;
const aad=(value,purpose)=>'Observanda/access/v3/'+value.vaultId+'/'+purpose;
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
function tag(value,key){const {auth,...body}=value;const authKey=Buffer.from(hkdfSync('sha256',key,Buffer.from(value.vaultId),Buffer.from('Observanda/access-auth/v3'),32));try{return createHmac('sha256',authKey).update(canonical(body)).digest('hex');}finally{authKey.fill(0);}}
export function validateKeyring(value){
 try{
  if(!exact(value,'formatVersion,vaultId,username,password,devices,recovery,auth')||value.formatVersion!==3||!/^[-a-f0-9]{36}$/.test(value.vaultId)||typeof value.username!=='string'||value.username.length>80||/[\x00-\x1f]/.test(value.username)||!hex(value.auth,64)||!Array.isArray(value.devices)||value.devices.length>64)throw new Error();
  if(value.password!==null&&(!exact(value.password,'salt,wrapped')||!hex(value.password.salt,64)||!b64(value.password.wrapped,68)))throw new Error();
  if(value.recovery!==null&&(!exact(value.recovery,'id,wrapped')||!hex(value.recovery.id,32)||!b64(value.recovery.wrapped,68)))throw new Error();
  const ids=new Set();for(const device of value.devices){if(!exact(device,'identity,wrapped')||!b64(device.wrapped,384))throw new Error();validatePublicDevice(device.identity);if(ids.has(device.identity.id))throw new Error();ids.add(device.identity.id);}
  if(!value.devices.length&&!value.password&&!value.recovery)throw new Error();return value;
 }catch{throw new AppError('ACCESS_FORMAT');}
}
export function authenticateKeyring(value,vault){validateKeyring(value);if(vault?.id!==value.vaultId||!Buffer.isBuffer(vault.key)||vault.key.length!==32||!timingSafeEqual(Buffer.from(tag(value,vault.key),'hex'),Buffer.from(value.auth,'hex')))throw new AppError('ENCRYPTION_DAMAGED');return vault;}
export function finishKeyring(value,vault){value.auth=tag(value,vault.key);validateKeyring(value);return value;}
function deviceSlot(value,identity,key){
 validatePublicDevice(identity);
 const wrapped=publicEncrypt({key:Buffer.from(identity.publicKey,'base64'),format:'der',type:'spki',padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256',oaepLabel:Buffer.from(aad(value,'device/'+identity.id))},key);
 return {identity:structuredClone(identity),wrapped:wrapped.toString('base64')};
}
async function passwordSlot(value,password,key){
 if(!validPassword(password))throw new AppError('ACCESS_INVALID');const salt=randomBytes(32).toString('hex'),wrapping=await passwordKey(password,salt);
 try{return {salt,wrapped:seal(key,wrapping,aad(value,'password/'+value.username)).toString('base64')};}finally{wrapping.fill(0);}
}
export async function createKeyring({username='',password='',deviceStore,vault={id:randomUUID(),key:randomBytes(32)}}={}){
 if(typeof username!=='string'||username.length>80||/[\x00-\x1f]/.test(username)||typeof password!=='string')throw new AppError('ACCESS_INVALID');
 const value={formatVersion:3,vaultId:vault.id,username:username.trim(),password:null,devices:[],recovery:null,auth:''};
 try{if(password)value.password=await passwordSlot(value,password,vault.key);else value.devices.push(deviceSlot(value,await deviceStore.identity(),vault.key));
 return {value:finishKeyring(value,vault),vault};}catch(error){vault.key.fill(0);throw error;}
}
export async function unlockKeyring(value,{username='',password='',recovery='',deviceStore}={}){
 validateKeyring(value);let key;
 try{
  if(recovery){
   if(!value.recovery||typeof recovery!=='string'||!/^obs-recovery-v1-[A-Za-z0-9_-]{43}$/.test(recovery))throw new Error();
   const secret=Buffer.from(recovery.slice('obs-recovery-v1-'.length),'base64url');try{key=unseal(Buffer.from(value.recovery.wrapped,'base64'),secret,aad(value,'recovery/'+value.recovery.id));}finally{secret.fill(0);}
  }else if(password){
   if(!value.password||typeof password!=='string'||password.length>1024||username.trim()!==value.username)throw new Error();
   const wrapping=await passwordKey(password,value.password.salt);try{key=unseal(Buffer.from(value.password.wrapped,'base64'),wrapping,aad(value,'password/'+value.username));}finally{wrapping.fill(0);}
  }else{
   const current=await deviceStore.read(),slot=value.devices.find(d=>d.identity.id===current?.public.id);if(!slot)throw new AppError('DEVICE_UNKNOWN');
   const {key:privateKey}=await deviceStore.privateKey();
   key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256',oaepLabel:Buffer.from(aad(value,'device/'+slot.identity.id))},Buffer.from(slot.wrapped,'base64'));
  }
  const vault={id:value.vaultId,key};authenticateKeyring(value,vault);return vault;
 }catch(error){key?.fill(0);if(['DEVICE_UNAVAILABLE','DEVICE_UNKNOWN','DEVICE_INVALID'].includes(error.code)||key&&error.code==='ENCRYPTION_DAMAGED')throw error;throw new AppError('ACCESS_DENIED');}
}
export function grantDevice(value,vault,identity){
 authenticateKeyring(value,vault);validatePublicDevice(identity);const next=structuredClone(value);
 if(!next.devices.some(d=>d.identity.id===identity.id)){if(next.devices.length>=64)throw new AppError('LIMIT');next.devices.push(deviceSlot(next,identity,vault.key));}
 return finishKeyring(next,vault);
}
export function recoveryKey(value,vault){
 authenticateKeyring(value,vault);const next=structuredClone(value),secret=randomBytes(32),id=randomBytes(16).toString('hex');
 try{next.recovery={id,wrapped:seal(vault.key,secret,aad(value,'recovery/'+id)).toString('base64')};return {value:finishKeyring(next,vault),recovery:'obs-recovery-v1-'+secret.toString('base64url')};}finally{secret.fill(0);}
}
export async function changeKeyringPassword(value,vault,{username='',password='',deviceStore}){
 authenticateKeyring(value,vault);const next=structuredClone(value);
 if(typeof username!=='string'||username.length>80||/[\x00-\x1f]/.test(username)||typeof password!=='string')throw new AppError('ACCESS_INVALID');
 next.username=username.trim();
 if(password){
  next.password=await passwordSlot(next,password,vault.key);
  const own=await deviceStore.read();next.devices=next.devices.filter(d=>d.identity.id!==own?.public.id);
 }else{
  const identity=await deviceStore.identity();if(!next.devices.some(d=>d.identity.id===identity.id))next.devices.push(deviceSlot(next,identity,vault.key));next.password=null;
 }
 return finishKeyring(next,vault);
}
