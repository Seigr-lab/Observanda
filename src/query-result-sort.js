// External merge sorting for ephemeral encrypted query results. The adapter
// owns disk admission and anchored file handles; only fixed windows and a
// bounded merge fan-in are retained here, regardless of the result count.
import {seal,unseal,ENCRYPTION_OVERHEAD} from './encryption.js';
import {AppError} from './errors.js';
export class QueryCachePressure extends Error{}
const INDEX_BYTES=32+ENCRYPTION_OVERHEAD,FRAME_BYTES=512*1024,FRAME_ITEMS=128,FAN_IN=8;
const damage=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const integer=value=>Number.isSafeInteger(value)&&value>=0;
// A selected scientific value can exceed the size of a scratch frame. Its
// comparator resolves equal prefixes from retained storage. Ordinary queries
// continue to use the native synchronous array sort.
async function sortWindow(rows,order,deferredOrder){
 if(!deferredOrder){rows.sort(order);return;}
 let source=rows,destination=new Array(rows.length);
 for(let width=1;width<rows.length;width*=2){
  for(let start=0;start<rows.length;start+=2*width){
   const middle=Math.min(start+width,rows.length),end=Math.min(middle+width,rows.length);
   let left=start,right=middle;
   for(let i=start;i<end;i++){
    if(right===end||left<middle&&await deferredOrder(source[left],source[right])<=0)destination[i]=source[left++];
    else destination[i]=source[right++];
   }
  }
  [source,destination]=[destination,source];
 }
 if(source!==rows)for(let i=0;i<rows.length;i++)rows[i]=source[i];
}
export class QueryResultSort{
 constructor(io,key,id,{check=()=>{}}={}){this.io=io;this.key=key;this.id=id;this.check=check;this.pass=0;this.generations=new Map();}
 aad(file,position,extra=''){return 'Observanda/query-result/v1/'+this.id+'/'+this.generations.get(file)+'/'+file+'/'+position+'/'+extra;}
 async descriptor(file,at){
  this.check();const bytes=await this.io.read(file,at*INDEX_BYTES,INDEX_BYTES),plain=unseal(bytes,this.key,this.aad(file,at));
  if(plain.length!==32)damage();const values=Array.from({length:4},(_,i)=>Number(plain.readBigUInt64BE(i*8)));if(!values.every(integer))damage();return values;
 }
 async index(file,at,values){
  this.check();if(!values.every(integer)||values.length!==4)damage();const plain=Buffer.alloc(32);values.forEach((value,i)=>plain.writeBigUInt64BE(BigInt(value),i*8));
  await this.io.write(file,at*INDEX_BYTES,seal(plain,this.key,this.aad(file,at)));
 }
 async frame(file,offset){
  this.check();const header=await this.io.read(file,offset,8),size=header.readUInt32BE(0),count=header.readUInt32BE(4);
  if(size<ENCRYPTION_OVERHEAD||size>FRAME_BYTES+ENCRYPTION_OVERHEAD||count<1||count>FRAME_ITEMS)damage();
  const bytes=await this.io.read(file,offset+8,size),plain=unseal(bytes,this.key,this.aad(file,offset,count));let rows;
  try{rows=JSON.parse(plain);}catch{damage();}if(!Array.isArray(rows)||rows.length!==count)damage();return {rows,end:offset+8+size,bytes:8+size};
 }
 async build(source,order,{deferredOrder}={}){
  let runs=0,input='a',output='b',writer=this.writer(input),window=[],bytes=2;
  for await(const row of source){
   this.check();const size=Buffer.byteLength(JSON.stringify(row))+1;if(size+2>FRAME_BYTES)throw new QueryCachePressure();
   if(window.length&&(window.length===FRAME_ITEMS||bytes+size>FRAME_BYTES)){await sortWindow(window,order,deferredOrder);await writer.run(window);runs++;window=[];bytes=2;}
   window.push(row);bytes+=size;
  }
  if(window.length){await sortWindow(window,order,deferredOrder);await writer.run(window);runs++;window=[];}
  let receipt=await writer.finish();
  while(runs>1){
   this.check();await this.io.truncate(output+'.data',0);await this.io.truncate(output+'.runs',0);await this.io.truncate('pages',0);writer=this.writer(output);
   let nextRuns=0;
   for(let first=0;first<runs;first+=FAN_IN){
    const lanes=[];
    for(let i=first;i<Math.min(runs,first+FAN_IN);i++){const [start,end,count]=await this.descriptor(input+'.runs',i),iterator=this.runRows(input+'.data',start,end,count,order,deferredOrder)[Symbol.asyncIterator]();lanes.push({iterator,next:await iterator.next()});}
    const self=this;
    async function* merged(){
     try{for(;;){self.check();let chosen;for(const lane of lanes)if(!lane.next.done&&(!chosen||(deferredOrder?await deferredOrder(lane.next.value,chosen.next.value):order(lane.next.value,chosen.next.value))<0))chosen=lane;if(!chosen)return;yield chosen.next.value;chosen.next=await chosen.iterator.next();}}
     finally{await Promise.all(lanes.map(lane=>lane.iterator.return?.()));}
    }
    await writer.run(merged());nextRuns++;
   }
   receipt=await writer.finish();await this.io.truncate(input+'.data',0);await this.io.truncate(input+'.runs',0);[input,output]=[output,input];runs=nextRuns;
  }
  return {...receipt,file:input+'.data'};
 }
 async *runRows(file,start,end,count,order,deferredOrder){
  if(start>end||!count)damage();let read=0,previous;
  for(let at=start;at<end;){const frame=await this.frame(file,at);if(frame.end>end||frame.end<=at)damage();for(const row of frame.rows){this.check();if(previous&&(deferredOrder?await deferredOrder(previous,row):order(previous,row))>=0)damage();previous=row;read++;yield row;}at=frame.end;}
  if(read!==count)damage();
 }
 writer(slot){
  const self=this,generation=++this.pass;for(const file of [slot+'.data',slot+'.runs','pages'])this.generations.set(file,generation);let position=0,pages=0,total=0,runs=0;
  return {async run(source){
   const start=position,before=total;let rows=[],bytes=2;
   const flush=async()=>{
    if(!rows.length)return;self.check();const body=seal(Buffer.from(JSON.stringify(rows)),self.key,self.aad(slot+'.data',position,rows.length)),header=Buffer.alloc(8);header.writeUInt32BE(body.length);header.writeUInt32BE(rows.length,4);
    const frame=Buffer.concat([header,body]);await self.io.write(slot+'.data',position,frame);await self.index('pages',pages++,[position,frame.length,total,rows.length]);position+=frame.length;total+=rows.length;rows=[];bytes=2;
   };
   for await(const row of source){self.check();const size=Buffer.byteLength(JSON.stringify(row))+1;if(size+2>FRAME_BYTES)throw new QueryCachePressure();if(rows.length&&(rows.length===FRAME_ITEMS||bytes+size>FRAME_BYTES))await flush();rows.push(row);bytes+=size;}
   await flush();await self.index(slot+'.runs',runs++,[start,position,total-before,0]);
  },async finish(){self.check();return {pages,total,bytes:position,generation};}};
 }
 async page(receipt,offset,limit){
  if(!integer(offset)||!integer(limit)||limit>200||offset>receipt.total||!integer(receipt.generation)||receipt.generation<1)damage();this.generations.set(receipt.file,receipt.generation);this.generations.set('pages',receipt.generation);if(!limit||offset===receipt.total)return [];
  let low=0,high=receipt.pages;
  while(low<high){this.check();const at=Math.floor((low+high)/2),entry=await this.descriptor('pages',at);if(entry[2]+entry[3]<=offset)low=at+1;else high=at;}
  const rows=[];let ordinal=offset;
  for(let page=low;page<receipt.pages&&rows.length<limit;page++){
   const [start,bytes,begin,count]=await this.descriptor('pages',page);if(begin>ordinal||begin+count<=ordinal)damage();const frame=await this.frame(receipt.file,start);if(frame.bytes!==bytes||frame.rows.length!==count)damage();
   for(let index=ordinal-begin;index<frame.rows.length&&rows.length<limit;index++){this.check();rows.push(frame.rows[index]);ordinal++;}
  }
  if(rows.length!==Math.min(limit,receipt.total-offset))damage();return rows;
 }
 async rank(receipt,boundary,order,{includeEqual=true,deferredOrder}={}){
  let low=0,high=receipt.total;
  while(low<high){this.check();const at=Math.floor((low+high)/2),[row]=await this.page(receipt,at,1),difference=deferredOrder?await deferredOrder(row,boundary):order(row,boundary);if(difference<0||includeEqual&&difference===0)low=at+1;else high=at;}
  return low;
 }
}
