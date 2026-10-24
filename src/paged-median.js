// Exact median with bounded sorted blocks and constant-size run descriptors.
// An optional encrypted state owner retains counts/results without a Map that
// grows with the number of groups. The run hash authenticates the whole stream
// before finish succeeds; callers publish only after that successful finish.
import {digest} from './storage.js';
import {AppError} from './errors.js';
import messages from './web/locales/en/datasetAggregation.json' with {type:'json'};
const natural=n=>Number.isSafeInteger(n)&&n>=0;
const selectionSource=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()==='member,ordinal,page,row'&&Object.values(v).every(natural);
export class PagedMedian{
 constructor({read,write,remove,signal,progress,check,state=null,blockSize=2048,pageBytes=512*1024,compareValues=(a,b)=>a-b,midpoint=(a,b)=>a/2+b/2,selection=null}){
  Object.assign(this,{read,write,remove,signal,progress,check,blockSize,pageBytes,selection});
  this.compare=(a,b)=>a[0]-b[0]||compareValues(a[1],b[1])||(selection?a[2].ordinal-b[2].ordinal:0);this.midpoint=midpoint;
  if(!Number.isSafeInteger(blockSize)||blockSize<1||!Number.isSafeInteger(pageBytes)||pageBytes<64||selection!==null&&(!selection||typeof selection.plan!=='function'||typeof selection.reduce!=='function'))throw new AppError('INVALID');
  this.state=state;this.buffer=[];this.bufferBytes=2;this.levels=[];this.counts=new Map();this.medians=new Map();this.details=new Map();this.selectionComplete=false;this.sequence=0;this.peakBuffer=0;
 }
 async current(){this.signal?.throwIfAborted();await this.check?.();this.signal?.throwIfAborted();}
 add(key,value,source){
  if(this.selection&&(!natural(key)||!selectionSource(source)))throw new AppError('INVALID');
  this.signal?.throwIfAborted();const row=this.selection?[key,value,{...source}]:[key,value],count=(this.counts.get(key)??0)+1;
  if(!Number.isSafeInteger(count))throw new AppError('MATERIAL_ANALYSIS_LIMIT');
  this.selectionComplete=false;this.bufferBytes+=Buffer.byteLength(JSON.stringify(row))+1;this.buffer.push(row);this.counts.set(key,count);this.peakBuffer=Math.max(this.peakBuffer,this.buffer.length);
 }
 checkpoint(){
  if(!this.state||this.buffer.length||this.counts.size)throw new AppError('INVALID');
  return {version:this.selection?2:1,...(this.selection?{mode:'rank-selection'}:{}),sequence:this.sequence,levels:structuredClone(this.levels)};
 }
 restore(value){
  const ids=new Set();
  if(!this.state||this.buffer.length||this.levels.length||value?.version!==(this.selection?2:1)||(this.selection?value.mode!=='rank-selection':Object.hasOwn(value,'mode'))||!natural(value.sequence)||!Array.isArray(value.levels)||
   !value.levels.every(run=>run===null||run&&Object.keys(run).sort().join()==='count,hash,id,pages'&&typeof run.id==='string'&&/^(0|[1-9][0-9]*)$/.test(run.id)&&natural(Number(run.id))&&Number(run.id)<value.sequence&&!ids.has(run.id)&&ids.add(run.id)&&natural(run.count)&&run.count>0&&natural(run.pages)&&run.pages>0&&run.pages<=run.count&&typeof run.hash==='string'&&/^[a-f0-9]{64}$/.test(run.hash)))throw new AppError('MATERIAL_MISSING');
  this.sequence=value.sequence;this.levels=structuredClone(value.levels);this.selectionComplete=false;
 }
 value(key){if(this.selection&&!this.selectionComplete)throw new AppError('MATERIAL_MISSING');if(this.state)return this.retainedValue(key);if(!this.medians.has(key))throw new AppError('MATERIAL_MISSING');return this.medians.get(key);}
 async retainedValue(key){const value=await this.state.read('result:'+key);if(value===undefined)throw new AppError('MATERIAL_MISSING');return value;}
 detail(key){if(!this.selection||!this.selectionComplete)throw new AppError('MATERIAL_MISSING');if(this.state)return this.retainedDetail(key);if(!this.details.has(key))throw new AppError('MATERIAL_MISSING');return this.details.get(key);}
 async retainedDetail(key){const value=await this.state.read('detail:'+key);if(value===undefined)throw new AppError('MATERIAL_MISSING');return value;}
 run(){if(!Number.isSafeInteger(this.sequence+1))throw new AppError('MATERIAL_ANALYSIS_LIMIT');return {id:String(this.sequence++),count:0,pages:0,hash:''};}
 async page(rows,run=this.run()){
  await this.current();
  if(!Number.isSafeInteger(run.count+rows.length)||!Number.isSafeInteger(run.pages+1))throw new AppError('MATERIAL_ANALYSIS_LIMIT');
  const text=JSON.stringify(rows);
  // A flush can overshoot by its final value. Split on byte size as well as
  // row count; the immutable run still authenticates every emitted page.
  if(Buffer.byteLength(text)>this.pageBytes&&rows.length>1){const middle=Math.floor(rows.length/2);await this.page(rows.slice(0,middle),run);return this.page(rows.slice(middle),run);}
  const name=run.id+'-'+run.pages+'.json';
  await this.write(name,text);await this.current();run.hash=digest(run.hash+'\0'+text);run.pages++;run.count+=rows.length;return run;
 }
 async *values(run){
  let hash='',count=0;
  for(let page=0;page<run.pages;page++){
   await this.current();const text=await this.read(run.id+'-'+page+'.json');await this.current();
   if(typeof text!=='string')throw new AppError('MATERIAL_MISSING');
   const rows=JSON.parse(text);if(!Array.isArray(rows)||!rows.length||rows.length>this.blockSize||this.selection&&rows.some(row=>!Array.isArray(row)||row.length!==3||!natural(row[0])||!selectionSource(row[2])))throw new AppError('MATERIAL_MISSING');
   hash=digest(hash+'\0'+text);count+=rows.length;
   yield* rows;
  }
  if(hash!==run.hash||count!==run.count)throw new AppError('MATERIAL_MISSING');
 }
 async discard(run){
  for(let page=0;page<run.pages;page+=32){await this.current();await this.remove(Array.from({length:Math.min(32,run.pages-page)},(_,i)=>run.id+'-'+(page+i)+'.json'));await this.current();}
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
    if(out.length===this.blockSize||outBytes>=this.pageBytes){await this.page(out,run);done+=out.length;out=[];outBytes=2;await this.progress?.({stage:this.selection?messages.sortingQuantileValues:'sorting median values',done,total:a.count+b.count});}
   }
   if(out.length)await this.page(out,run);
   await this.discard(a);await this.discard(b);
   return run;
  }finally{await left.return();await right.return();}
 }
 async flush(force=false){
  if(!this.buffer.length||!force&&this.buffer.length<this.blockSize&&this.bufferBytes<this.pageBytes)return;
  await this.current();
  if(this.state){
   for(const [key,added]of this.counts){await this.current();const count=(await this.state.read('count:'+key)??0)+added;if(!Number.isSafeInteger(count))throw new AppError('MATERIAL_ANALYSIS_LIMIT');await this.state.write('count:'+key,count);await this.current();}
   this.counts.clear();
  }
  this.buffer.sort(this.compare);let run=await this.page(this.buffer);this.buffer=[];this.bufferBytes=2;
  let level=0;
  while(this.levels[level]){run=await this.merge(this.levels[level],run);this.levels[level]=null;level++;}
  this.levels[level]=run;
 }
 async finish(){
  this.selectionComplete=false;await this.current();await this.flush(true);let run=null;
  for(const part of this.levels)if(part)run=run?await this.merge(run,part):part;
  if(!run){this.selectionComplete=true;return;}
  this.levels=[run];if(this.selection)return this.finishSelection(run);
  let key=null,index=0,lower=null,done=0,count;
  for await(const [group,value] of this.values(run)){
   this.signal?.throwIfAborted();
   if(group!==key){key=group;index=0;lower=null;count=this.state?await this.state.read('count:'+group):this.counts.get(group);if(!Number.isSafeInteger(count)||count<1)throw new AppError('MATERIAL_MISSING');}
   const middle=Math.floor(count/2);
   if(index===middle-1)lower=value;
   if(index===middle){const result=count%2?value:this.midpoint(lower,value);if(this.state)await this.state.write('result:'+group,result);else this.medians.set(group,result);}
   index++;done++;
   if(done%this.blockSize===0)await this.progress?.({stage:'selecting median values',done,total:run.count});
  }
  await this.current();await this.progress?.({stage:'selecting median values',done,total:run.count});
 }
 async finishSelection(run){
  let key=null,index=0,done=0,count,plan,selected=[],previous=null;
  const save=async()=>{
   if(key===null)return;
   if(index!==count||selected.length!==plan.ranks.length)throw new AppError('MATERIAL_MISSING');
   await this.current();const result=await this.selection.reduce(key,count,plan,selected);await this.current();
   if(!result||result.value===undefined||result.detail===undefined)throw new AppError('INVALID');
   if(this.state){await this.state.write('result:'+key,result.value);await this.current();await this.state.write('detail:'+key,result.detail);await this.current();}
   else {this.medians.set(key,result.value);this.details.set(key,result.detail);}
  };
  for await(const row of this.values(run)){
   const [group,value,source]=row;this.signal?.throwIfAborted();
   if(previous&&this.compare(previous,row)>=0)throw new AppError('MATERIAL_MISSING');previous=row;
   if(group!==key){
    await save();key=group;index=0;selected=[];await this.current();count=this.state?await this.state.read('count:'+group):this.counts.get(group);await this.current();
    if(!natural(count)||count<1)throw new AppError('MATERIAL_MISSING');
    plan=await this.selection.plan(group,count);await this.current();
    // A quantile needs only its lower and upper order statistics.
    if(!plan||!Array.isArray(plan.ranks)||plan.ranks.length<1||plan.ranks.length>2||!plan.ranks.every((rank,i)=>natural(rank)&&rank<count&&(i===0||rank>plan.ranks[i-1])))throw new AppError('INVALID');
   }
   if(index>=count)throw new AppError('MATERIAL_MISSING');
   if(index===plan.ranks[selected.length])selected.push({rank:index,value,source});index++;done++;
   if(done%this.blockSize===0){await this.current();await this.progress?.({stage:messages.selectingQuantileValues,done,total:run.count});}
  }
  await save();await this.current();await this.progress?.({stage:messages.selectingQuantileValues,done,total:run.count});await this.current();this.selectionComplete=true;
 }
}
