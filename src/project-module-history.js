// One item's immutable history comes from its declared domain, in a fixed
// read snapshot. Pagination retains the selected item revision across edits.
import {ProjectDomains} from './project-domains.js';
import {projectModuleHistoryContext} from './project-module-history-context.js';
import {ModuleHistory} from './modules/history.js';
import {uuid} from './modules/validation.js';
import {AppError} from './errors.js';
export class ProjectModuleHistory{
 constructor(storage,namespaceId){this.storage=storage;this.namespaceId=namespaceId;this.domains=new ProjectDomains(storage,namespaceId);}
 context(id,operation,options={}){
  if(!uuid(id))throw new AppError('INVALID');
  return this.domains.run([],(_get,context)=>projectModuleHistoryContext(context,id,operation),{signal:options.signal,check:options.check});
 }
 run(method,data,options){
  if(data?.workspaceId!==this.namespaceId)throw new AppError('WORKSPACE_CHANGED');
  const history=new ModuleHistory(this.storage,{context:operation=>this.context(data.id,operation,options)});
  return history[method](data);
 }
 page(data,options){return this.run('page',data,options);}
 read(data,options){return this.run('read',data,options);}
}
