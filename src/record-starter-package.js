import {randomBytes} from 'node:crypto';
import {passwordKey,seal,unseal} from './encryption.js';
import {AppError} from './errors.js';
import {validStarter,starterKeys,starterText,STARTER_PACKAGE_BYTES} from './web/record-starter-model.js';
import {revisionText,revisionId} from './web/revision-model.js';
import {digest} from './storage.js';
const MAGIC=Buffer.from('OBSSTART1'),AAD=Buffer.from('Observanda record starter package v1');
export const packageDigest=value=>digest(revisionText(value));
const passwordCheck=password=>{if(typeof password!=='string'||password.length<12||password.length>1024)throw new AppError('STARTER_PASSWORD');};
function validate(value){
 if(!starterKeys(value,['version','blueprint','sourceRelease','sourceNumber','releaseMetadata'])||value.version!==1||!validStarter(value.blueprint,{legacy:true})||!revisionId(value.sourceRelease)||!Number.isSafeInteger(value.sourceNumber)||value.sourceNumber<1)throw new AppError('STARTER_PACKAGE');
 const m=value.releaseMetadata;
 if(!starterKeys(m,['createdAt','previousRevision','note'])||!starterText(m.createdAt,30,true)||!Number.isFinite(Date.parse(m.createdAt))||!revisionId(m.previousRevision)||!starterText(m.note,2000,true)||packageDigest({version:1,number:value.sourceNumber,...m,blueprint:value.blueprint})!==value.sourceRelease)throw new AppError('STARTER_PACKAGE');
 return value;
}
export async function sealStarter(value,password){
 passwordCheck(password);validate(value);
 const salt=randomBytes(16),key=await passwordKey(password,salt);
 try{return Buffer.concat([MAGIC,salt,seal(Buffer.from(JSON.stringify(value)),key,AAD)]).toString('base64');}finally{key.fill(0);}
}
export async function openStarter(encoded,password){
 passwordCheck(password);
 if(typeof encoded!=='string'||encoded.length>STARTER_PACKAGE_BYTES*2||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new AppError('STARTER_PACKAGE');
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.toString('base64')!==encoded||bytes.length>STARTER_PACKAGE_BYTES||bytes.length<61||!bytes.subarray(0,9).equals(MAGIC))throw new AppError('STARTER_PACKAGE');
 const key=await passwordKey(password,bytes.subarray(9,25));let plain;
 try{plain=unseal(bytes.subarray(25),key,AAD);return validate(JSON.parse(plain.toString('utf8')));}catch{throw new AppError('STARTER_PACKAGE');}finally{key.fill(0);plain?.fill(0);}
}
