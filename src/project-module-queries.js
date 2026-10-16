import {ProjectDomains} from './project-domains.js';
import {ProjectModuleIdentities} from './project-module-identities.js';
import {projectModuleReadContext,operationalReadDomains,planningReadDomains} from './project-module-read-context.js';
import {ModuleReader} from './modules/reader.js';
import {InventoryReader} from './modules/inventory-reader.js';
import {PlanningDashboard} from './modules/dashboard.js';
import {AppError} from './errors.js';
export class ProjectModuleQueries{
 constructor(storage,namespaceId){this.storage=storage;this.namespaceId=namespaceId;this.domains=new ProjectDomains(storage,namespaceId);}
 async context(area,type,operation,{signal}={}){
  return this.domains.run([],async(_get,{research,registry,inspect})=>{
   const owners=area==='version'?registry.domains:area==='planning'?planningReadDomains(type):operationalReadDomains[area];if(!owners)throw new AppError('INVALID');
   const context=await projectModuleReadContext(this.storage,this.namespaceId,new ProjectModuleIdentities(research,registry,inspect),owners,{scoped:area!=='version'});
   const reader=new ModuleReader(this.storage,{context:(workspaceId,consume)=>{if(workspaceId!==this.namespaceId)throw new AppError('WORKSPACE_CHANGED');return consume(context);}}),owner=new (area==='inventory'?InventoryReader:PlanningDashboard)(this.storage,{reader});
   return operation(context,reader,owner);
  },{signal});
 }
 async run(area,method,data,{signal}={}){
  if(data?.workspaceId!==this.namespaceId)throw new AppError('WORKSPACE_CHANGED');
  return this.context(area,data.type,async(context,_reader,owner)=>area==='version'?{workspaceId:this.namespaceId,revision:context.head.revision,revisions:context.revisions}:{...await owner[method](data,{signal}),revisions:context.revisions},{signal});
 }
}
