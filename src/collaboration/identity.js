import {createHash,createPublicKey,sign,verify,constants} from 'node:crypto';
import {validatePublicDevice} from '../security/device-store.js';
import {CollaborationKey} from './identity-store.js';
import {AppError} from '../errors.js';
import {exact} from '../modules/validation.js';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const identityText=value=>JSON.stringify(canonical(value));
export const identityHash=value=>createHash('sha256').update(identityText(value)).digest('hex');
const bytes=value=>Buffer.from('Observanda/organization-command/v1\n'+identityText(value));

// Membership signatures use a key separate from encryption and record reviews.
export class OrganizationIdentity {
  constructor(device){this.store=new CollaborationKey(device,'signing');}
  public(){return this.store.identity();}
  async sign(value){
    const {identity,key}=await this.store.privateKey();
    return {identity,value,signature:sign('sha256',bytes(value),{key,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32}).toString('base64')};
  }
}
export function verifyOrganizationCommand(command){
  try{
    if(!exact(command,['identity','value','signature'])||typeof command.signature!=='string'||command.signature.length!==512)throw Error();
    validatePublicDevice(command.identity);
    const signature=Buffer.from(command.signature,'base64');
    if(signature.toString('base64')!==command.signature||signature.length!==384)throw Error();
    const key=createPublicKey({key:Buffer.from(command.identity.publicKey,'base64'),format:'der',type:'spki'});
    if(!verify('sha256',bytes(command.value),{key,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32},signature))throw Error();
    return command.value;
  }catch{throw new AppError('COLLABORATION_SIGNATURE');}
}
