// Immutable reading order is separate from edit recency. A selected page can
// find its neighbours or recent dated cards without loading the whole corpus.
import {ObjectIndex,validIndexRef} from './object-index.js';
import {SnapshotIndex} from './snapshot-index.js';
import {buildIndex} from './index-builder.js';
import {dateBounds,validRecordDate} from './web/record-date.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const hash=value=>digest(serialize(value));
const prefix=(order,id)=>order+':'+id+':';
export function readingKey(row,order){
 if(order==='position')return String(row.position).padStart(16,'0');
 if(order!=='date'||!validRecordDate(row.occurredOn))fail();
 const bounds=dateBounds(row.occurredOn);
 const reverse=value=>value.replace(/\d/g,d=>String(9-Number(d)));
 return (bounds?'0:'+reverse(bounds.from)+':'+reverse(bounds.to):'1')+':'+row.id;
}
export class RecordReadingIndex extends ObjectIndex{
 constructor(store,{cacheSize=128}={}){super(store,{namespace:'record-reading-index:',immutable:true,cacheSize});this.membership=new SnapshotIndex(store,{cacheSize});}
 static valid(value){return value?.version===1&&Object.keys(value).sort().join()==='root,version'&&validIndexRef(value.root);}
 async describe(row){
  if(row.occurredOn!==undefined&&row.notebookId!==undefined)return row;
  const record=await this.store.record(row.id,row.revision);
  return {...row,occurredOn:record.occurredOn,notebookId:record.notebookId};
 }
 async keys(row){const value=await this.describe(row);return ['date','position'].map(order=>prefix(order,value.notebookId)+readingKey(value,order));}
 async build(snapshot){
  const self=this;
  async function* entries(){for await(const row of self.store.members(snapshot))for(const id of await self.keys(row))yield {id,revision:await self.membership.retain(row)};}
  return {version:1,root:await buildIndex(this.store,this,entries(),fail)};
 }
 async replace(value,before,after){
  let root=value.root;const next=new Map();
  for(const row of after)for(const id of await this.keys(row))next.set(id,await this.membership.retain(row));
  for(const row of before)for(const id of await this.keys(row))if(!next.has(id))root=await this.change(root,id,null);
  for(const [id,revision] of next)root=await this.change(root,id,revision);
  await this.flush(root);return {version:1,root};
 }
 async *rows(snapshot,notebookIds,{order='date',after=null,backward=false,signal}={}){
  if(!['date','position'].includes(order))throw new AppError('INVALID');
  const boundary=after?readingKey(after,order):null,compare=(a,b)=>(readingKey(a,order)<readingKey(b,order)?-1:readingKey(a,order)>readingKey(b,order)?1:0)*(backward?-1:1);
  if(!snapshot.readingIndex){
   // Historical snapshots are not rewritten on a read. Their compatibility
   // path retains one window; the next write builds the maintained index.
   let cursor=boundary;
   for(;;){
    const window=[];
    for await(const source of this.store.members(snapshot,{notebookIds,signal})){
     signal?.throwIfAborted();const row=await this.describe(source),key=readingKey(row,order);
     if(!notebookIds.has(row.notebookId)||cursor!==null&&(backward?key>=cursor:key<=cursor))continue;
     if(window.length===128&&compare(row,window.at(-1))>=0)continue;
     const at=window.findIndex(value=>compare(row,value)<0);window.splice(at<0?window.length:at,0,row);if(window.length>128)window.pop();
    }
    if(!window.length)return;
    for(const row of window){signal?.throwIfAborted();yield row;}
    cursor=readingKey(window.at(-1),order);if(window.length<128)return;
   }
  }
  if(!RecordReadingIndex.valid(snapshot.readingIndex))fail();
  const head=snapshot.readingIndex,lanes=[];
  const next=async lane=>{
   signal?.throwIfAborted();if(lane.at<lane.lower||lane.at>=lane.upper){lane.row=null;return;}
   const entry=await this.entryAt(head,lane.at),member=await this.membership.member(entry);
   if(!member)fail();const row=await this.describe(member);
   if(entry.id!==lane.start+readingKey(row,order)||row.notebookId!==lane.id||
    (await this.membership.find({root:snapshot.membership},'record:'+row.id))?.revision!==entry.revision)fail();
   lane.row=row;
  };
  for(const id of notebookIds){
   signal?.throwIfAborted();const start=prefix(order,id),lower=await this.rank(head,start),upper=await this.rank(head,start+'\uffff');
   const at=boundary!==null?await this.rank(head,start+boundary+(backward?'':'\0'))-(backward?1:0):backward?upper-1:lower;
   if(at>=lower&&at<upper){const lane={id,start,lower,upper,at,row:null};await next(lane);lanes.push(lane);}
  }
  for(;;){
   signal?.throwIfAborted();let chosen=null;
   for(const lane of lanes)if(lane.row&&(!chosen||compare(lane.row,chosen.row)<0))chosen=lane;
   if(!chosen)return;yield chosen.row;chosen.at+=backward?-1:1;await next(chosen);
  }
 }
 async verify(snapshot){
  let count=0;
  for await(const row of this.store.members(snapshot))for(const id of await this.keys(row)){
   if((await this.find(snapshot.readingIndex,id))?.revision!==hash(row))fail();count++;
  }
  let actual=0;for await(const entry of this.entries(snapshot.readingIndex)){
   const row=await this.membership.member(entry);if(!row||!(await this.keys(row)).includes(entry.id))fail();actual++;
  }
  if(actual!==count||count!==snapshot.count*2||count!==(snapshot.readingIndex.root?.count??0))fail();
 }
}
