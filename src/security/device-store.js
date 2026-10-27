import path from 'node:path';
import os from 'node:os';
import {readFile} from 'node:fs/promises';
import {createPersistentDirectory as mkdir} from '../filesystem-persistence.js';
import {withWriterLease} from '../writer-lease.js';
import {spawn} from 'node:child_process';
import {generateKeyPair,createPrivateKey,createPublicKey,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {assertRegular,atomicWrite,serialize} from '../storage.js';
import {AppError} from '../errors.js';
import {setTimeout as delay} from 'node:timers/promises';
const generate=promisify(generateKeyPair);
const creatingIdentities=new Map();
export const deviceFingerprint=publicKey=>createHash('sha256').update(Buffer.from(publicKey,'base64')).digest('hex');
export function validatePublicDevice(value){
 try{
  if(!value||value.format!=='observanda-device-v1'||Object.keys(value).sort().join()!=='format,id,publicKey'||typeof value.publicKey!=='string'||value.publicKey.length>1200||!/^[a-f0-9]{64}$/.test(value.id))throw new Error();
  const bytes=Buffer.from(value.publicKey,'base64'),key=createPublicKey({key:bytes,format:'der',type:'spki'});
  if(bytes.toString('base64')!==value.publicKey||key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength!==3072||deviceFingerprint(value.publicKey)!==value.id)throw new Error();
  return value;
 }catch{throw new AppError('DEVICE_INVALID');}
}
export class WindowsProtector{
 available(){return process.platform==='win32';}
 async transform(operation,bytes){
  if(!this.available())throw new AppError('DEVICE_UNAVAILABLE');
  const command=path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  return new Promise((resolve,reject)=>{
   const child=spawn(command,['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./protect-key.ps1',import.meta.url))],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
   let output='',failed=false;const timer=setTimeout(()=>{failed=true;child.kill();},15000);timer.unref();
   child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>32768){failed=true;child.kill();}});
   child.stderr.resume();child.stdin.on('error',()=>{});child.once('error',()=>{failed=true;});
   child.once('close',code=>{clearTimeout(timer);const value=output.trim();if(failed||code!==0||!value||!/^[A-Za-z0-9+/=]+$/.test(value))reject(new AppError('DEVICE_UNAVAILABLE'));else resolve(Buffer.from(value,'base64'));});
   child.stdin.end(JSON.stringify({operation,bytes:bytes.toString('base64')}));
  });
 }
 protect(bytes){return this.transform('protect',bytes);}
 unprotect(bytes){return this.transform('unprotect',bytes);}
}
export class DeviceStore{
 constructor({file=path.join(os.homedir(),'.observanda','security','device.json'),protector=new WindowsProtector()}={}){this.file=file;this.protector=protector;}
 available(){return this.protector.available();}
 async read(){
  const stat=await assertRegular(this.file,{missing:true});if(!stat)return null;if(stat.size>32768)throw new AppError('DEVICE_INVALID');
  try{
   const value=JSON.parse(await readFile(this.file,'utf8'));validatePublicDevice(value.public);
   if(value.format!==1||Object.keys(value).sort().join()!=='format,protectedKey,public'||typeof value.protectedKey!=='string'||!value.protectedKey||value.protectedKey.length>25000||Buffer.from(value.protectedKey,'base64').toString('base64')!==value.protectedKey)throw new Error();
   return value;
  }catch{throw new AppError('DEVICE_INVALID');}
 }
 async identity(){
  if(!this.available())throw new AppError('DEVICE_UNAVAILABLE');
  const resolved=path.resolve(this.file),key=process.platform==='win32'?resolved.toLowerCase():resolved;
  if(creatingIdentities.has(key))return creatingIdentities.get(key);
  const pending=this.createIdentity();creatingIdentities.set(key,pending);
  try{return await pending;}finally{if(creatingIdentities.get(key)===pending)creatingIdentities.delete(key);}
 }
 async createIdentity(){
  const current=await this.read();if(current)return current.public;
  await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});await assertRegular(path.dirname(this.file),{directory:true});
  const deadline=Date.now()+20000;
  for(;;)try{return await withWriterLease(this.file+'.lock',async()=>{
   const existing=await this.read();if(existing)return existing.public;
   const keys=await generate('rsa',{modulusLength:3072,publicExponent:0x10001});
   const publicKey=keys.publicKey.export({format:'der',type:'spki'}).toString('base64'),privateBytes=keys.privateKey.export({format:'der',type:'pkcs8'});
   try{
    const protectedBytes=await this.protector.protect(privateBytes),identity={format:'observanda-device-v1',id:deviceFingerprint(publicKey),publicKey};
    await atomicWrite(this.file,serialize({format:1,public:identity,protectedKey:protectedBytes.toString('base64')}));return identity;
   }finally{privateBytes.fill(0);}
  });}catch(error){if(error.code!=='LOCKED'||Date.now()>=deadline)throw error;await delay(50);}
 }
 async privateKey(){
  const current=await this.read();if(!current)throw new AppError('DEVICE_UNKNOWN');
  const bytes=await this.protector.unprotect(Buffer.from(current.protectedKey,'base64'));
  try{
   const key=createPrivateKey({key:bytes,format:'der',type:'pkcs8'});
   if(createPublicKey(key).export({format:'der',type:'spki'}).toString('base64')!==current.public.publicKey)throw new AppError('DEVICE_INVALID');
   return {identity:current.public,key};
  }finally{bytes.fill(0);}
 }
}
export const defaultDeviceStore=new DeviceStore();
