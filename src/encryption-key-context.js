// Native cipher preparation belongs to an explicit operation or transaction.
// Compare current bytes before reuse; clear the context when its owner closes.
import {createSecretKey} from 'node:crypto';
import {AppError} from './errors.js';
export class EncryptionKeyContext{
 #bytes=null;
 #key=null;
 get(bytes){
  if(!bytes){this.clear();throw new AppError('ACCESS_LOCKED');}
  if(!this.#bytes?.equals(bytes)){
   this.clear();this.#bytes=Buffer.from(bytes);this.#key=createSecretKey(bytes);
  }
  return this.#key;
 }
 clear(){this.#bytes?.fill(0);this.#bytes=null;this.#key=null;}
}
