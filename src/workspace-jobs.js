import {inventoryMaintenanceJobDefinitions} from './inventory-maintenance-jobs.js';
import {ComparisonJobAccess} from './comparison-job-access.js';
import {repositoryJobDefinitions} from './github-repository.js';
import {Publisher} from './publishing.js';
// Modules provide job semantics; one workspace worker schedules all types.
import {AppError} from './errors.js';
import {DurableJobs,JobWorker} from './jobs.js';
import {researchJobDefinitions} from './research-jobs.js';
import {mediaJobDefinitions} from './media-imports.js';
import {intakeJobDefinitions} from './intake/jobs.js';
import {WebsiteFileStore} from './website-file-store.js';
import {fileSiteWorkspace,fileSiteJobQueue} from './website-files-repository.js';
import {workspaceMoveJobDefinitions,recoverWorkspaceMove} from './workspace-move-jobs.js';
export function websitePublisher(publisher,workspace){
 if(publisher.workspace===workspace)return publisher;
 const scoped=new Publisher(workspace.root,{workspace,request:publisher.request,liveRequest:publisher.liveRequest,ssh:publisher.ssh,sftp:publisher.sftp,ftp:publisher.ftp,hostCredentials:publisher.hostCredentials,connection:publisher.connection},workspace.vault);
 Object.defineProperty(scoped,'token',{get:()=>publisher.token,set:value=>{publisher.token=value;}});return scoped;
}
// Websites made in the website editor run only repository setup as jobs. Each
// job carries its site id and keeps its journal with that website's own files.
function publicationDefinitions(workspace,publisher,current){
 const definitions=(w,p,q)=>repositoryJobDefinitions(w,p,q),result={};
 for(const [type,definition] of Object.entries(definitions(workspace,publisher,current)))result[type]=Object.fromEntries(Object.keys(definition).map(method=>[method,(job,...args)=>{
  if(!job.input.fileSiteId)throw new AppError('JOB_UNSUPPORTED');
  const scoped=fileSiteWorkspace(workspace,new WebsiteFileStore(workspace),job.input.fileSiteId),services=definitions(scoped,websitePublisher(publisher,scoped),()=>fileSiteJobQueue(current(),job.input.fileSiteId));
  return services[type][method](job,...args);
 }]));return result;
}
export function workspaceJobDefinitions(workspace,publisher,current,services={}){return {...workspaceMoveJobDefinitions(workspace),...inventoryMaintenanceJobDefinitions(workspace,current),...intakeJobDefinitions(workspace,current),...researchJobDefinitions(workspace,current,services),...mediaJobDefinitions(workspace,current),...publicationDefinitions(workspace,publisher,current)};}
export function workspaceJobs(workspace,publisher=new Publisher(workspace.root,{},workspace.vault),options={}){
 const current=()=>queue,comparisonAccess=options.comparisonAccess??new ComparisonJobAccess();
 const queue=new DurableJobs(workspace,workspaceJobDefinitions(workspace,publisher,current,{sourceAccess:options.sourceAccess,comparisonAccess}),options);
 const worker=new JobWorker(queue);let recovery;
 return {queue,worker,comparisonAccess,
  recover:()=>recovery??=recoverWorkspaceMove(workspace,queue).then(job=>{if(job)worker.wake();return job;}),
  async stop(){await worker.stop();await recovery?.catch(()=>{});recovery=null;}
 };
}
