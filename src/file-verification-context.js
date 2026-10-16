// A caller may own verification reuse for one awaited operation. File storage
// itself has no knowledge of projects, conversion or their proof lifecycle.
import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
export function withFileVerificationScope(verify,operation){
 if(typeof verify!=='function'||typeof operation!=='function')throw new TypeError('Invalid verification scope');return context.run(verify,operation);
}
export function scopedFileVerification(content,verify,options){const owner=context.getStore();return owner?owner(content,verify,options):verify();}
