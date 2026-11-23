import {inventoryOperationRequest} from './inventory-operation-requests.js';
// Every module route runs on the domain stores named by the project domain
// registry. A catalogue without it holds an unsupported earlier layout.
import {moduleDomainRoute} from './module-domain-context.js';
import {readBOMSource} from './bom-import.js';
import {ProjectModuleQueries} from './project-module-queries.js';
import {ProjectModuleCommands} from './project-module-commands.js';
import {planningTaskReadiness} from './planning-task-readiness.js';
import {ProjectModuleReader} from './project-module-reader.js';
import {ProjectModuleHistory} from './project-module-history.js';
import {MODULE_BYTES,MODULE_CHECKPOINT_BYTES} from './modules/capacity.js';
import {ProjectModuleDrafts} from './project-module-drafts.js';
import {AppError} from './errors.js';
async function requestState(storage,data){
 const namespaceId=await moduleDomainRoute(storage);
 if(data?.workspaceId!==namespaceId)throw new AppError('WORKSPACE_CHANGED');return {namespaceId};
}
export function projectModuleRequest(route){
 const inventory=inventoryOperationRequest(route);if(inventory)return inventory;
 if(route==='/api/modules/planning/readiness')return {write:false,taskReadiness:true,limit:MODULE_BYTES,run:async(storage,data,options={})=>{
  const state=await requestState(storage,data);
  return planningTaskReadiness(storage,state.namespaceId,data,{sourceAccess:options.taskSourceAccess,check:options.check,signal:options.signal});
 }};
 const reference=/^\/api\/modules\/references\/(owners|query|labels|resolve|incoming)$/.exec(route);
 if(reference)return {write:false,references:true,limit:65536,run:async(storage,data,options={})=>{
  await requestState(storage,data);if(!options.referenceAccess)throw new AppError('ACCESS_UPGRADE');
  const owner=await options.referenceAccess(data.workspaceId,{signal:options.signal});
  try{const result=await owner[reference[1]](data);await owner.verify();return result;}finally{await owner.close();}
 }};
 if(route==='/api/modules/bom-source')return {write:false,limit:MODULE_BYTES,run:(storage,data,options)=>readBOMSource(storage,data,options)};
 const query={'/api/modules/version':['version','version'],'/api/modules/inventory/dashboard':['inventory','page'],'/api/modules/inventory/discovery':['inventory','discover'],'/api/modules/inventory/stock':['inventory','stock'],'/api/modules/inventory/ledger':['inventory','ledger'],'/api/modules/planning/dashboard':['planning','page'],'/api/modules/planning/discovery':['planning','discover']}[route];
 if(query)return {write:false,limit:MODULE_BYTES,run:async(storage,data,options)=>{
  const state=await requestState(storage,data);
  return new ProjectModuleQueries(storage,state.namespaceId).run(...query,data,options);
 }};
 const draft={'/api/modules/drafts/list':'list','/api/modules/drafts/read':'read','/api/modules/drafts/write':'write','/api/modules/drafts/transfer/start':'start','/api/modules/drafts/transfer/part':'part','/api/modules/drafts/transfer/finish':'finish'}[route];
 const history={'/api/modules/history/page':'page','/api/modules/history/read':'read'}[route];
 const method=draft??history??{'/api/modules/command':'execute','/api/modules/items':'list','/api/modules/item':'selected','/api/modules/labels':'labels'}[route];if(!method)return null;
 const write=method==='execute'||!!draft&&!['list','read'].includes(method);
 return {write,limit:draft?MODULE_CHECKPOINT_BYTES:MODULE_BYTES,run:async(storage,data,options)=>{
  const state=await requestState(storage,data);
  const Owner=draft?ProjectModuleDrafts:history?ProjectModuleHistory:method==='execute'?ProjectModuleCommands:ProjectModuleReader,owner=new Owner(storage,state.namespaceId);return owner[method](data,options);
 }};
}
