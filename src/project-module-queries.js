import {ProjectDomains} from './project-domains.js';
import {ProjectModuleIdentities} from './project-module-identities.js';
import {projectModuleReadContext,operationalReadDomains,planningReadDomains} from './project-module-read-context.js';
import {ModuleReader} from './modules/reader.js';
import {InventoryReader} from './modules/inventory-reader.js';
import {PlanningDashboard} from './modules/dashboard.js';
import {AppError} from './errors.js';
export class ProjectModuleQueries{
 constructor(storage,namespaceId){this.storage=storage;this.namespaceId=namespaceId;this.domains=new ProjectDomains(storage,namespaceId);}
 async run(area,method,data,{signal}={}){
  if(data?.workspaceId!==this.namespaceId)throw new AppError('WORKSPACE_CHANGED');
  return this.domains.run([],async(_get,{research,registry,inspect})=>{
   const owners=area==='version'?registry.domains:area==='planning'?planningReadDomains(data.type):operationalReadDomains[area];if(!owners)throw new AppError('INVALID');
   const context=await projectModuleReadContext(this.storage,this.namespaceId,new ProjectModuleIdentities(research,registry,inspect),owners,{scoped:area!=='version'});
   if(area==='version')return {workspaceId:this.namespaceId,revision:context.head.revision,revisions:context.revisions};
   const reader=new ModuleReader(this.storage,{context:(workspaceId,operation)=>{if(workspaceId!==this.namespaceId)throw new AppError('WORKSPACE_CHANGED');return operation(context);}}),owner=new (area==='inventory'?InventoryReader:PlanningDashboard)(this.storage,{reader});
   return {...await owner[method](data,{signal}),revisions:context.revisions};
  },{signal});
 }
}
