import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {libraryStamp,scanEligibleWebsiteRows} from './website-file-library.js';

const root='.observanda/website-files/feed-owner-upgrade';

// The current grant iterator cannot identify records that have disappeared
// since a predecessor saved their website fragments. Partition those old
// pointers once, so opening each research owner does not scan every owner.
export async function indexHistoricalSources(store,signal){
 const done=root+'/complete.json';
 if(await store.scope(()=>store.control(done,{missing:true,signal}),{signal}))return;
 await store.scope(async fs=>{
  if(await store.control(done,{missing:true,signal}))return;
  const stamp=await libraryStamp(store);if(stamp.pending.size)throw new AppError('CONFLICT');
  let prefix;const owners=new Map();
  async function flush(){
   for(const [id,rows] of owners)await store.writeControl(root+'/'+id+'/'+prefix+'.json',rows,{signal});
   owners.clear();
  }
  for await(const row of scanEligibleWebsiteRows(store,fs,stamp,{signal})){
   if(!researchId(row.workspaceId)||!researchId(row.recordId)||!researchId(row.notebookId)||!researchId(row.projectId))continue;
   const next=row.id.slice(0,2);if(next!==prefix){await flush();prefix=next;}
   const pointers=owners.get(row.workspaceId)??[];pointers.push({sourceId:row.id,projectId:row.projectId,notebookId:row.notebookId,recordId:row.recordId});owners.set(row.workspaceId,pointers);
  }
  await flush();await store.writeControl(done,{version:1},{signal});
 },{write:true,signal});
}

export async function reconcileHistoricalMembership(store,reader,namespace,snapshotId,conversion,signal){
 const directory=root+'/'+namespace;let after=null;
 do{
  // Read a page of membership buckets in one storage scope, then check its rows in
  // catalogue batches across buckets, in the same order as before.
  const {page,rows}=await store.scope(async()=>{
   const page=await store.names(directory,{after,limit:32,directories:false}),rows=[];
   for(const name of page.items){
    if(!/^[a-f0-9]{2}\.json$/.test(name))throw new AppError('FORMAT');
    rows.push(...await store.control(directory+'/'+name,{signal}));
   }
   return {page,rows};
  },{signal});
  for(let offset=0;offset<rows.length;offset+=40){
   const batch=rows.slice(offset,offset+40);
   const {value:candidates}=await reader.use(namespace,undefined,async(catalogue,snapshot,context)=>{
    if(context.snapshotId!==snapshotId)throw new AppError('RECORD_CHANGED');
    const items=[];
    for(const row of batch)if(await conversion.historicalDisposition(catalogue,snapshot,row))items.push(row);
    return items;
   });
   for(const row of candidates)await conversion.withdrawHistoricalMembership(reader,namespace,row,signal);
  }
  after=page.next;
 }while(after);
}
