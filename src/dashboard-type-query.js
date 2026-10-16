import {recordTypePage} from './record-type-page.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {defaultDashboard,createPanel,validDashboard} from './web/dashboard-model.js';
import {queryPanel} from './web/dashboard-queries.js';
import {validViewFilter} from './web/record-view-model.js';
import {QUERY_ORDER_VERSION} from './web/query-order.js';
export class DashboardTypeQuery{
 constructor(workspace){this.workspace=workspace;}
 async read(command,{signal}={}){
  if(!command||Object.keys(command).sort().join()!=='config,cursor,etag,limit,options,search,workspaceId')throw new AppError('INVALID');
  const {workspaceId,etag,config,options,search,limit,cursor}=command;
  if(!researchId(workspaceId)||!revisionId(etag)||typeof search!=='string'||search.length>160||!Number.isInteger(limit)||limit<1||limit>25||cursor!==null&&(typeof cursor!=='string'||cursor.length>4096))throw new AppError('INVALID');
  const panel={...createPanel('records','query'),config,options},settings=defaultDashboard();settings.views[0].panels=[panel];
  if(!validDashboard(settings))throw new AppError('INVALID');
  const selectedValue=options.recordType??config.recordType;
  if(!validViewFilter(selectedValue))throw new AppError('INVALID');
  signal?.throwIfAborted();
  return this.workspace.catalogue(async store=>{
   if((await store.snapshot()).metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const snapshot=await store.snapshot(etag);
   if(snapshot.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const scope=queryPanel(snapshot.metadata,panel);if(scope.unavailable)throw new AppError('RECORD_VIEW_SCOPE');
   const signature=digest(serialize({workspaceId,etag,config,options,search,limit,order:QUERY_ORDER_VERSION}));
   return recordTypePage(store,snapshot,{workspaceId,etag,ids:new Set(scope.notebooks.map(n=>n.id)),selectedValue,search,limit,cursor,signature,namespace:'dashboard-types',signal});
  });
 }
}
