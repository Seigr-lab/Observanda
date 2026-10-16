import path from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {assertRegular,atomicWrite,digest} from './storage.js';
import {AppError} from './errors.js';
import {CollaborationIdentityStore} from './collaboration/identity-store.js';
import {ExchangeIdentity} from './collaboration/exchange-identity.js';
import {USER_PROFILE_BYTES,emptyUserProfile,observandaUserId,validUserProfile} from './web/user-profile-model.js';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const aad=identity=>Buffer.from('Observanda/user-profile/v1/'+identity.id);
function binary(value,size){if(typeof value!=='string'||!value||Buffer.from(value,'base64').toString('base64')!==value)throw Error();const bytes=Buffer.from(value,'base64');if(size&&bytes.length!==size)throw Error();return bytes;}

// Profiles belong to the person on this installation, independently of workspace
// ownership. Each recovered signing identity has its own protected profile.
export class UserProfile{
 constructor(device){this.device=device;this.identity=new CollaborationIdentityStore(device);this.directory=device.file+'.user-profiles';}
 async withIdentity(run){
  return this.identity.withLock(async()=>run(await this.identity.identity('signing')));
 }
 file(identity){return path.join(this.directory,identity.id+'.json');}
 async read(identity){
  const directory=await assertRegular(this.directory,{directory:true,missing:true});
  const stat=directory?await assertRegular(this.file(identity),{missing:true}):null;
  if(!stat)return {userId:observandaUserId(identity.id),fingerprint:identity.id,etag:null,profile:emptyUserProfile()};
  if(stat.size>4*USER_PROFILE_BYTES)throw new AppError('USER_PROFILE_DAMAGED');
  let bytes,key;
  try{
   const envelope=JSON.parse(await readFile(this.file(identity),'utf8'));
   if(!exact(envelope,['format','protectedKey','nonce','tag','payload'])||envelope.format!==1)throw Error();
   key=await this.device.protector.unprotect(binary(envelope.protectedKey));if(key.length!==32)throw Error();
   const cipher=createDecipheriv('aes-256-gcm',key,binary(envelope.nonce,12));cipher.setAAD(aad(identity));cipher.setAuthTag(binary(envelope.tag,16));
   bytes=Buffer.concat([cipher.update(binary(envelope.payload)),cipher.final()]);
   if(bytes.length>USER_PROFILE_BYTES+256)throw Error();
   const value=JSON.parse(bytes.toString('utf8'));
   if(!exact(value,['version','userId','profile'])||value.version!==1||value.userId!==observandaUserId(identity.id)||!validUserProfile(value.profile))throw Error();
   return {userId:value.userId,fingerprint:identity.id,etag:digest(bytes),profile:value.profile};
  }catch{throw new AppError('USER_PROFILE_DAMAGED');}finally{bytes?.fill(0);key?.fill(0);}
 }
 state(){return this.withIdentity(identity=>this.read(identity));}
 save(command){
  if(!exact(command,['userId','expected','profile'])||!validUserProfile(command.profile)||command.expected!==null&&!/^[a-f0-9]{64}$/.test(command.expected))throw new AppError('USER_PROFILE_INVALID');
  command=structuredClone(command);
  return this.withIdentity(async identity=>{
   if(command.userId!==observandaUserId(identity.id))throw new AppError('USER_PROFILE_CHANGED');
   const current=await this.read(identity);if(current.etag!==command.expected)throw new AppError('USER_PROFILE_CHANGED');
   const bytes=Buffer.from(JSON.stringify({version:1,userId:current.userId,profile:command.profile})),key=randomBytes(32);
   try{
    const protectedKey=await this.device.protector.protect(key),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(aad(identity));
    const payload=Buffer.concat([cipher.update(bytes),cipher.final()]);
    await mkdir(this.directory,{recursive:true,mode:0o700});await assertRegular(this.directory,{directory:true});
    await atomicWrite(this.file(identity),JSON.stringify({format:1,protectedKey:protectedKey.toString('base64'),nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),payload:payload.toString('base64')})+'\n');
    return {...current,etag:digest(bytes),profile:structuredClone(command.profile)};
   }finally{bytes.fill(0);key.fill(0);}
  });
 }
 contact(userId){return this.withIdentity(async identity=>{
  if(userId!==observandaUserId(identity.id))throw new AppError('USER_PROFILE_CHANGED');
  return {userId,contact:await new ExchangeIdentity(this.device).contact()};
 });}
}
