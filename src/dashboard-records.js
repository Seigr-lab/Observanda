import {dashboardOwnerStructure} from './dashboard-owner-structure.js';
import {dashboardStructureProvider} from './dashboard-collection-structure.js';
import {configurationProfileBooks} from './configuration-profiles.js';
import {dashboardRecordMembers} from './dashboard-record-members.js';
import {QUERY_ORDER_VERSION,recentRecordOrder} from './web/query-order.js';
import {dashboardRecent} from './dashboard-recent.js';
// Dashboard records are a bounded read projection, never an editable workspace.
import {researchCardFields,researchCardItems} from './web/research-card-items.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {defaultDashboard,createPanel,validDashboard} from './web/dashboard-model.js';
import {queryPanel} from './web/dashboard-queries.js';
import {validViewFilter} from './web/record-view-model.js';
import {STATUSES} from './web/record-types.js';
import {labRecordProvider} from './web/laboratory/data-scope.js';

export class DashboardRecords{
 constructor(workspace){this.workspace=workspace;}
 async read(command,{signal}={}){
  if(!command||!['config,etag,key,limit,options,workspaceId','config,etag,key,limit,options,provider,workspaceId','config,cursor,etag,key,limit,options,provider,workspaceId'].includes(Object.keys(command).sort().join()))throw new AppError('INVALID');
  const {workspaceId,etag,config,options,limit,key,provider='records',cursor=null}=command,field=Object.hasOwn(researchCardFields,provider)?researchCardFields[provider]:null;
  if(cursor!==null&&(typeof cursor!=='string'||cursor.length>4096))throw new AppError('INVALID');
  const lab=labRecordProvider(provider),structure=dashboardStructureProvider(provider);
  if(provider!=='records'&&!field&&!lab&&!structure)throw new AppError('INVALID');
  if(!researchId(workspaceId)||!revisionId(etag)||!Number.isInteger(limit)||limit<1||limit>100||key!==null&&(typeof key!=='string'||!key.split(':').every(researchId)||(!field||provider==='figures'?key.split(':').length!==1:key.split(':').length!==2)))throw new AppError('INVALID');
  const settings=defaultDashboard(),panel={...createPanel('records','query'),config,options};settings.views[0].panels=[panel];
  if(!validDashboard(settings))throw new AppError('INVALID');
  const filters={...config,...options};
  if(!validViewFilter(filters.recordType)||filters.status!=='all'&&!STATUSES.includes(filters.status)||typeof filters.tag!=='string'||filters.tag.length>512)throw new AppError('INVALID');
  signal?.throwIfAborted();
  return this.workspace.catalogue(async store=>{
   if((await store.snapshot()).metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const snapshot=await store.snapshot(etag),metadata=snapshot.metadata;
   if(structure)return dashboardOwnerStructure(store,snapshot,{...command,cursor},{signal});
   if(metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const signature=digest(serialize({order:QUERY_ORDER_VERSION,workspaceId,etag,config,options,limit,key,provider}));let anchor={signature,offset:0,after:null};
   if(cursor){try{anchor=store.decode('dashboard-page',workspaceId,Buffer.from(cursor,'base64url'));}catch(error){if(error.code==='ACCESS_LOCKED')throw error;throw new AppError('RECORD_QUERY_CURSOR');}}
   if(!anchor||anchor.signature!==signature||!Number.isSafeInteger(anchor.offset)||anchor.offset<0||![undefined,'forward','backward'].includes(anchor.direction)||anchor.after!==null&&(!researchId(anchor.after?.id)||typeof anchor.after.updatedAt!=='string'||!Number.isSafeInteger(anchor.after.skip)||anchor.after.skip<0)||anchor.offset>0&&anchor.after===null||anchor.direction==='backward'&&anchor.offset===0)throw new AppError('RECORD_QUERY_CURSOR');
   // A backward cursor ends just before the first visible item. Neither side
   // retains earlier pages; both directions refer to this exact snapshot.
   const backward=anchor.direction==='backward';
   const encode=value=>store.encode('dashboard-page',workspaceId,value).toString('base64url');
   const scope=queryPanel(metadata,panel);if(scope.unavailable)throw new AppError('RECORD_VIEW_SCOPE');
   const ids=new Set((lab?await configurationProfileBooks(store,metadata,scope.notebooks,lab.profile,{signal}):scope.notebooks).map(n=>n.id)),c={...config,...options},selected=[];
   if(snapshot.recentIndex&&provider==='records'&&key===null&&c.recordType==='all'&&c.status==='all'&&!c.tag)
    return dashboardRecent(store,snapshot,ids,{workspaceId,etag,limit,anchor,encode,signal});
   let total=0;
   const order=recentRecordOrder;
   for await(const row of dashboardRecordMembers(store,snapshot,{provider,ids,filters:c,key,signal})){
    const {quantity,updatedAt}=row,candidate={id:row.id,revision:row.revision,updatedAt,skip:0,end:quantity};total+=quantity;
    if(anchor.after){
     const relation=order(candidate,anchor.after);
     if(backward){
      if(relation>0||relation===0&&(!field||anchor.after.skip===0))continue;
      if(relation===0)candidate.end=anchor.after.skip;
     }else{
      if(relation<0||relation===0&&(!field||anchor.after.skip>=quantity))continue;
      if(relation===0)candidate.skip=anchor.after.skip;
     }
    }
    let low=0,high=selected.length;
    while(low<high){const middle=(low+high)>>1;if(order(selected[middle],candidate)*(backward?-1:1)<0)low=middle+1;else high=middle;}
    if(low<limit){selected.splice(low,0,candidate);if(selected.length>limit)selected.pop();}
   }
   const records=[],items=[];let first=null,last=null,bytes=0;const budget=256*1024;
   const retain=(row,index)=>{
    const start={id:row.id,updatedAt:row.updatedAt,skip:index},end={...start,skip:field?index+1:0};
    if(backward){first=start;last??=end;}else{first??=start;last=end;}
   };
   collect:for(const row of selected){
    signal?.throwIfAborted();const record=await store.record(row.id,row.revision);
    if(!field){
     const size=Buffer.byteLength(JSON.stringify(record));if(records.length&&bytes+size>budget)break;
     bytes+=size;records.push(record);retain(row,0);
    }else{
     const source=researchCardItems(provider,record).filter(item=>key===null||item.key===key);
     for(let i=backward?row.end-1:row.skip;backward?i>=0:i<source.length;i+=backward?-1:1){
      const size=Buffer.byteLength(JSON.stringify(source[i]));if(items.length&&bytes+size>budget)break collect;
      bytes+=size;items.push(source[i]);retain(row,i);if(items.length===limit)break collect;
     }
    }
   }
   if(backward){records.reverse();items.reverse();}
   const count=field?items.length:records.length,offset=backward?anchor.offset-count:anchor.offset,next=offset+count;
   if(offset<0||next>total||anchor.offset&&!count)throw new AppError('RECORD_QUERY_CURSOR');
   signal?.throwIfAborted();return {workspaceId,etag,...(field?{items}:{records}),total,offset,cursor:encode(anchor),
    previousCursor:offset>0?encode({signature,direction:'backward',offset,after:first}):null,
    nextCursor:next<total&&last?encode({signature,direction:'forward',offset:next,after:last}):null};
  });
 }
}
