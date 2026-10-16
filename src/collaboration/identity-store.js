import path from 'node:path';
import {mkdir,readFile,realpath} from 'node:fs/promises';
import {createHash,createPrivateKey,createPublicKey,sign,verify,constants} from 'node:crypto';
import {DeviceStore,validatePublicDevice} from '../security/device-store.js';
import {assertRegular,atomicWrite,serialize} from '../storage.js';
import {AppError} from '../errors.js';
import {exact} from '../modules/validation.js';
import {identityLease} from './identity-lease.js';

const roles=['signing','encryption'],digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const valid=condition=>{if(!condition)throw new AppError('DEVICE_INVALID');};
export const collaborationPairId=pair=>digest(roles.map(role=>pair[role].public.id));
const publicPair=pair=>Object.fromEntries(roles.map(role=>[role,pair[role]?.public??null]));
function validateKey(value){
 valid(exact(value,['public','protectedKey']));validatePublicDevice(value.public);
 valid(typeof value.protectedKey==='string'&&value.protectedKey.length>0&&value.protectedKey.length<=25000&&Buffer.from(value.protectedKey,'base64').toString('base64')===value.protectedKey);
}
function privateKey(bytes,identity){
 const key=createPrivateKey({key:bytes,format:'der',type:'pkcs8'});
 const publicKey=createPublicKey(key);valid(publicKey.export({format:'der',type:'spki'}).toString('base64')===identity.publicKey);
 const challenge=Buffer.from('Observanda/collaboration-identity/check/v1');
 valid(verify('sha256',challenge,{key:publicKey,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32},sign('sha256',challenge,{key,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32})));return key;
}

// Recovery activates BOTH OS-protected keys through one atomic file. Original
// keys and previous recovered pairs stay available. Workspace-unlock and
// record-review keys belong to their existing independent owners.
export class CollaborationIdentityStore{
 constructor(device){this.device=device;this.file=device.file+'.collaboration-identities';}
 legacy(role){if(!roles.includes(role))throw new AppError('INVALID');return new DeviceStore({file:this.device.file+'.organization-'+role,protector:this.device.protector});}
 async read(){
  const stat=await assertRegular(this.file,{missing:true});if(!stat)return {version:1,active:null,pairs:[]};valid(stat.size<=1024*1024);
  try{
   const value=JSON.parse(await readFile(this.file,'utf8'));
   valid(exact(value,['version','active','pairs'])&&value.version===1&&Array.isArray(value.pairs)&&value.pairs.length<=16);
   const ids=new Set();for(const pair of value.pairs){valid(exact(pair,['id','signing','encryption']));for(const role of roles)validateKey(pair[role]);valid(pair.signing.public.id!==pair.encryption.public.id&&pair.id===collaborationPairId(pair)&&!ids.has(pair.id));ids.add(pair.id);}
   valid(value.active===null||ids.has(value.active));return value;
  }catch{throw new AppError('DEVICE_INVALID');}
 }
 async state(){
  const value=await this.read(),legacy={};for(const role of roles)legacy[role]=await this.legacy(role).read();
  const original=publicPair(legacy),current=value.active?publicPair(value.pairs.find(p=>p.id===value.active)):original;
  return {etag:digest([value,original]),active:value.active,current,saved:[...(original.signing||original.encryption?[{id:null,...original}]:[]),...value.pairs.map(pair=>({id:pair.id,...publicPair(pair)}))]};
 }
 async key(role){if(!roles.includes(role))throw new AppError('INVALID');const value=await this.read();return value.active?value.pairs.find(p=>p.id===value.active)[role]:null;}
 async identity(role){const stored=await this.key(role);return stored?.public??this.legacy(role).identity();}
 async privateKey(role){
  const stored=await this.key(role);
  if(!stored){const legacy=this.legacy(role);await legacy.identity();return legacy.privateKey();}
  const bytes=await this.device.protector.unprotect(Buffer.from(stored.protectedKey,'base64'));
  try{return {identity:stored.public,key:privateKey(bytes,stored.public)};}finally{bytes.fill(0);}
 }
 async withLock(run){
  if(!this.device.available())throw new AppError('DEVICE_UNAVAILABLE');
  await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});await assertRegular(path.dirname(this.file),{directory:true});
  const canonical=path.join(await realpath(path.dirname(this.file)),path.basename(this.file)),lease=await identityLease(canonical,{lockFile:canonical+'.lock'});
  try{return await run();}finally{await lease.close();}
 }
 async mutate(expected,update,unchanged){
  return this.withLock(async()=>{
   const value=await this.read();
   if(unchanged&&await unchanged(value))return this.state();
   if((await this.state()).etag!==expected)throw new AppError('COLLABORATION_IDENTITY_CHANGED');
   await update(value);await atomicWrite(this.file,serialize(value));return this.state();
  });
 }
 async restore(pair,expected){
  for(const role of roles){validatePublicDevice(pair[role].public);privateKey(pair[role].bytes,pair[role].public);}
  valid(pair.signing.public.id!==pair.encryption.public.id);
  return this.mutate(expected,async value=>{
   const id=collaborationPairId(pair),index=value.pairs.findIndex(p=>p.id===id),stored={id};
   if(index<0&&value.pairs.length>=16)throw new AppError('LIMIT');
   for(const role of roles)stored[role]={public:pair[role].public,protectedKey:(await this.device.protector.protect(pair[role].bytes)).toString('base64')};
   if(index<0)value.pairs.push(stored);else value.pairs[index]=stored;
   value.active=id;
  },async value=>{
   if(value.active!==collaborationPairId(pair))return false;
   // A lost acknowledgement is safe to retry. If local protection is damaged,
   // a verified backup can repair it after the caller reviews the current state.
   try{for(const role of roles)await this.privateKey(role);return true;}catch{return false;}
  });
 }
 async activate(id,expected){
  const check=async value=>{
   const pair=value.pairs.find(pair=>pair.id===id);if(id!==null&&!pair)throw new AppError('NOT_FOUND');
   if(id===null&&!(await this.legacy('signing').read())&&!(await this.legacy('encryption').read()))throw new AppError('NOT_FOUND');
   // Verify both protected keys before switching. A damaged saved identity
   // cannot displace a working one.
   for(const role of roles){const stored=id===null?await this.legacy(role).read():pair[role];if(!stored)continue;const bytes=await this.device.protector.unprotect(Buffer.from(stored.protectedKey,'base64'));try{privateKey(bytes,stored.public);}finally{bytes.fill(0);}}
  };
  return this.mutate(expected,async value=>{await check(value);value.active=id;},async value=>{if(value.active!==id)return false;await check(value);return true;});
 }
}

export class CollaborationKey{
 constructor(device,role){if(!roles.includes(role))throw new AppError('INVALID');this.store=new CollaborationIdentityStore(device);this.role=role;}
 identity(){return this.store.identity(this.role);}
 privateKey(){return this.store.privateKey(this.role);}
}
