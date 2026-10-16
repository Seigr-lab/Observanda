import {publicEncrypt,privateDecrypt,constants,createPublicKey} from 'node:crypto';
import {validatePublicDevice} from '../security/device-store.js';
import {CollaborationKey} from './identity-store.js';
import {OrganizationIdentity,verifyOrganizationCommand} from './identity.js';
import {AppError} from '../errors.js';
import {exact} from '../modules/validation.js';

export function exchangeContact(signed){
 const value=verifyOrganizationCommand(signed);
 if(!exact(value,['kind','encryption'])||value.kind!=='collaboration.contact')throw new AppError('COLLABORATION_SIGNATURE');
 validatePublicDevice(value.encryption);
 if(value.encryption.id===signed.identity.id)throw new AppError('COLLABORATION_SIGNATURE');
 return value.encryption;
}
const label=id=>Buffer.from('Observanda/collaboration-package/v1/'+id);
export function wrapExchangeKey(contact,id,key){
 const encryption=exchangeContact(contact),publicKey=createPublicKey({key:Buffer.from(encryption.publicKey,'base64'),format:'der',type:'spki'});
 return publicEncrypt({key:publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256',oaepLabel:label(id)},key).toString('base64');
}
export class ExchangeIdentity{
 constructor(device){this.signer=new OrganizationIdentity(device);this.box=new CollaborationKey(device,'encryption');}
 async contact(){return this.signer.sign({kind:'collaboration.contact',encryption:await this.box.identity()});}
 async unwrap(header){
  try{
   const {identity,key}=await this.box.privateKey();if(header.recipient!==identity.id)throw Error();
   const secret=privateDecrypt({key,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256',oaepLabel:label(header.id)},Buffer.from(header.key,'base64'));
   if(secret.length!==32){secret.fill(0);throw Error();}return secret;
  }catch{throw new AppError('COLLABORATION_PACKAGE');}
 }
}
