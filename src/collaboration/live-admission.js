import {AsyncLocalStorage} from 'node:async_hooks';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {AppError} from '../errors.js';

const lifetime=30000,context=new AsyncLocalStorage();
const refuse=code=>{throw new AppError(code);};

// Challenge issuance allocates no retained peer state. The opaque 64-hex
// challenge keeps the existing signed protocol, and is bound to this host
// instance, its monotonic clock and the direct socket address (never a header).
export class LiveAdmission{
 constructor(instance,{now=()=>performance.now(),perPrincipal=128,principals=64}={}){
  if(!/^[a-f0-9]{48}$/.test(instance)||![perPrincipal,principals].every(n=>Number.isSafeInteger(n)&&n>0))refuse('INVALID');
  Object.assign(this,{instance,now,perPrincipal,principals});this.key=randomBytes(32);this.used=new Map();this.counts=new Map();this.nextExpiry=Infinity;
 }
 tag(body,address){return createHmac('sha256',this.key).update(JSON.stringify([this.instance,address,body])).digest().subarray(0,16);}
 issue(address){
  if(!this.key)refuse('SERVER_CLOSING');if(typeof address!=='string'||!address.length||address.length>64)refuse('INVALID');
  const body=Math.floor(this.now()).toString(16).padStart(12,'0')+randomBytes(10).toString('hex');return body+this.tag(body,address).toString('hex');
 }
 validate(nonce,address){
  if(!this.key)refuse('SERVER_CLOSING');
  if(typeof nonce!=='string'||!/^[a-f0-9]{64}$/.test(nonce)||!timingSafeEqual(this.tag(nonce.slice(0,32),address),Buffer.from(nonce.slice(32),'hex')))refuse('COLLABORATION_EXPIRED');
  const issued=parseInt(nonce.slice(0,12),16),now=this.now();if(issued>now||now>=issued+lifetime)refuse('COLLABORATION_EXPIRED');return issued+lifetime;
 }
 prune(now){
  if(now<this.nextExpiry)return;this.nextExpiry=Infinity;
  for(const [nonce,entry] of this.used){
   if(entry.expiry<=now){this.used.delete(nonce);const count=this.counts.get(entry.principal)-1;if(count)this.counts.set(entry.principal,count);else this.counts.delete(entry.principal);}
   else this.nextExpiry=Math.min(this.nextExpiry,entry.expiry);
  }
 }
 consume(nonce,address,principal){
  const expiry=this.validate(nonce,address);this.prune(this.now());
  if(this.used.has(nonce))refuse('COLLABORATION_EXPIRED');
  if(typeof principal!=='string'||!principal.length)refuse('COLLABORATION_DENIED');
  const count=this.counts.get(principal)??0;
  if(count>=this.perPrincipal||!count&&this.counts.size>=this.principals)refuse('ACCESS_WAIT');
  this.used.set(nonce,{principal,expiry});this.counts.set(principal,count+1);this.nextExpiry=Math.min(this.nextExpiry,expiry);
 }
 statistics(){return {used:this.used.size,principals:this.counts.size,maximum:this.perPrincipal*this.principals};}
 close(){this.key?.fill(0);this.key=null;this.used.clear();this.counts.clear();}
}

// Called after current membership and grant authorization in the protected
// transaction. Unenrolled identities cannot consume replay storage. Repeated
// access checks (including presence) do not consume the request twice.
export function admitLivePrincipal(principal){const admission=context.getStore();if(admission&&!admission.consumed){admission.consume(principal);admission.consumed=true;}}
export function withLiveAdmission(consume,operation){return context.run({consume,consumed:false},async()=>{const value=await operation();if(!context.getStore().consumed)refuse('COLLABORATION_DENIED');return value;});}
