import {dashboardCollectionStructure,dashboardStructureProvider} from './dashboard-collection-structure.js';
import {defaultPanelConfig} from './web/dashboard-model.js';
import {digest} from './storage-format.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {DashboardDiscovery} from './dashboard-discovery.js';
import {dashboardSourceKey} from './web/dashboard-source-key.js';
import {researchCardFields} from './web/research-card-items.js';
import {labRecordProvider} from './web/laboratory/data-scope.js';
export async function dashboardCollectionDiscovery(pages,client,command,{scope=null,visit,signal}){
 if(!command||Object.keys(command).sort().join()!=='cursor,etag,limit,offset,provider,search,workspaceId')throw new AppError('INVALID');
 const {workspaceId,etag,provider,search,offset,limit,cursor}=command;
 if(!researchId(workspaceId)||!revisionId(etag)||provider!=='records'&&!Object.hasOwn(researchCardFields,provider)&&!labRecordProvider(provider)&&!dashboardStructureProvider(provider)||typeof search!=='string'||search.length>512||!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>12||cursor!==null&&(typeof cursor!=='string'||cursor.length>4096))throw new AppError('INVALID');
 if(dashboardStructureProvider(provider))return dashboardCollectionStructure(pages,client,{workspaceId,etag,provider,config:defaultPanelConfig(),options:{search},key:null,limit,cursor},{scope,visit,signal,discovery:{offset}});
 const signature=digest(JSON.stringify({kind:'dashboard-discovery',scope,workspaceId,etag,provider,search,limit})),session=pages.begin(client,signature,cursor),snapshots={},items=[];let total=0;
 const selection={scopeMode:'all',projectIds:[],includeWorkspace:true,includeDescendants:true,notebookMode:'all',notebookIds:[]};
 await visit(async(storage,owner)=>storage.catalogue(async store=>{
  signal?.throwIfAborted();const head=session.snapshots?.[owner.workspaceId]??await store.head();
  if(session.snapshots&&!Object.hasOwn(session.snapshots,owner.workspaceId)||Object.hasOwn(snapshots,owner.workspaceId))throw new AppError('RECORD_QUERY_CURSOR');snapshots[owner.workspaceId]=head;
  const result=await new DashboardDiscovery({catalogue:fn=>fn(store)}).read({workspaceId:owner.workspaceId,etag:head,provider,search,offset:Math.max(0,offset-total),limit:Math.max(1,limit-items.length)},{signal});
  if(items.length<limit&&offset<total+result.total)for(const item of result.items)items.push({...item,key:dashboardSourceKey(owner.workspaceId,item.key),subtitle:[owner.projectTitle,item.subtitle].filter(Boolean).join(' / ')});
  total+=result.total;
 }),{workspaceId,scope,selection,signal});
 if(session.snapshots&&Object.keys(session.snapshots).some(id=>!Object.hasOwn(snapshots,id)))throw new AppError('RECORD_QUERY_CURSOR');
 signal?.throwIfAborted();return {workspaceId,etag,provider,items,total,offset,cursor:pages.retain(session,snapshots)(0,null)};
}
