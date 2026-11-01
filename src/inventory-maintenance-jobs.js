import {InventoryReconciliation} from './modules/inventory-reconciliation.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {serialize} from './storage-format.js';
import {jobSummary} from './jobs.js';

const currentFile='.observanda/inventory-maintenance/current.json',type='inventory.reconcile';
export class InventoryMaintenanceJobs{
 constructor(workspace,queue){this.workspace=workspace;this.queue=queue;}
 async authorize(job){
  await this.workspace.requireStorageKey();if(await this.workspace.storageKind()!=='catalogue')throw new AppError('STORAGE_UPGRADE_REQUIRED');
  if(job.type!==type||job.scope!==(await this.workspace.outline()).metadata.id||!job.input||Object.keys(job.input).join()!=='version'||job.input.version!==1)throw new AppError('JOB_CHANGED');
 }
 async current(){
  const raw=await this.workspace.readMetadata(currentFile,1024);if(raw===null)return null;let saved;try{saved=JSON.parse(raw);}catch{throw new AppError('JOB_DAMAGED');}
  if(!saved||Object.keys(saved).join()!=='id'||!researchId(saved.id))throw new AppError('JOB_DAMAGED');const job=await this.queue.read(saved.id);if(!job)throw new AppError('JOB_DAMAGED');await this.authorize(job);return job;
 }
 async start(){return this.queue.transaction(async()=>{
  // Keep cancelled/failed work reachable through explicit retry. Replacing its
  // current pointer would strand an otherwise resumable accumulator forever.
  const current=await this.current();if(current&&current.state!=='completed')return current;
  const job=await this.queue.enqueueLocked({type,scope:(await this.workspace.outline()).metadata.id,input:{version:1}});await this.workspace.writeMetadata(currentFile,serialize({id:job.id}));return job;
 });}
 async control(id,action){const job=await this.current();if(!job||job.id!==id)throw new AppError('JOB_CHANGED');if(!['cancel','retry'].includes(action))throw new AppError('INVALID');return this.queue.control(id,action);}
 async prepare(job,options){await this.authorize(job);return new InventoryReconciliation(this.workspace,job).prepare(options);}
 async commit(job,prepared){await this.authorize(job);return new InventoryReconciliation(this.workspace,job).commit(prepared);}
}
export function inventoryMaintenanceJobDefinitions(workspace,current){
 const service=()=>new InventoryMaintenanceJobs(workspace,current());
 return {[type]:{authorize:job=>service().authorize(job),prepare:(job,options)=>service().prepare(job,options),commit:(job,prepared)=>service().commit(job,prepared)}};
}
export function inventoryMaintenanceRequest(route,method='POST'){
 const match=/^\/api\/maintenance\/inventory\/(start|status|cancel|retry)$/.exec(route);return method==='POST'&&match?{maintenance:match[1],write:match[1]!=='status',limit:4096}:null;
}
export async function executeInventoryMaintenance(workspace,owner,operation,data){
 if(!['start','status','cancel','retry'].includes(operation)||!data||Array.isArray(data)||Object.keys(data).some(key=>key!=='id')||['start','status'].includes(operation)&&Object.keys(data).length||['cancel','retry'].includes(operation)&&!researchId(data.id))throw new AppError('INVALID');
 const service=new InventoryMaintenanceJobs(workspace,owner.queue);if(operation==='status')return {job:jobSummary(await service.current())};
 const job=operation==='start'?await service.start():await service.control(data.id,operation);if(operation==='cancel')owner.worker.cancel(job.id);else owner.worker.wake();return {job:jobSummary(job)};
}
