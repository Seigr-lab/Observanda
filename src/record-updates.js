// A stale client can need many changed originals or an explicit ordering. Keep
// both transfers bounded and pinned to immutable roots; no transaction or list
// of record bodies survives an HTTP request.
import {AppError} from './errors.js';
import {SnapshotIndex} from './snapshot-index.js';
import {recordOrder} from './record-order.js';
import {recordRevision} from './research.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
export const UPDATE_RECORDS=20,UPDATE_BYTES=256*1024,UPDATE_ORDER=128;
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const invalid=()=>{throw new AppError('WORKSPACE_READ_CURSOR');};
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const encode=(store,value)=>store.encode('record-update-page',value.workspaceId,value).toString('base64url');
const identities=(source,value)=>source.metadata.id===value.workspaceId&&source.indexVersion===1;
function anchor(workspaceId,baseEtag,etag,base){return {version:1,workspaceId,baseEtag,etag,phase:'changes',after:null,offset:0,count:base.count,bytes:base.bytes,reordered:false};}

async function page(store,value,{signal}={}){
 signal?.throwIfAborted();
 const base=await store.snapshot(value.baseEtag),next=await store.snapshot(value.etag);
 if(!identities(base,value)||!identities(next,value))invalid();
 const records=[],removed=[],appended=[],order=[];
 let more=false,count=value.count,bytes=value.bytes,after=value.after,offset=value.offset,reordered=value.reordered;
 if(value.phase==='changes'){
  const index=new SnapshotIndex(store);let loadedBytes=0,processed=0;
  for await(const change of index.differences(base.membership,next.membership,'record:',{signal,afterId:after===null?null:'record:'+after})){
   signal?.throwIfAborted();
   const before=await index.member(change.before),following=await index.member(change.after);
   if(before&&change.id!=='record:'+before.id||following&&change.id!=='record:'+following.id||!before&&!following)damaged();
   const changed=following&&(!before||before.revision!==following.revision),size=changed?following.bytes:0;
   if(processed&&(processed===UPDATE_RECORDS||loadedBytes+size>UPDATE_BYTES)){more=true;break;}
   if(before){if(before.position>=base.nextPosition)damaged();count--;bytes-=before.bytes;}
   if(following){
    if(following.position>=next.nextPosition)damaged();count++;bytes+=following.bytes;
    if(!before){appended.push({id:following.id,position:following.position});if(following.position<base.nextPosition)reordered=true;}
    else if(before.position!==following.position)reordered=true;
    if(changed){
     const record=await store.record(following.id,following.revision);
     const actual=Buffer.byteLength(JSON.stringify(record,null,2).split('\n').map(line=>'    '+line).join('\n'));
     if(actual!==following.bytes)damaged();
     records.push({record,revision:recordRevision(record)});loadedBytes+=size;
    }
   }else removed.push(before.id);
   processed++;offset++;after=change.id.slice(7);
  }
  if(!more&&(count!==next.count||bytes!==next.bytes))damaged();
 }else{
  if(value.offset>next.count||value.count!==value.offset||value.bytes>next.bytes)invalid();
  for await(const row of recordOrder(store,next,{signal,after})){
   signal?.throwIfAborted();if(order.length===UPDATE_ORDER){more=true;break;}
   order.push(row.id);offset++;count++;bytes+=row.bytes;after=row.position;
  }
  if(count>next.count||bytes>next.bytes||!more&&(count!==next.count||bytes!==next.bytes))damaged();
 }
 signal?.throwIfAborted();
 const continuation=more?{...value,after,offset,count,bytes,reordered}:value.phase==='changes'&&reordered?{...value,phase:'order',after:null,offset:0,count:0,bytes:0,reordered}:null;
 return {workspaceId:value.workspaceId,baseEtag:value.baseEtag,etag:value.etag,count:next.count,page:{phase:value.phase,offset:value.offset,loaded:offset,records,removed,appended,order,nextCursor:continuation?encode(store,continuation):null}};
}

export async function recordUpdate(store,baseEtag,{signal}={}){
 const etag=await store.head(),base=await store.snapshot(baseEtag),next=await store.snapshot(etag);
 if(base.metadata.id!==next.metadata.id)throw new AppError('WORKSPACE_CHANGED');
 const first=await page(store,anchor(next.metadata.id,baseEtag,etag,base),{signal});
 if(first.page.nextCursor===null){
  const {records,removed,appended}=first.page;
  return {etag,recordPatch:{baseEtag,metadata:next.metadata,order:null,count:next.count,records:records.map(row=>row.record),removed,appended:appended.sort((a,b)=>a.position-b.position).map(row=>row.id)},recordRevisions:Object.fromEntries(records.map(row=>[row.record.id,row.revision]))};
 }
 return {etag,recordUpdate:{...first,metadata:next.metadata}};
}

export async function recordUpdatePage(store,{workspaceId,cursor},{signal}={}){
 let value;try{value=store.decode('record-update-page',workspaceId,Buffer.from(cursor,'base64url'));}catch(error){if(error.code==='ACCESS_LOCKED')throw error;invalid();}
 if(!value||value.version!==1||value.workspaceId!==workspaceId||!revisionId(value.etag)||!revisionId(value.baseEtag)||!['changes','order'].includes(value.phase)||!integer(value.offset)||!integer(value.count)||!integer(value.bytes)||typeof value.reordered!=='boolean'||
  (value.phase==='changes'?value.after!==null&&!researchId(value.after):value.after!==null&&!integer(value.after))||(value.offset===0)!==(value.after===null))invalid();
 if((await store.snapshot()).metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
 return page(store,value,{signal});
}
