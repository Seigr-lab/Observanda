import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {AppError} from './errors.js';

// Native browser downloads can bypass service workers. Authorize one exact GET
// without exposing a general session credential in a URL or host cookie.
export class DownloadCapabilities{
 constructor({now=()=>performance.now(),lifetime=120000,maximum=128}={}){this.now=now;this.lifetime=lifetime;this.maximum=maximum;this.pending=new Map();}
 issue(session,context,target){
  if(typeof session!=='string'||!/^[a-f0-9]{64}$/.test(session)||typeof context!=='string'||typeof target!=='string'||target.length>8192||!/^\/(?:api|preview|appearance-preview)\//.test(target)||target.startsWith('/api/session'))throw new AppError('INVALID');
  const now=this.now();for(const [key,item] of this.pending)if(item.expires<=now)this.pending.delete(key);
  if(this.pending.size>=this.maximum)throw new AppError('WORKLOAD_BUSY');
  const token=randomBytes(32).toString('hex');this.pending.set(token,{session,context,target,expires:now+this.lifetime});return token;
 }
 consume(token,context,target){
  const item=this.pending.get(token);if(!item||item.expires<=this.now()||item.context!==context||item.target!==target)throw new AppError('AUTH');
  this.pending.delete(token);return item.session;
 }
 clear(){this.pending.clear();}
}
