import {SEGMENTED_ENVELOPE,unsealSegmentedFile} from './segmented-file-format.js';
import {createCipheriv,createDecipheriv,randomBytes,scrypt} from 'node:crypto';
import {promisify} from 'node:util';
import {AppError} from './errors.js';

const derive=promisify(scrypt);
export const ENVELOPE=Buffer.from('OBSENC01');
export const ENCRYPTION_OVERHEAD=36;
export const encrypted=bytes=>bytes.subarray(0,8).equals(ENVELOPE)||bytes.subarray(0,8).equals(SEGMENTED_ENVELOPE);
export const passwordKey=(password,salt)=>derive(password,salt,32,{N:131072,r:8,p:1,maxmem:160*1024*1024});
export function seal(bytes,key,aad){
  if(!key)throw new AppError('ACCESS_LOCKED');
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce,{authTagLength:16});
  cipher.setAAD(Buffer.from(aad));const content=Buffer.concat([cipher.update(bytes),cipher.final()]);
  return Buffer.concat([ENVELOPE,nonce,cipher.getAuthTag(),content]);
}
export function unseal(bytes,key,aad){
  if(!key)throw new AppError('ACCESS_LOCKED');
  try{
    if(bytes.subarray(0,8).equals(SEGMENTED_ENVELOPE))return unsealSegmentedFile(bytes,key,aad);
    if(bytes.length<ENCRYPTION_OVERHEAD||!encrypted(bytes))throw new Error();
    const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(8,20),{authTagLength:16});
    decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(bytes.subarray(20,36));
    return Buffer.concat([decipher.update(bytes.subarray(36)),decipher.final()]);
  }catch{throw new AppError('ENCRYPTION_DAMAGED');}
}
export function clearVault(vault){vault?.key?.fill(0);if(vault)vault.key=null;}
export const cloneVault=vault=>vault?.key?{id:vault.id,key:Buffer.from(vault.key)}:{id:vault?.id??null,key:null};
