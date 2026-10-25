import {DatasetResourceBudget} from './dataset-resource-budget.js';
import {validDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {validCellComputation,hasApproximateComputation} from './web/measurement-computation.js';
import {plotRational,plotRationalText,reducePlotRational,addPlotRational} from './web/plot-resource-policy.js';
import {revisionText} from './web/revision-model.js';

export class CoordinateAlignmentError extends Error{constructor(code='DATASET_ALIGNMENT_INVALID'){super(code);this.code=code;}}
const fail=(code)=>{throw new CoordinateAlignmentError(code);};
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const ordinal=value=>Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0);
const name=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\u0000-\u001f]/u.test(value);
const location=value=>value&&value.kind==='dataset'&&ordinal(value.page)&&ordinal(value.row)&&name(value.id)&&Object.keys(value).every(key=>['kind','page','row','id','excluded','order'].includes(key))&&(!Object.hasOwn(value,'excluded')||value.excluded===null)&&(!Object.hasOwn(value,'order')||ordinal(value.order));
const marked=value=>hasApproximateComputation({computation:value});
const emptyHeader=()=>({version:1,total:0,lastOrdinal:null,sealed:false});

// The caller converts coordinates and tolerance under their source-owned scalar
// and unit policies before entry. Passing the same budget keeps that arithmetic
// and this lookup in one scalar-operation allowance. Awaited storage never spends
// numerical CPU time. Calls are sequential; the first select seals this index.
// ScratchWork owns encryption, authentication, lifetime and cancellation cleanup.
export function createCoordinateAlignmentIndex(work,prefix,{policy,signal,check}={}){
 if(typeof work?.getMany!=='function'||typeof work?.putMany!=='function'||!name(prefix)||!validDatasetResourcePolicy(policy))fail();
 policy=structuredClone(policy);const root='coordinate-alignment:'+JSON.stringify(prefix),headerKey=root+':header';
 const current=async()=>{signal?.throwIfAborted();await check?.();signal?.throwIfAborted();};
 const io=async operation=>{await current();const value=await operation();await current();return value;};
 const budgetFor=provided=>{if(provided!==undefined&&(!(provided instanceof DatasetResourceBudget)||revisionText(provided.scalarPolicy)!==revisionText(policy)))fail();return provided??new DatasetResourceBudget(policy);};
 const partitionKey=partition=>{if(!name(partition))fail();return root+':partition:'+JSON.stringify(partition);};
 const header=(value,missing=true)=>{if(value===undefined&&missing)return emptyHeader();if(!exact(value,['version','total','lastOrdinal','sealed'])||value.version!==1||!ordinal(value.total)||typeof value.sealed!=='boolean'||(value.total===0?value.lastOrdinal!==null:!ordinal(value.lastOrdinal)||value.lastOrdinal<value.total-1))fail('MATERIAL_MISSING');return value;};
 const metadata=(value,head)=>{if(value===undefined)return null;if(!exact(value,['version','count','lastOrdinal','lastValue','approximateCount'])||value.version!==1||!ordinal(value.count)||value.count===0||value.count>head.total||!ordinal(value.lastOrdinal)||value.lastOrdinal>head.lastOrdinal||!ordinal(value.approximateCount)||value.approximateCount>value.count||typeof value.lastValue!=='string')fail('MATERIAL_MISSING');return value;};
 async function read(keys){const values=await io(()=>work.getMany(keys));if(!(values instanceof Map))fail('MATERIAL_MISSING');return values;}
 const normalized=(value,budget,code='DATASET_ALIGNMENT_INVALID')=>{if(!exact(value,['numerator','denominator'])||typeof value.numerator!=='bigint'||typeof value.denominator!=='bigint'||value.denominator<=0n)fail(code);return reducePlotRational(value,budget);};
 const storedRatio=(text,budget)=>{if(typeof text!=='string')fail('MATERIAL_MISSING');const value=plotRational(text,budget);if(plotRationalText(value,budget)!==text)fail('MATERIAL_MISSING');return value;};
 const compare=(a,b,budget)=>{const left=budget.product(a.numerator,b.denominator),right=budget.product(b.numerator,a.denominator);return left<right?-1:left>right?1:0;};
 const difference=(a,b,budget)=>addPlotRational(a,{numerator:-b.numerator,denominator:b.denominator},budget);
 const magnitude=value=>({numerator:value.numerator<0n?-value.numerator:value.numerator,denominator:value.denominator});
 function record(value,index,meta,head,budget){
  if(!exact(value,['version','index','ordinal','location','value','computation','approximateThrough'])||value.version!==1||value.index!==index||!ordinal(value.ordinal)||value.ordinal>meta.lastOrdinal||value.ordinal>head.lastOrdinal||value.ordinal<index||!location(value.location)||!validCellComputation(value.computation)||!ordinal(value.approximateThrough)||value.approximateThrough>index+1||value.approximateThrough>meta.approximateCount||marked(value.computation)&&value.approximateThrough===0)fail('MATERIAL_MISSING');
  const parsed=storedRatio(value.value,budget);if(index===meta.count-1&&(value.ordinal!==meta.lastOrdinal||value.value!==meta.lastValue||value.approximateThrough!==meta.approximateCount))fail('MATERIAL_MISSING');return {...value,parsed};
 }
 return {
  async append(partition,entry,{budget:provided}={}){
   await current();const base=partitionKey(partition),budget=budgetFor(provided),run=fn=>budget.run(fn);
   const value=run(()=>{if(!exact(entry,['ordinal','location','value','computation'])||!ordinal(entry.ordinal)||!location(entry.location)||!validCellComputation(entry.computation))fail();return normalized(entry.value,budget);}),loaded=await read([headerKey,base]),head=run(()=>header(loaded.get(headerKey))),meta=run(()=>metadata(loaded.get(base),head));
   if(head.sealed)fail();if(head.lastOrdinal!==null&&entry.ordinal<=head.lastOrdinal)fail('DATASET_ALIGNMENT_ORDER');if(head.total===Number.MAX_SAFE_INTEGER)fail();
   if(meta){const values=await read([base+':row:'+(meta.count-1)]),tail=run(()=>record(values.get(base+':row:'+(meta.count-1)),meta.count-1,meta,head,budget));if(run(()=>compare(value,tail.parsed,budget))<0)fail('DATASET_ALIGNMENT_ORDER');}
   const index=meta?.count??0,approximateThrough=(meta?.approximateCount??0)+(marked(entry.computation)?1:0),spelling=run(()=>plotRationalText(value,budget)),row={version:1,index,ordinal:entry.ordinal,location:structuredClone(entry.location),value:spelling,computation:structuredClone(entry.computation),approximateThrough};
   await io(()=>work.putMany([[headerKey,{version:1,total:head.total+1,lastOrdinal:entry.ordinal,sealed:false}],[base,{version:1,count:index+1,lastOrdinal:entry.ordinal,lastValue:spelling,approximateCount:approximateThrough}],[base+':row:'+index,row]]));
   return {count:index+1,index,ordinal:entry.ordinal};
  },
  async select(partition,query,{direction,tolerance,ties,budget:provided}={}){
   await current();const base=partitionKey(partition),budget=budgetFor(provided),run=fn=>budget.run(fn);
   const parsed=run(()=>{if(!['backward','forward','nearest'].includes(direction)||!['first-source','last-source','error'].includes(ties)||query!==null&&(!exact(query,['value','computation'])||!validCellComputation(query.computation)))fail();const limit=normalized(tolerance,budget);if(limit.numerator<0n)fail();return {limit,value:query===null?null:normalized(query.value,budget)};}),loaded=await read([headerKey,base]),head=run(()=>header(loaded.get(headerKey))),meta=run(()=>metadata(loaded.get(base),head));
   if(!head.sealed)await io(()=>work.putMany([[headerKey,{...head,sealed:true}]]));
   const response=(status,location=null,delta=null,tieCount=0,evidence=[],approximate=false)=>({status,location:structuredClone(location),delta,tieCount,decisionComputation:approximate?{version:1,kind:'approximate-inputs'}:null,evidence});
   if(query===null)return response('left-missing');const queryApproximate=marked(query.computation);if(!meta)return response('no-candidate',null,null,0,[],queryApproximate);
   // At most sixteen authenticated records stay live, regardless of partition or
   // duplicate-run length. Approximation prefix counts summarize tied members.
   // Every consulted coordinate also contributes to selection provenance, even
   // when its comparison rejects it. This never changes payload computation.
   let consultedApproximate=false;const cache=new Map();async function at(index){await current();if(!ordinal(index)||index>=meta.count)fail('MATERIAL_MISSING');if(cache.has(index))return cache.get(index);const key=base+':row:'+index,values=await read([key]),value=run(()=>record(values.get(key),index,meta,head,budget));consultedApproximate ||= marked(value.computation);if(cache.size===16)cache.delete(cache.keys().next().value);cache.set(index,value);return value;}
   await at(meta.count-1);
   async function bound(value,upper){let low=0,high=meta.count;while(low<high){await current();const middle=low+Math.floor((high-low)/2),candidate=await at(middle),order=run(()=>compare(candidate.parsed,value,budget));if(order<0||upper&&order===0)low=middle+1;else high=middle;}return low;}
   async function group(index){const center=await at(index),start=await bound(center.parsed,false),end=await bound(center.parsed,true);if(start>end-1||index<start||index>=end)fail('MATERIAL_MISSING');const first=await at(start),last=await at(end-1),count=end-start,approximateCount=last.approximateThrough-first.approximateThrough+(marked(first.computation)?1:0);run(()=>{if(compare(first.parsed,center.parsed,budget)!==0||compare(last.parsed,center.parsed,budget)!==0||first.ordinal>last.ordinal||!ordinal(approximateCount)||approximateCount>count)fail('MATERIAL_MISSING');});return {first,last,count,approximateCount,delta:run(()=>difference(center.parsed,parsed.value,budget))};}
   const lower=await bound(parsed.value,false);let groups=[];
   if(direction==='backward'){const upper=await bound(parsed.value,true);if(upper>0)groups=[await group(upper-1)];}
   else if(direction==='forward'){if(lower<meta.count)groups=[await group(lower)];}
   else{if(lower>0)groups.push(await group(lower-1));if(lower<meta.count)groups.push(await group(lower));if(groups.length===2){const order=run(()=>compare(magnitude(groups[0].delta),magnitude(groups[1].delta),budget));if(order<0)groups.pop();else if(order>0)groups.shift();}}
   const evidenceFor=items=>{const unique=new Map();for(const item of items)for(const value of [item.first,item.last])if(!unique.has(value.ordinal))unique.set(value.ordinal,{ordinal:value.ordinal,location:structuredClone(value.location),computation:structuredClone(value.computation)});return [...unique.values()].sort((a,b)=>a.ordinal-b.ordinal);};
   if(!groups.length){const boundary=await group(direction==='backward'?0:meta.count-1);return response('no-candidate',null,null,0,evidenceFor([boundary]),queryApproximate||consultedApproximate||boundary.approximateCount>0);}
   const tieCount=groups.reduce((total,value)=>total+value.count,0);if(!ordinal(tieCount)||tieCount<1||tieCount>meta.count)fail('MATERIAL_MISSING');const chosen=ties==='last-source'?groups[groups.length-1].last:groups[0].first,delta=run(()=>difference(chosen.parsed,parsed.value,budget)),evidence=evidenceFor(groups),approximate=queryApproximate||consultedApproximate||groups.some(value=>value.approximateCount>0);
   if(run(()=>compare(magnitude(delta),parsed.limit,budget))>0)return response('outside-tolerance',null,delta,tieCount,evidence,approximate);
   if(tieCount>1&&ties==='error')fail('DATASET_ALIGNMENT_TIE');return response('matched',chosen.location,delta,tieCount,evidence,approximate);
  }
 };
}
