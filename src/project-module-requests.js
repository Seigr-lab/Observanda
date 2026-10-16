// Explicit project routes select a verified storage generation. Reads retain
// compatibility; writes never fall back to the old shared module writer.
import {moduleDomainRoute} from './module-domain-context.js';
import {readBOMSource} from './bom-import.js';
import {ProjectModuleQueries} from './project-module-queries.js';
import {InventoryReader} from './modules/inventory-reader.js';
import {PlanningDashboard} from './modules/dashboard.js';
import {workspaceModules} from './modules/index.js';
import {ProjectModuleCommands} from './project-module-commands.js';
import {planningTaskReadiness} from './planning-task-readiness.js';
import {ProjectModuleReader} from './project-module-reader.js';
import {ModuleReader} from './modules/reader.js';
import {ModuleHistory} from './modules/history.js';
import {ProjectModuleHistory} from './project-module-history.js';
import {MODULE_BYTES,MODULE_CHECKPOINT_BYTES} from './modules/capacity.js';
import {ProjectModuleDrafts} from './project-module-drafts.js';
import {ModuleDrafts} from './modules/drafts.js';
import {AppError} from './errors.js';
async function requestState(storage,data){
 const domainId=await moduleDomainRoute(storage),namespaceId=domainId??(await storage.outline()).metadata.id;
 if(data?.workspaceId!==namespaceId)throw new AppError('WORKSPACE_CHANGED');return {namespaceId,dedicated:domainId!==null};
}
export function projectModuleRequest(route){
 if(route==='/api/modules/planning/readiness')return {write:false,taskReadiness:true,limit:MODULE_BYTES,run:async(storage,data,options={})=>{
  const state=await requestState(storage,data);if(!state.dedicated)throw new AppError('ACCESS_UPGRADE');
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
  if(state.dedicated)return new ProjectModuleQueries(storage,state.namespaceId).run(...query,data,options);
  if(query[0]==='version')return workspaceModules(storage).version();
  return new (query[0]==='inventory'?InventoryReader:PlanningDashboard)(storage)[query[1]](data,options);
 }};
 const draft={'/api/modules/drafts/list':'list','/api/modules/drafts/read':'read','/api/modules/drafts/write':'write','/api/modules/drafts/transfer/start':'start','/api/modules/drafts/transfer/part':'part','/api/modules/drafts/transfer/finish':'finish'}[route];
 const history={'/api/modules/history/page':'page','/api/modules/history/read':'read'}[route];
 const method=draft??history??{'/api/modules/command':'execute','/api/modules/items':'list','/api/modules/item':'selected','/api/modules/labels':'labels'}[route];if(!method)return null;
 const write=method==='execute'||!!draft&&!['list','read'].includes(method);
 return {write,limit:draft?MODULE_CHECKPOINT_BYTES:MODULE_BYTES,run:async(storage,data,options)=>{
  const state=await requestState(storage,data);
  if(!state.dedicated){if(write)throw new AppError('ACCESS_UPGRADE');if(draft){const owner=new ModuleDrafts(storage);return method==='list'?owner.list(data.moduleId,data,options):owner.read(data.id);}return new (history?ModuleHistory:ModuleReader)(storage)[method](data,options);}
  const Owner=draft?ProjectModuleDrafts:history?ProjectModuleHistory:method==='execute'?ProjectModuleCommands:ProjectModuleReader,owner=new Owner(storage,state.namespaceId);return owner[method](data,options);
 }};
}
