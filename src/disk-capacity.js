import {stat,statfs} from 'node:fs/promises';
import {AppError} from './errors.js';

const amount=value=>{if(!Number.isSafeInteger(value)||value<0)throw new AppError('INVALID');return BigInt(value);};
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
 async check(directory,bytes,reserve=0){
  const size=amount(bytes),floor=amount(reserve),found=await this.probe(directory),entry=this.volumes.get(found.id);
  if(found.available<size+(entry?.remaining??0n)+this.guard(entry,floor))throw new AppError('STORAGE_FULL');
 }
 async reserve(directory,bytes=0,{reserveBytes=0,refreshBytes=0,signal}={}){
  const remaining=amount(bytes),floor=amount(reserveBytes),refresh=amount(refreshBytes);signal?.throwIfAborted();
  if(this.active+this.pending>=this.maxActive)throw new AppError('WORKLOAD_BUSY');
  this.pending++;
  try{
   const found=await this.probe(directory);signal?.throwIfAborted();
   const entry=this.volumes.get(found.id)??{remaining:0n,tickets:new Set()};
   if(found.available<entry.remaining+remaining+this.guard(entry,floor))throw new AppError('STORAGE_FULL');
   const ticket={remaining,reserve:floor};entry.remaining+=remaining;entry.tickets.add(ticket);this.volumes.set(found.id,entry);this.active++;
   let closed=false,writing=false,unchecked=0n;
   return {
    write:async(bytes,operation)=>{
     const size=amount(bytes);if(closed||writing||typeof operation!=='function')throw new AppError('INVALID');writing=true;
     try{
      const extra=size>ticket.remaining?size-ticket.remaining:0n;
      signal?.throwIfAborted();
      if(extra||!refresh||unchecked+size>refresh){
       const current=await this.probe(directory);signal?.throwIfAborted();
       if(current.id!==found.id)throw new AppError('IO');
       if(current.available<entry.remaining+extra+this.guard(entry))throw new AppError('STORAGE_FULL');
       unchecked=0n;
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
