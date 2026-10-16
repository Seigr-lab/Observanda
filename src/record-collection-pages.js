// Read cursors retain snapshot identities, never records or database credentials.
// Sessions are bounded, client-specific and expire; a restart requires refresh.
import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {AppError} from './errors.js';
export class RecordCollectionPages{
 constructor({now=Date.now,max=32,maxBytes=16*1024*1024,reuse=false,ttl=10*60*1000}={}){this.now=now;this.max=max;this.maxBytes=maxBytes;this.reuse=reuse;this.ttl=ttl;this.key=randomBytes(32);this.sessions=new Map();}
 clear(){this.sessions.clear();this.key.fill(0);}
 expire(){for(const [id,value] of this.sessions)if(value.expires<=this.now())this.sessions.delete(id);}
 begin(client,signature,cursor){
  this.expire();if(cursor===null)return {id:randomBytes(24).toString('base64url'),client,signature,offset:0,after:null,snapshots:null};
  try{
   const [payload,mac,...extra]=cursor.split('.'),expected=createHmac('sha256',this.key).update(payload).digest(),given=Buffer.from(mac??'','base64url');
   if(extra.length||expected.length!==given.length||!timingSafeEqual(expected,given))throw Error();
   const point=JSON.parse(Buffer.from(payload,'base64url')),saved=this.sessions.get(point.id);
   if(!saved||saved.client!==client||saved.signature!==signature||!Number.isSafeInteger(point.offset)||point.offset<0||point.offset>0&&!point.after)throw Error();
   saved.expires=this.now()+this.ttl;return {...saved,id:point.id,offset:point.offset,after:point.after};
  }catch{throw new AppError('RECORD_QUERY_CURSOR');}
 }
 retain(value,snapshots){
  const serialized=JSON.stringify(snapshots),bytes=Buffer.byteLength(serialized);
  if(bytes>4*1024*1024||bytes>this.maxBytes)throw new AppError('LIMIT');
  this.expire();
  if(this.reuse)for(const [id,previous] of this.sessions)if(previous.client===value.client&&previous.signature===value.signature&&JSON.stringify(previous.snapshots)===serialized){value={...value,id};break;}
  this.sessions.delete(value.id);let retained=0;for(const entry of this.sessions.values())retained+=entry.bytes;
  while(this.sessions.size&&(this.sessions.size>=this.max||retained+bytes>this.maxBytes)){const [id,entry]=this.sessions.entries().next().value;retained-=entry.bytes;this.sessions.delete(id);}
  this.sessions.set(value.id,{client:value.client,signature:value.signature,snapshots,bytes,expires:this.now()+this.ttl});
  return (offset,after)=>{const payload=Buffer.from(JSON.stringify({id:value.id,offset,after})).toString('base64url');return payload+'.'+createHmac('sha256',this.key).update(payload).digest('base64url');};
 }
}
