import {ProjectApplication,projectRequest} from './project-application.js';
import {withWorkspaceDeletionSession} from './workspace-deletion-session.js';
import {researchId} from './web/research-reference.js';
// Deletion of a saved, closed owner does not adopt it or acquire the open
// workspace's writer. Review keys live only in bounded, session-owned memory.
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {readAccess} from './access.js';
import {inspectLocation} from './locations.js';
import {Workspace,assertRegular} from './storage.js';
import {clearVault} from './encryption.js';
import {databaseProvider} from './workspace-database-context.js';
import {workspaceDeletion} from './workspace-delete-state.js';
import {AppError} from './errors.js';

const same=(a,b)=>!!a&&!!b&&path.relative(a,b)==='';
const credentials=data=>[data.username??'',data.password??'',data.recovery??''];
const fields=(data,allowed)=>{
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(key=>!allowed.includes(key)))throw new AppError('INVALID');
};
export class SavedWorkspaceDeletion{
 constructor({deletions,locations,protectedPaths,authenticate,activeRoot,forget,deviceStore}){
  Object.assign(this,{deletions,locations,protectedPaths,authenticate,activeRoot,forget,deviceStore});
  this.plans=new Map();this.running=new Set();this.disposals=new Map();this.closed=false;
  this.timer=setInterval(()=>this.expire(),30000);this.timer.unref();
 }
 expire(){
  for(const [id,plan] of this.plans)if(plan.expires<Date.now()&&!this.running.has(plan.plan.source)){this.plans.delete(id);void this.dispose(plan).catch(()=>{});}
  // Retry failed shutdowns without leaving a rejected background promise or
  // dropping the reference needed to close that owner's readers and workers.
  for(const [plan,pending] of this.disposals)if(!pending)void this.dispose(plan).catch(()=>{});
 }
 dispose(plan){
  const pending=this.disposals.get(plan);if(pending)return pending;
  const cleanup=(async()=>{try{await plan.projects?.close();}finally{clearVault(plan.vault);}})();
  this.disposals.set(plan,cleanup);cleanup.then(()=>this.disposals.delete(plan),()=>this.disposals.set(plan,null));return cleanup;
 }
 async close(){
  this.closed=true;clearInterval(this.timer);const plans=new Set([...this.plans.values(),...this.disposals.keys()]);this.plans.clear();
  const results=await Promise.allSettled([...plans].map(plan=>this.dispose(plan))),failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
 }
 assertAvailable(root){if([...this.running].some(value=>same(value,root)))throw new AppError('STORAGE_DELETE_BUSY');}
 async selected(input){
  if(typeof input!=='string'||!path.isAbsolute(input))throw new AppError('INVALID');
  if(!(await this.locations()).some(item=>same(item.path,input)))throw new AppError('NOT_FOUND');
  const location=await inspectLocation(input);if(location.kind!=='workspace')throw new AppError('MISSING');return location.root;
 }
 async run(root,operation,{retired=false}={}){
  if(this.closed)throw new AppError('SERVER_CLOSING');
  this.assertAvailable(root);if(!retired&&same(this.activeRoot(),root))throw new AppError('STORAGE_DELETE_BUSY');
  this.running.add(root);
  try{return await operation();}finally{this.running.delete(root);}
 }
 async review(client,data){
  fields(data,['path','username','password','recovery']);this.expire();
  const root=await this.selected(data.path);
  return this.run(root,async()=>{
   let vault;
   try{
    const access=await readAccess(root);vault=await this.authenticate(root,access,...credentials(data));
    const workspace=new Workspace(root,vault),plan=await this.deletions.review(workspace,{protectedPaths:[...this.protectedPaths,this.activeRoot()],recent:await this.locations()});
    // Reviewing a closed owner must not leave its database process running.
    await databaseProvider()?.closeWorkspace(root);
    if(this.closed)throw new AppError('SERVER_CLOSING');
    while(this.plans.size>=5){const available=[...this.plans].find(([,prior])=>!this.running.has(prior.plan.source));if(!available)throw new AppError('STORAGE_DELETE_BUSY');const [id,prior]=available;this.plans.delete(id);await this.dispose(prior);}
    const id=randomBytes(24).toString('hex');this.plans.set(id,{client,plan,vault,access:access.etag,expires:Date.now()+10*60*1000});vault=null;
    return {id,source:plan.source,title:plan.title,database:plan.binding?.placement==='workspace'?'workspace':plan.binding?'catalogue':'files'};
   }finally{if(vault){clearVault(vault);await databaseProvider()?.closeWorkspace(root);}}
  });
 }
 async confirm(client,data){
  fields(data,['id','path','title','confirmed']);this.expire();
  const entry=this.plans.get(data.id);if(!entry||entry.client!==client)throw new AppError('STALE');
  if(data.confirmed!==true||data.path!==entry.plan.source||data.title!==entry.plan.title)throw new AppError('STORAGE_DELETE_CONFIRM');
  return this.run(entry.plan.source,async()=>{
   const {plan,vault}=entry;let consumed=false;
   try{
    if((await readAccess(plan.source)).etag!==entry.access)throw new AppError('CONFLICT');
    const workspace=new Workspace(plan.source,vault);
    // Recheck known aliases and nested owners added since confirmation opened.
    await this.deletions.review(workspace,{protectedPaths:[...this.protectedPaths,this.activeRoot()],recent:await this.locations()});
    entry.projects??=new ProjectApplication(workspace,{deviceStore:this.deviceStore,authenticate:this.authenticate});
    const result=await withWorkspaceDeletionSession(entry.projects,client,owners=>this.deletions.begin(workspace,plan,{...owners,onFrozen:()=>{consumed=true;this.plans.delete(data.id);}}));consumed=true;
    await this.forget(result.source);await this.deletions.acknowledge(result.id);return {result,selectedWorkspace:true};
   }finally{if(consumed){this.plans.delete(data.id);await this.dispose(entry);}await databaseProvider()?.closeWorkspace(plan.source);}
  });
 }
 async unlock(client,data){
  fields(data,['id','projectId','labBookId','username','password','recovery']);this.expire();
  const entry=this.plans.get(data.id);if(!entry||entry.client!==client||!entry.projects)throw new AppError('STALE');
  if(!researchId(data.projectId)||data.labBookId!==undefined&&!researchId(data.labBookId))throw new AppError('INVALID');
  return this.run(entry.plan.source,async()=>{
   if((await readAccess(entry.plan.source)).etag!==entry.access)throw new AppError('CONFLICT');
   const project=await (await entry.projects.registry()).locate(data.projectId),relative=path.relative(entry.plan.source,project.root).split(path.sep).join('/');
   if(!entry.plan.projectDirectories?.includes(relative))throw new AppError('ACCESS_DENIED');
   const access={username:data.username??'',password:data.password??'',recovery:data.recovery??''};
   if(!data.labBookId)return entry.projects.unlock(client,data.projectId,access);
   return entry.projects.run(client,projectRequest('/api/projects/'+data.projectId+'/lab-books/'+data.labBookId+'/access/unlock'),access);
  });
 }
 async cancel(client,data){
  fields(data,['id']);const entry=this.plans.get(data.id);if(!entry||entry.client!==client)throw new AppError('STALE');
  this.assertAvailable(entry.plan.source);this.plans.delete(data.id);await this.dispose(entry);return {cancelled:true};
 }
 async finish(data){
  fields(data,['id','confirmed','username','password','recovery']);if(data.confirmed!==true)throw new AppError('INVALID');
  const receipt=await this.deletions.read(data.id),retiredPath=path.join(path.dirname(receipt.source),'.observanda-delete-'+receipt.id);
  const retired=['retired','complete'].includes(receipt.phase)||!!await assertRegular(retiredPath,{directory:true,missing:true});
  return this.run(receipt.source,async()=>{
   let vault;
   try{
    if(!retired&&(receipt.phase!=='prepared'||await workspaceDeletion(receipt.source)))vault=await this.authenticate(receipt.source,await readAccess(receipt.source),...credentials(data));
    const result=await this.deletions.finish(data.id,{vault});
    if(result.complete){await this.forget(result.source);await this.deletions.acknowledge(data.id);}
    return {result,selectedWorkspace:true};
   }finally{try{if(!retired)await databaseProvider()?.closeWorkspace(receipt.source);}finally{clearVault(vault);}}
  },{retired});
 }
}
