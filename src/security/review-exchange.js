import {createHash,createPublicKey,randomBytes,sign,verify,constants,publicEncrypt,privateDecrypt,createCipheriv,createDecipheriv} from 'node:crypto';
import {identityText} from '../collaboration/identity.js';
import {DeviceStore,validatePublicDevice} from './device-store.js';
import {exact,text,requireValue} from '../modules/validation.js';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const reviewText=v=>JSON.stringify(canonical(v));
export const reviewHash=v=>createHash('sha256').update(reviewText(v)).digest('hex');
const fail=()=>{throw Error('Review file could not be authenticated. Check the recipient and verified contact.');};
const key=identity=>createPublicKey({key:Buffer.from(identity.publicKey,'base64'),format:'der',type:'spki'});
export function validateContact(c){requireValue(exact(c,['format','signing','encryption'])&&c.format==='observanda-review-contact-v1','Review contact');validatePublicDevice(c.signing);validatePublicDevice(c.encryption);requireValue(c.signing.id!==c.encryption.id,'Independent signing and encryption keys');return c;}
const signedBytes=value=>Buffer.from('observanda-review-signature-v1\n'+reviewText(value));
export function verifySigned(signed){
 try{if(!exact(signed,['value','signature'])||!text(signed.signature,600,true)||Buffer.from(signed.signature,'base64').toString('base64')!==signed.signature)fail();const sender=validateContact(signed.value.sender);if(!verify('sha256',signedBytes(signed.value),{key:key(sender.signing),padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32},Buffer.from(signed.signature,'base64')))fail();return signed.value;}catch{fail();}
}
export class ReviewIdentity{
 constructor(device){this.signer=new DeviceStore({file:device.file+'.review-signing',protector:device.protector});this.box=new DeviceStore({file:device.file+'.review-encryption',protector:device.protector});}
 streamIdentity(){
  const owner=this;return {signer:{async sign(value){const {identity,key}=await owner.signer.privateKey();return {identity,value,signature:sign('sha256',Buffer.from('Observanda/organization-command/v1\n'+identityText(value)),{key,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32}).toString('base64')};}},async unwrap(header){const {identity,key}=await owner.box.privateKey();if(header.recipient!==identity.id)fail();const secret=privateDecrypt({key,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256',oaepLabel:Buffer.from('Observanda/collaboration-package/v1/'+header.id)},Buffer.from(header.key,'base64'));if(secret.length!==32){secret.fill(0);fail();}return secret;}};
 }
 async contact(){return {format:'observanda-review-contact-v1',signing:await this.signer.identity(),encryption:await this.box.identity()};}
 async sign(value){const sender=await this.contact();requireValue(reviewHash(value.sender)===reviewHash(sender),'Signing identity');const {key}=await this.signer.privateKey();return {value,signature:sign('sha256',signedBytes(value),{key,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32}).toString('base64')};}
 async seal(signed,recipient){validateContact(recipient);verifySigned(signed);const plain=Buffer.from(reviewText(signed));requireValue(plain.length<=750000,'Send up to 750 KB of selected record text per review');const secret=randomBytes(32),nonce=randomBytes(12),recipientId=reviewHash(recipient),header={format:'observanda-review-file-v1',recipient:recipientId};
  try{const cipher=createCipheriv('aes-256-gcm',secret,nonce);cipher.setAAD(Buffer.from(reviewText(header)));const data=Buffer.concat([cipher.update(plain),cipher.final()]);return {...header,key:publicEncrypt({key:key(recipient.encryption),padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256',oaepLabel:Buffer.from('observanda-review-v1')},secret).toString('base64'),nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};}finally{secret.fill(0);plain.fill(0);}
 }
 async open(file){
  let secret,plain;try{if(!exact(file,['format','recipient','key','nonce','tag','data'])||file.format!=='observanda-review-file-v1'||file.recipient!==reviewHash(await this.contact()))fail();for(const k of ['key','nonce','tag','data'])if(typeof file[k]!=='string'||file[k].length>1000000||Buffer.from(file[k],'base64').toString('base64')!==file[k])fail();if(Buffer.from(file.nonce,'base64').length!==12||Buffer.from(file.tag,'base64').length!==16)fail();const {key}=await this.box.privateKey();secret=privateDecrypt({key,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256',oaepLabel:Buffer.from('observanda-review-v1')},Buffer.from(file.key,'base64'));const decipher=createDecipheriv('aes-256-gcm',secret,Buffer.from(file.nonce,'base64'));decipher.setAAD(Buffer.from(reviewText({format:file.format,recipient:file.recipient})));decipher.setAuthTag(Buffer.from(file.tag,'base64'));plain=Buffer.concat([decipher.update(Buffer.from(file.data,'base64')),decipher.final()]);const signed=JSON.parse(plain.toString('utf8'));verifySigned(signed);return signed;}catch{fail();}finally{secret?.fill(0);plain?.fill(0);}
 }
}

// Only the peer-review owner selects this adapter. The recipient is the same
// verified review contact; ordinary collaboration transport keeps its defaults.
export const reviewExchangeKeys=Object.freeze({recipient:contact=>validateContact(contact).encryption,wrap(contact,id,secret){return publicEncrypt({key:key(validateContact(contact).encryption),padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256',oaepLabel:Buffer.from('Observanda/collaboration-package/v1/'+id)},secret).toString('base64');}});
