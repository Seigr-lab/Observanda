// Template identities are grouped in an encrypted immutable index. Discovery
// retains one representative per group, never a map of every workspace type.
import {ObjectIndex,validIndexRef} from './object-index.js';
import {SnapshotIndex} from './snapshot-index.js';
import {buildIndex} from './index-builder.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {compareKey,recentRecordOrder} from './web/query-order.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const hash=value=>digest(serialize(value));
export class RecordTypeIndex extends ObjectIndex{
 constructor(store,{cacheSize=128}={}){super(store,{namespace:'record-type-index:',immutable:true,cacheSize});this.membership=new SnapshotIndex(store,{cacheSize});}
 static valid(value){return value?.version===1&&validIndexRef(value.root);}
 async describe(row){
  const legacy=row.template===undefined||row.updatedAt===undefined||row.notebookId===undefined?await this.store.record(row.id,row.revision):null;
  return {...row,notebookId:row.notebookId??legacy.notebookId,template:row.template===undefined?legacy.template:row.template,updatedAt:row.updatedAt??legacy.updatedAt};
 }
 async key(row){const {template}=await this.describe(row);return template?template.id+':'+row.id:null;}
 async build(snapshot){
  const self=this;
  async function* entries(){for await(const row of self.store.members(snapshot)){const id=await self.key(row);if(id)yield {id,revision:await self.membership.retain(row)};}}
  return {version:1,root:await buildIndex(this.store,this,entries(),fail)};
 }
 async replace(value,before,after){
  let root=value.root;
  for(const row of before){const id=await this.key(row);if(id)root=await this.change(root,id,null);}
  for(const row of after){const id=await this.key(row);if(id)root=await this.change(root,id,await this.membership.retain(row));}
  await this.flush(root);return {version:1,root};
 }
 async *types(snapshot,notebookIds,{signal}={}){
  const choose=(a,b)=>!a||recentRecordOrder(b,a)<0?b:a;
  if(!snapshot.typeIndex){
   // Old retained snapshots remain read-only. Bounded identity windows avoid
   // collecting all types; the next ordinary write builds the durable index.
   let after='';
   for(;;){
    const window=new Map();let last='';
    for await(const source of this.store.members(snapshot,{notebookIds,signal})){
     const row=await this.describe(source),id=row.template?.id;
     if(!notebookIds.has(row.notebookId)||!id||id<=after||window.size===128&&id>last)continue;
     window.set(id,choose(window.get(id),row));
     if(window.size>128)window.delete(last);
     last=[...window.keys()].reduce((a,b)=>a>b?a:b,'');
    }
    if(!window.size)return;
    for(const id of [...window.keys()].sort(compareKey)){signal?.throwIfAborted();yield window.get(id).template;}
    after=last;if(window.size<128)return;
   }
  }
  let current=null,selected=null;
  for await(const entry of this.entries(snapshot.typeIndex)){
   signal?.throwIfAborted();
   const source=await this.membership.member(entry),row=await this.describe(source);
   if(!row.template||entry.id!==row.template.id+':'+row.id)fail();
   if(row.template.id!==current){if(selected)yield selected.template;current=row.template.id;selected=null;}
   if(notebookIds.has(row.notebookId))selected=choose(selected,row);
  }
  if(selected)yield selected.template;
 }
 async verify(snapshot){
  let count=0;
  for await(const row of this.store.members(snapshot)){
   const id=await this.key(row);if(!id)continue;
   if((await this.find(snapshot.typeIndex,id))?.revision!==hash(row))fail();count++;
  }
  let actual=0;
  for await(const entry of this.entries(snapshot.typeIndex)){
   const row=await this.membership.member(entry);
   if(entry.id!==await this.key(row))fail();actual++;
  }
  if(actual!==count||actual!==(snapshot.typeIndex.root?.count??0))fail();
 }
}
