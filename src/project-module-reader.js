// Read-only domain routing shares pagination/filters with the existing reader.
// A cursor is bound only to its requested owners and relevant research scope.
import {ProjectDomains} from './project-domains.js';
import {ProjectModuleIdentities} from './project-module-identities.js';
import {projectModuleReadContext,operationalReadDomains} from './project-module-read-context.js';
import {ModuleReader} from './modules/reader.js';
import {moduleDomain} from './modules/domains.js';
import {AppError} from './errors.js';
export class ProjectModuleReader{
 constructor(storage,namespaceId){this.storage=storage;this.namespaceId=namespaceId;this.domains=new ProjectDomains(storage,namespaceId);}
 async context(workspaceId,operation,{domains=null,scoped=true,signal}={}){
  if(workspaceId!==this.namespaceId)throw new AppError('WORKSPACE_CHANGED');
  return this.domains.run([],async(_get,{research,registry,inspect})=>operation(await projectModuleReadContext(this.storage,this.namespaceId,new ProjectModuleIdentities(research,registry,inspect),domains??registry.domains,{scoped})),{signal});
 }
 async run(method,data,options={}){
  const reader=new ModuleReader(this.storage,{context:(workspaceId,operation)=>{
   if(workspaceId!==this.namespaceId)throw new AppError('WORKSPACE_CHANGED');
   return this.domains.run([],async(_get,{research,registry,inspect})=>{
    const identities=new ProjectModuleIdentities(research,registry,inspect),owned=new Set();
    if(method==='list'){
     const types=data.type?[data.type]:data.types;
     for(const domain of types===null||types===undefined?registry.domains:types.map(moduleDomain))owned.add(domain);
    }else for(const id of method==='selected'?[data.id]:data.ids){const route=await identities.locate('entity',id);if(route)owned.add(route.domain);}
    const scoped=method==='list'&&Boolean(data.projectId||data.scopeIds||data.moduleId||data.reference);
    if(scoped){
     if(data.moduleId==='resources')for(const domain of operationalReadDomains.inventory)owned.add(domain);
     if(owned.has('equipment'))owned.add('inventory');
    }
    const context=await projectModuleReadContext(this.storage,this.namespaceId,identities,[...owned],{scoped}),revisions=context.revisions;
    const result=await operation(context);return {...result,revisions};
   },{signal:options.signal});
  }});
  return reader[method](data,options);
 }
 list(data,options){return this.run('list',data,options);}
 selected(data,options){return this.run('selected',data,options);}
 labels(data,options){return this.run('labels',data,options);}
}
