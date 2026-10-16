// Recent-record navigation has its own immutable encrypted ordering. Each
// lab book is a contiguous range; paging merges one candidate per chosen book.
import {ObjectIndex,validIndexRef} from './object-index.js';
import {SnapshotIndex} from './snapshot-index.js';
import {buildIndex} from './index-builder.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {recentRecordOrder} from './web/query-order.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const prefix=id=>'book:'+id+':';
function suffix(row){
 if(typeof row.updatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.updatedAt)||!Number.isFinite(Date.parse(row.updatedAt)))fail();
 // Fixed-width ISO timestamps sort lexically. Complementing only the digits
 // reverses time order while retaining ascending identity order for ties.
 return row.updatedAt.replace(/\d/g,d=>String(9-Number(d)))+':'+row.id;
}
export class RecordRecentIndex extends ObjectIndex{
 constructor(store,{cacheSize=128}={}){super(store,{namespace:'record-recent-index:',immutable:true,cacheSize});this.membership=new SnapshotIndex(store,{cacheSize});}
 static valid(value){return value?.version===1&&Object.keys(value).sort().join()==='root,version'&&validIndexRef(value.root);}
 async describe(row){
  if(row.updatedAt!==undefined&&row.notebookId!==undefined)return row;
  const record=await this.store.record(row.id,row.revision);
  return {...row,updatedAt:row.updatedAt??record.updatedAt,notebookId:row.notebookId??record.notebookId};
 }
 async key(row){const value=await this.describe(row);return prefix(value.notebookId)+suffix(value);}
 async build(snapshot){
  const self=this;
  async function* entries(){for await(const row of self.store.members(snapshot))yield {id:await self.key(row),revision:await self.membership.retain(row)};}
  return {version:1,root:await buildIndex(this.store,this,entries(),fail)};
 }
 async replace(value,before,after){
  let root=value.root;const next=new Map();
  for(const row of after)next.set(await this.key(row),await this.membership.retain(row));
  for(const row of before){const key=await this.key(row);if(!next.has(key))root=await this.change(root,key,null);}
  for(const [key,revision] of next)root=await this.change(root,key,revision);
  await this.flush(root);return {version:1,root};
 }
 async page(snapshot,notebookIds,{after=null,backward=false,inclusive=false,signal}={}){
  if(!RecordRecentIndex.valid(snapshot.recentIndex))fail();
  const index=this,head=snapshot.recentIndex,lanes=[];let total=0,before=0;
  for(const id of notebookIds){
   signal?.throwIfAborted();const start=prefix(id),lower=await this.rank(head,start),upper=await this.rank(head,start+'\uffff');
   total+=upper-lower;
   const boundary=after?await this.rank(head,start+suffix(after)+((backward?inclusive:!inclusive)?'\0':'')):backward?upper:lower;
   before+=Math.max(0,Math.min(upper,boundary)-lower);const at=boundary-(backward?1:0);
   if(at>=lower&&at<upper)lanes.push({id,start,lower,upper,at,row:null});
  }
  async function next(lane){
   signal?.throwIfAborted();if(lane.at<lane.lower||lane.at>=lane.upper){lane.row=null;return;}
   const entry=await index.entryAt(head,lane.at),member=await index.membership.member(entry);
   if(!member)fail();const row=await index.describe(member);
   if(row.notebookId!==lane.id||entry.id!==lane.start+suffix(row))fail();lane.row=row;
  }
  async function* rows(){
   for(const lane of lanes)await next(lane);
   for(;;){
    signal?.throwIfAborted();let chosen=null;
    for(const lane of lanes)if(lane.row&&(!chosen||recentRecordOrder(lane.row,chosen.row)*(backward?-1:1)<0))chosen=lane;
    if(!chosen)return;yield chosen.row;chosen.at+=backward?-1:1;await next(chosen);
   }
  }
  return {total,before,rows:rows()};
 }
 async verify(snapshot){
  let count=0;
  for await(const row of this.store.members(snapshot)){
   if((await this.find(snapshot.recentIndex,await this.key(row)))?.revision!==digest(serialize(row)))fail();count++;
  }
  if(count!==snapshot.count||count!==(snapshot.recentIndex.root?.count??0))fail();
  let actual=0;
  for await(const entry of this.entries(snapshot.recentIndex)){
   const row=await this.membership.member(entry);if(!row||entry.id!==await this.key(row))fail();actual++;
  }
  if(actual!==count)fail();
 }
}
