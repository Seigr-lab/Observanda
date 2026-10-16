// Exact median with bounded sorted blocks and constant-size run descriptors.
// An optional encrypted state owner retains counts/results without a Map that
// grows with the number of groups. The run hash authenticates the whole stream
// before finish succeeds; callers publish only after that successful finish.
import {digest} from './storage.js';
import {AppError} from './errors.js';
export class PagedMedian{
 constructor({read,write,remove,signal,progress,state=null,blockSize=2048,pageBytes=512*1024,compareValues=(a,b)=>a-b,midpoint=(a,b)=>a/2+b/2}){
  Object.assign(this,{read,write,remove,signal,progress,blockSize,pageBytes});
  this.compare=(a,b)=>a[0]-b[0]||compareValues(a[1],b[1]);this.midpoint=midpoint;
  if(!Number.isSafeInteger(blockSize)||blockSize<1||!Number.isSafeInteger(pageBytes)||pageBytes<64)throw new AppError('INVALID');
  this.state=state;this.buffer=[];this.bufferBytes=2;this.levels=[];this.counts=new Map();this.medians=new Map();this.sequence=0;this.peakBuffer=0;
 }
 add(key,value){const row=[key,value];this.bufferBytes+=Buffer.byteLength(JSON.stringify(row))+1;this.buffer.push(row);this.counts.set(key,(this.counts.get(key)??0)+1);this.peakBuffer=Math.max(this.peakBuffer,this.buffer.length);}
 checkpoint(){
  if(!this.state||this.buffer.length||this.counts.size)throw new AppError('INVALID');
  return {version:1,sequence:this.sequence,levels:structuredClone(this.levels)};
 }
 restore(value){
  const natural=n=>Number.isSafeInteger(n)&&n>=0,ids=new Set();
  if(!this.state||this.buffer.length||this.levels.length||value?.version!==1||!natural(value.sequence)||!Array.isArray(value.levels)||
   !value.levels.every(run=>run===null||run&&Object.keys(run).sort().join()==='count,hash,id,pages'&&typeof run.id==='string'&&/^(0|[1-9][0-9]*)$/.test(run.id)&&natural(Number(run.id))&&Number(run.id)<value.sequence&&!ids.has(run.id)&&ids.add(run.id)&&natural(run.count)&&run.count>0&&natural(run.pages)&&run.pages>0&&run.pages<=run.count&&typeof run.hash==='string'&&/^[a-f0-9]{64}$/.test(run.hash)))throw new AppError('MATERIAL_MISSING');
  this.sequence=value.sequence;this.levels=structuredClone(value.levels);
 }
 value(key){if(this.state)return this.retainedValue(key);if(!this.medians.has(key))throw new AppError('MATERIAL_MISSING');return this.medians.get(key);}
 async retainedValue(key){const value=await this.state.read('result:'+key);if(value===undefined)throw new AppError('MATERIAL_MISSING');return value;}
 run(){if(!Number.isSafeInteger(this.sequence+1))throw new AppError('MATERIAL_ANALYSIS_LIMIT');return {id:String(this.sequence++),count:0,pages:0,hash:''};}
 async page(rows,run=this.run()){
  this.signal?.throwIfAborted();
  if(!Number.isSafeInteger(run.count+rows.length)||!Number.isSafeInteger(run.pages+1))throw new AppError('MATERIAL_ANALYSIS_LIMIT');
  const text=JSON.stringify(rows);
  // A flush can overshoot by its final value. Split on byte size as well as
  // row count; the immutable run still authenticates every emitted page.
  if(Buffer.byteLength(text)>this.pageBytes&&rows.length>1){const middle=Math.floor(rows.length/2);await this.page(rows.slice(0,middle),run);return this.page(rows.slice(middle),run);}
  const name=run.id+'-'+run.pages+'.json';
  await this.write(name,text);run.hash=digest(run.hash+'\0'+text);run.pages++;run.count+=rows.length;return run;
 }
 async *values(run){
  let hash='',count=0;
  for(let page=0;page<run.pages;page++){
   this.signal?.throwIfAborted();const text=await this.read(run.id+'-'+page+'.json');
   if(typeof text!=='string')throw new AppError('MATERIAL_MISSING');
   const rows=JSON.parse(text);if(!Array.isArray(rows)||!rows.length||rows.length>this.blockSize)throw new AppError('MATERIAL_MISSING');
   hash=digest(hash+'\0'+text);count+=rows.length;
   yield* rows;
  }
  if(hash!==run.hash||count!==run.count)throw new AppError('MATERIAL_MISSING');
 }
 async discard(run){
  for(let page=0;page<run.pages;page+=32){this.signal?.throwIfAborted();await this.remove(Array.from({length:Math.min(32,run.pages-page)},(_,i)=>run.id+'-'+(page+i)+'.json'));}
 }
 async merge(a,b){
  const left=this.values(a),right=this.values(b),run=this.run();let out=[],outBytes=2,done=0;
  try{
   let l=await left.next(),r=await right.next();
   while(!l.done||!r.done){
    this.signal?.throwIfAborted();
    if(r.done||!l.done&&this.compare(l.value,r.value)<=0){out.push(l.value);l=await left.next();}
    else {out.push(r.value);r=await right.next();}
    outBytes+=Buffer.byteLength(JSON.stringify(out.at(-1)))+1;
    if(out.length===this.blockSize||outBytes>=this.pageBytes){await this.page(out,run);done+=out.length;out=[];outBytes=2;await this.progress?.({stage:'sorting median values',done,total:a.count+b.count});}
   }
   if(out.length)await this.page(out,run);
   await this.discard(a);await this.discard(b);
   return run;
  }finally{await left.return();await right.return();}
 }
 async flush(force=false){
  if(!this.buffer.length||!force&&this.buffer.length<this.blockSize&&this.bufferBytes<this.pageBytes)return;
  if(this.state){
   for(const [key,added]of this.counts){const count=(await this.state.read('count:'+key)??0)+added;if(!Number.isSafeInteger(count))throw new AppError('MATERIAL_ANALYSIS_LIMIT');await this.state.write('count:'+key,count);}
   this.counts.clear();
  }
  this.buffer.sort(this.compare);let run=await this.page(this.buffer);this.buffer=[];this.bufferBytes=2;
  let level=0;
  while(this.levels[level]){run=await this.merge(this.levels[level],run);this.levels[level]=null;level++;}
  this.levels[level]=run;
 }
 async finish(){
  await this.flush(true);let run=null;
  for(const part of this.levels)if(part)run=run?await this.merge(run,part):part;
  if(!run)return;
  this.levels=[run];let key=null,index=0,lower=null,done=0,count;
  for await(const [group,value] of this.values(run)){
   this.signal?.throwIfAborted();
   if(group!==key){key=group;index=0;lower=null;count=this.state?await this.state.read('count:'+group):this.counts.get(group);if(!Number.isSafeInteger(count)||count<1)throw new AppError('MATERIAL_MISSING');}
   const middle=Math.floor(count/2);
   if(index===middle-1)lower=value;
   if(index===middle){const result=count%2?value:this.midpoint(lower,value);if(this.state)await this.state.write('result:'+group,result);else this.medians.set(group,result);}
   index++;done++;
   if(done%this.blockSize===0)await this.progress?.({stage:'selecting median values',done,total:run.count});
  }
  await this.progress?.({stage:'selecting median values',done,total:run.count});
 }
}
