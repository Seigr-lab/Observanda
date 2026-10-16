// Explicit recovery owner; it never takes the project research writer or the
// saved-command writer. The lifecycle handoff still fences copy/move/delete.
import {ProjectDomains} from './project-domains.js';
import {projectModuleDraftContext} from './project-module-draft-context.js';
import {moduleDraftDomain,moduleDraftTypes} from './modules/draft-domains.js';
import {ModuleDraftTransfer} from './modules/draft-transfer.js';
import {AppError} from './errors.js';
export function checkProjectModuleDraft(draft,moduleId){
 if(draft===null)return;
 const types=moduleDraftTypes(moduleId);if(draft.moduleId!==moduleId||!Array.isArray(draft.drafts)||draft.drafts.some(d=>!types.includes(d.type)))throw new AppError('MODULE_FORMAT');
}
export class ProjectModuleDrafts{
 constructor(storage,namespaceId){this.storage=storage;this.namespaceId=namespaceId;this.domains=new ProjectDomains(storage,namespaceId);}
 async run(method,data,{signal,check}={}){
  if(data?.workspaceId!==this.namespaceId)throw new AppError('WORKSPACE_CHANGED');
  const {moduleId}=data,domain=moduleDraftDomain(moduleId),write=!['list','read'].includes(method);
  return this.domains.run([domain],async(_get,context)=>{
   if(context.registry?.authoringVersion!==1)throw new AppError('ACCESS_UPGRADE');
   const {workspace,drafts}=await projectModuleDraftContext(context,moduleId,{writable:write});
   if(method==='list')return drafts.list(moduleId,data,{signal});
   if(method==='read'){const result=await drafts.read(data.id);checkProjectModuleDraft(result?.draft??null,moduleId);return result;}
   if(method==='write'){checkProjectModuleDraft(data,moduleId);return {etag:(await drafts.write(data)).etag};}
   const {moduleId:unused,...command}=data;void unused;const transfer=new ModuleDraftTransfer(workspace);
   if(!['start','part','finish'].includes(method))throw new AppError('INVALID');
   const result=await transfer[method](command,{signal});if(method==='finish'){const saved=await drafts.read(data.id,{expand:false});checkProjectModuleDraft(saved?.draft??null,moduleId);}return result;
  },{authoring:write?[moduleId]:[],signal,check});
 }
 list(data,options){return this.run('list',data,options);}
 read(data,options){return this.run('read',data,options);}
 write(data,options){return this.run('write',data,options);}
 start(data,options){return this.run('start',data,options);}
 part(data,options){return this.run('part',data,options);}
 finish(data,options){return this.run('finish',data,options);}
}
