// Saved ordering is already authenticated by the position index. Stream its
// members without constructing and sorting another workspace-sized array.
import {RecordSearchIndex} from './record-search-index.js';
import {SnapshotIndex} from './snapshot-index.js';
import {AppError} from './errors.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export async function* recordOrder(store,snapshot,{signal,after=null,cacheSize=128}={}){
 if(after!==null&&(!Number.isSafeInteger(after)||after<0))throw new AppError('INVALID');
 const order=new RecordSearchIndex(store,{cacheSize}),members=new SnapshotIndex(store,{cacheSize});let count=0,bytes=0,previous=-1;
 for await(const entry of order.entries(snapshot.searchIndex,'position:',after===null?null:'position:'+String(after).padStart(16,'0'))){
  signal?.throwIfAborted();const key=entry.id.slice(9),position=Number(key);
  if(!/^\d{16}$/.test(key)||!Number.isSafeInteger(position)||position<=previous||position>=snapshot.nextPosition)fail();
  const row=await members.member(entry);
  if(!row||row.position!==position||(await members.find({root:snapshot.membership},'record:'+row.id))?.revision!==entry.revision)fail();
  previous=position;count++;bytes+=row.bytes;yield row;
 }
 if(after===null&&(count!==snapshot.count||bytes!==snapshot.bytes))fail();
}
