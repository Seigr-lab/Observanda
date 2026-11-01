import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {AppError} from './errors.js';

// Issuance is a local service/desktop capability, never an HTTP endpoint.
// Claim synchronously before any asynchronous unlock or session preparation.
export class LaunchCapabilities{
 constructor({now=()=>performance.now(),lifetime=120000,maximum=16}={}){if(typeof now!=='function'||!Number.isSafeInteger(lifetime)||lifetime<1||!Number.isSafeInteger(maximum)||maximum<1)throw new AppError('INVALID');this.now=now;this.lifetime=lifetime;this.maximum=maximum;this.tokens=new Map();}
 issue(){
  const now=this.now();for(const [token,item] of this.tokens)if(item.expires<=now)this.tokens.delete(token);
  while(this.tokens.size>=this.maximum)this.tokens.delete(this.tokens.keys().next().value);
  const token=randomBytes(32).toString('hex');this.tokens.set(token,{expires:now+this.lifetime,binding:null,receipt:null});return token;
 }
 consume(token){
  this.claim(token).complete(null);
 }
 claim(token,binding){
  const item=this.tokens.get(token);
  if(!item||item.expires<=this.now()||binding!==undefined&&(typeof binding!=='string'||!/^[a-f0-9]{64}$/.test(binding)))throw new AppError('AUTH');
  if(item.receipt){if(binding===undefined||binding!==item.binding)throw new AppError('AUTH');return {replay:item.receipt.promise};}
  if(item.binding!==null&&item.binding!==binding)throw new AppError('AUTH');
  item.binding=binding;const receipt=Promise.withResolvers();item.receipt=receipt;receipt.promise.catch(()=>{});
  // Native callers without a browser binding receive strictly one-use tokens.
  if(binding===undefined)this.tokens.delete(token);
  return {complete:value=>receipt.resolve(value),fail:error=>{item.receipt=null;receipt.reject(error);}};
 }
 clear(){this.tokens.clear();}
}
