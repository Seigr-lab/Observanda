// Private, authenticated sharing/position ranges. Sharing choices belong to
// each publication; this index describes originals and never grants consent.
import {ObjectIndex,validIndexRef} from './object-index.js';
import {SnapshotIndex} from './snapshot-index.js';
import {buildIndex} from './index-builder.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {RecordReadingIndex,readingKey} from './record-reading-index.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const hash=value=>digest(serialize(value));
const position=value=>String(value).padStart(16,'0');
const prefix=(id,share,order='position')=>(order==='date'?'date:':'')+'book:'+id+':share:'+Number(share)+':';
export class RecordPublicationIndex extends ObjectIndex{
 constructor(store,{cacheSize=128}={}){super(store,{namespace:'record-publication-index:',immutable:true,cacheSize});this.membership=new SnapshotIndex(store,{cacheSize});}
 static valid(value){return [1,2].includes(value?.version)&&Object.keys(value).sort().join()==='root,version'&&validIndexRef(value.root);}
 async describe(row,date=false){
  if(row.share!==undefined&&row.notebookId!==undefined&&(!date||row.occurredOn!==undefined))return row;
  const original=await this.store.record(row.id,row.revision);
  return {...row,share:original.share,notebookId:original.notebookId,occurredOn:original.occurredOn};
 }
 async key(row){const value=await this.describe(row);return prefix(value.notebookId,value.share)+position(value.position);}
 async keys(row,version=2){const value=await this.describe(row,version===2);return [prefix(value.notebookId,value.share)+position(value.position),...(version===2?[prefix(value.notebookId,value.share,'date')+readingKey(value,'date')]:[])];}
 async build(snapshot){
  const self=this;
  async function* entries(){for await(const row of self.store.members(snapshot))for(const id of await self.keys(row))yield {id,revision:await self.membership.retain(row)};}
  return {version:2,root:await buildIndex(this.store,this,entries(),fail)};
 }
 async replace(value,before,after){
  let root=value.root;const next=new Map();
  for(const row of after)for(const key of await this.keys(row,value.version))next.set(key,await this.membership.retain(row));
  for(const row of before)for(const key of await this.keys(row,value.version))if(!next.has(key))root=await this.change(root,key,null);
  for(const [key,revision] of next)root=await this.change(root,key,revision);
  await this.flush(root);return {version:value.version,root};
 }
 async *rows(snapshot,scopes,{order='position',after=null,backward=false,signal}={}){
  if(!RecordPublicationIndex.valid(snapshot.publicationIndex))fail();
  if(!['date','position'].includes(order)||typeof backward!=='boolean'||after!==null&&order==='position'&&(!Number.isSafeInteger(after)||after<0))throw new AppError('INVALID');
  if([...scopes.values()].some(scope=>!['all','shared'].includes(scope)))throw new AppError('INVALID');
  if(order==='date'&&snapshot.publicationIndex.version===1){
   for await(const member of new RecordReadingIndex(this.store).rows(snapshot,new Set(scopes.keys()),{order,after,backward,signal})){
    const row=await this.describe(member,true);if(row.share||scopes.get(row.notebookId)==='all')yield row;
   }
   return;
  }
  const key=row=>order==='position'?position(row.position):readingKey(row,'date'),boundary=after===null?null:order==='position'?position(after):readingKey(after,'date');
  const compare=(a,b)=>(key(a)<key(b)?-1:key(a)>key(b)?1:0)*(backward?-1:1);
  const head=snapshot.publicationIndex,lanes=[];
  const next=async lane=>{
   signal?.throwIfAborted();if(lane.at<lane.lower||lane.at>=lane.upper){lane.row=null;return;}
   const entry=await this.entryAt(head,lane.at),member=await this.membership.member(entry);if(!member)fail();
   const row=await this.describe(member,order==='date');
   if(row.notebookId!==lane.id||row.share!==lane.share||entry.id!==lane.start+key(row)||row.position>=snapshot.nextPosition||
    (await this.membership.find({root:snapshot.membership},'record:'+row.id))?.revision!==entry.revision)fail();
   lane.row=row;
  };
  for(const [id,scope] of scopes){
   for(const share of scope==='all'?[false,true]:[true]){
    signal?.throwIfAborted();const start=prefix(id,share,order),lower=await this.rank(head,start),upper=await this.rank(head,start+'\uffff');
    const at=boundary!==null?await this.rank(head,start+boundary+(backward?'':'\0'))-(backward?1:0):backward?upper-1:lower;
    if(at>=lower&&at<upper){const lane={id,share,start,lower,upper,at,row:null};await next(lane);lanes.push(lane);}
   }
  }
  for(;;){
   signal?.throwIfAborted();let chosen=null;
   for(const lane of lanes)if(lane.row&&(!chosen||compare(lane.row,chosen.row)<0))chosen=lane;
   if(!chosen)return;yield chosen.row;chosen.at+=backward?-1:1;await next(chosen);
  }
 }
 async verify(snapshot){
  let count=0;
  for await(const row of this.store.members(snapshot))for(const key of await this.keys(row,snapshot.publicationIndex.version)){
   if((await this.find(snapshot.publicationIndex,key))?.revision!==hash(row))fail();count++;
  }
  if(count!==snapshot.count*snapshot.publicationIndex.version||count!==(snapshot.publicationIndex.root?.count??0))fail();
  let actual=0;
  for await(const entry of this.entries(snapshot.publicationIndex)){
   const row=await this.membership.member(entry);if(!row||!(await this.keys(row,snapshot.publicationIndex.version)).includes(entry.id))fail();actual++;
  }
  if(actual!==count)fail();
 }
}
