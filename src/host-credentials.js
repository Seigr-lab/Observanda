// Passwords for publishing to a web host over FTP or FTPS. They belong to this
// computer, never to a workspace, so a copied or shared workspace carries none.
// Each password is encrypted with a fresh AES-256-GCM key that is wrapped for
// this computer's device key, which the operating system protects. Where this
// computer has no device key store, a password is held only for this session.
import {createCipheriv,createDecipheriv,createHash,createPublicKey,publicEncrypt,privateDecrypt,randomBytes,constants} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {AppError} from './errors.js';
import {atomicWrite,serialize} from './storage.js';
import {withWriterLease} from './writer-lease.js';

const validPassword=value=>typeof value==='string'&&value.length>0&&value.length<=1024&&!/[\x00\r\n]/.test(value);
export const hostCredentialKey=({protocol,host,port,user})=>createHash('sha256').update(JSON.stringify([protocol,String(host).toLowerCase(),port,user])).digest('hex');
const oaep=key=>({key,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'});

export class HostCredentials{
 constructor({file,deviceStore}){if(!file)throw new AppError('INVALID');this.file=file;this.deviceStore=deviceStore;this.session=new Map();}
 persistent(){return !!this.deviceStore?.available?.();}
 async entries(){
  try{const value=JSON.parse(await readFile(this.file,'utf8'));if(value?.format!==1||!value.entries||typeof value.entries!=='object')throw new AppError('ACCESS_FORMAT');return value.entries;}
  catch(error){if(error.code==='ENOENT')return {};if(error instanceof AppError)throw error;throw new AppError('ACCESS_FORMAT');}
 }
 async update(change){
  await withWriterLease(this.file+'.lock',async()=>{const entries=await this.entries();change(entries);await atomicWrite(this.file,serialize({format:1,entries}));});
 }
 async has(destination){const key=hostCredentialKey(destination);return this.session.has(key)||Object.hasOwn(await this.entries(),key);}
 async save(destination,password,{remember=true}={}){
  if(!validPassword(password))throw new AppError('PUBLISH_PASSWORD');
  const key=hostCredentialKey(destination);
  if(!remember||!this.persistent()){this.session.set(key,password);await this.update(entries=>{delete entries[key];});return {remembered:false};}
  const identity=await this.deviceStore.identity(),secret=randomBytes(32),iv=randomBytes(12);
  try{
   const cipher=createCipheriv('aes-256-gcm',secret,iv);cipher.setAAD(Buffer.from(key));
   const data=Buffer.concat([cipher.update(password,'utf8'),cipher.final()]);
   const wrapped=publicEncrypt(oaep(createPublicKey({key:Buffer.from(identity.publicKey,'base64'),format:'der',type:'spki'})),secret);
   const entry={device:identity.id,wrapped:wrapped.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
   await this.update(entries=>{entries[key]=entry;});this.session.delete(key);return {remembered:true};
  }finally{secret.fill(0);}
 }
 async read(destination){
  const key=hostCredentialKey(destination);if(this.session.has(key))return this.session.get(key);
  const entry=(await this.entries())[key];if(!entry)throw new AppError('PUBLISH_PASSWORD');
  if(!this.persistent())throw new AppError('PUBLISH_PASSWORD');
  const {identity,key:privateKey}=await this.deviceStore.privateKey();if(identity.id!==entry.device)throw new AppError('PUBLISH_PASSWORD');
  let secret;
  try{
   secret=privateDecrypt(oaep(privateKey),Buffer.from(entry.wrapped,'base64'));
   const decipher=createDecipheriv('aes-256-gcm',secret,Buffer.from(entry.iv,'base64'));decipher.setAAD(Buffer.from(key));decipher.setAuthTag(Buffer.from(entry.tag,'base64'));
   const password=Buffer.concat([decipher.update(Buffer.from(entry.data,'base64')),decipher.final()]).toString('utf8');
   if(!validPassword(password))throw new Error();return password;
  }catch{throw new AppError('PUBLISH_PASSWORD');}finally{secret?.fill(0);}
 }
 async forget(destination){const key=hostCredentialKey(destination);this.session.delete(key);await this.update(entries=>{delete entries[key];});}
}
export const hostCredentialsFile=preferencesFile=>path.resolve(preferencesFile)+'.host-credentials.json';
