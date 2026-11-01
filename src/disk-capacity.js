import {stat,statfs} from 'node:fs/promises';
import {AppError} from './errors.js';

const amount=value=>{if(!Number.isSafeInteger(value)||value<0)throw new AppError('INVALID');return BigInt(value);};
const noDurableClaims={remainingBytes:0,reserveBytes:0,volumeId:null};
const admit=(admission,operation)=>admission?admission(operation):operation(noDurableClaims);
function durableClaims(value,volumeId){const remaining=amount(value.remainingBytes),reserve=amount(value.reserveBytes);if(value.volumeId!==null&&typeof value.volumeId!=='string')throw new AppError('INVALID');return value.volumeId===volumeId?{remaining,reserve}:{remaining:0n,reserve:0n};}
async function volume(directory){
 const [identity,space]=await Promise.all([stat(directory,{bigint:true}),statfs(directory,{bigint:true})]);
 if(!identity.isDirectory()||space.bsize<=0n||space.bavail<0n)throw new AppError('IO');
 return {id:identity.dev.toString(),available:space.bsize*space.bavail};
}

// Service-local reservations for bytes which have not yet reached the disk.
// Written bytes are accounted for by fresh statfs observations. Other processes
// and storage servers remain outside this advisory budget; writes must still
// handle ENOSPC/EDQUOT and interrupted cleanup. Unknown device identities may
// conservatively group several volumes; paths are never retained as keys.
export class DiskCapacity{
 constructor({probe=volume,maxActive=128}={}){
  if(typeof probe!=='function'||!Number.isSafeInteger(maxActive)||maxActive<1)throw new AppError('INVALID');
  this.probe=probe;this.maxActive=maxActive;this.active=0;this.pending=0;this.volumes=new Map();
 }
 guard(entry,extra=0n){let guard=extra;for(const ticket of entry?.tickets??[])if(ticket.reserve>guard)guard=ticket.reserve;return guard;}
 async check(directory,bytes,reserve=0,{admission}={}){
  const size=amount(bytes),floor=amount(reserve);if(admission!==undefined&&typeof admission!=='function')throw new AppError('INVALID');return admit(admission,async claims=>{const found=await this.probe(directory),entry=this.volumes.get(found.id),durable=durableClaims(claims,found.id);
   if(found.available<size+(entry?.remaining??0n)+durable.remaining+this.guard(entry,durable.reserve>floor?durable.reserve:floor))throw new AppError('STORAGE_FULL');
  });
 }
 async reserve(directory,bytes=0,{reserveBytes=0,refreshBytes=0,growthBytes=0,signal,admission}={}){
  const remaining=amount(bytes),floor=amount(reserveBytes),refresh=amount(refreshBytes),growth=amount(growthBytes);signal?.throwIfAborted();
  if(admission!==undefined&&typeof admission!=='function')throw new AppError('INVALID');
  if(this.active+this.pending>=this.maxActive)throw new AppError('WORKLOAD_BUSY');
  this.pending++;
  try{
   let found,entry,ticket;
   try{await admit(admission,async claims=>{found=await this.probe(directory);signal?.throwIfAborted();
    entry=this.volumes.get(found.id)??{remaining:0n,tickets:new Set()};const durable=durableClaims(claims,found.id);
    if(found.available<entry.remaining+remaining+durable.remaining+this.guard(entry,durable.reserve>floor?durable.reserve:floor))throw new AppError('STORAGE_FULL');
    ticket={remaining,reserve:floor};entry.remaining+=remaining;entry.tickets.add(ticket);this.volumes.set(found.id,entry);this.active++;
   });}catch(error){if(ticket){entry.remaining-=ticket.remaining;entry.tickets.delete(ticket);this.active--;if(!entry.tickets.size)this.volumes.delete(found.id);}throw error;}
   let closed=false,writing=false,unchecked=0n;
   return {
    write:async(bytes,operation,{refresh:checkpoint=false}={})=>{
     const size=amount(bytes);if(closed||writing||typeof operation!=='function'||typeof checkpoint!=='boolean')throw new AppError('INVALID');writing=true;
     try{
      let extra=size>ticket.remaining?size-ticket.remaining:0n;
      signal?.throwIfAborted();
      if(checkpoint||extra||!refresh||unchecked+size>refresh){
       await admit(admission,async claims=>{const current=await this.probe(directory);signal?.throwIfAborted();const durable=durableClaims(claims,current.id);
       if(current.id!==found.id)throw new AppError('IO');
       const guard=this.guard(entry,durable.reserve);
       if(current.available<entry.remaining+extra+durable.remaining+guard)throw new AppError('STORAGE_FULL');
       // Unknown-length writers may reserve a bounded window ahead. Keep a
       // small final write possible when less than that window remains free.
       // Re-read aggregate claims after the asynchronous probe so concurrent
       // writers cannot each spend the same observed free space.
       const spare=current.available-entry.remaining-durable.remaining-guard,ahead=growth>ticket.remaining?growth-ticket.remaining:0n;
       if(ahead>extra)extra=ahead<spare?ahead:spare;
       ticket.remaining+=extra;entry.remaining+=extra;extra=0n;unchecked=0n;});
      }
      ticket.remaining+=extra;entry.remaining+=extra;
      const result=await operation();ticket.remaining-=size;entry.remaining-=size;unchecked+=size;return result;
     }finally{writing=false;}
    },
    release:()=>{
     if(writing)throw new AppError('LOCKED');if(closed)return;closed=true;
     entry.remaining-=ticket.remaining;entry.tickets.delete(ticket);this.active--;
     if(!entry.tickets.size)this.volumes.delete(found.id);
    }
   };
  }finally{this.pending--;}
 }
 stats(){return {active:this.active,pending:this.pending,limit:this.maxActive,volumes:this.volumes.size,reservedBytes:[...this.volumes.values()].reduce((sum,entry)=>sum+entry.remaining,0n).toString()};}
}
export const diskCapacity=new DiskCapacity();
