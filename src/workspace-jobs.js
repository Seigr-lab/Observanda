import {ComparisonJobAccess} from './comparison-job-access.js';
import {publicationVerificationDefinitions} from './publication-verification-jobs.js';
import {deploymentJobDefinitions} from './deployment-jobs.js';
import {repositoryJobDefinitions} from './github-repository.js';
import {Publisher} from './publishing.js';
import {publicationJobDefinitions} from './publication-jobs.js';
import {analysisPublicationReviewDefinitions} from './analysis-publication-review-jobs.js';
// Modules provide job semantics; one workspace worker schedules all types.
import {DurableJobs,JobWorker} from './jobs.js';
import {researchJobDefinitions} from './research-jobs.js';
import {mediaJobDefinitions} from './media-imports.js';
import {intakeJobDefinitions} from './intake/jobs.js';
import {websiteWorkspace,websiteJobQueue} from './website-workspace.js';
export function websitePublisher(publisher,workspace){
 if(publisher.workspace===workspace)return publisher;
 const scoped=new Publisher(workspace.root,{workspace,request:publisher.request,ssh:publisher.ssh,connection:publisher.connection},workspace.vault);
 Object.defineProperty(scoped,'token',{get:()=>publisher.token,set:value=>{publisher.token=value;}});return scoped;
}
function publicationDefinitions(workspace,publisher,current,services){
 const definitions=(w,p,q)=>({...publicationJobDefinitions(w,q,services),...analysisPublicationReviewDefinitions(w,p,q,services),...deploymentJobDefinitions(w,p,q,services),...repositoryJobDefinitions(w,p,q),...publicationVerificationDefinitions(w,p,q)});
 const defaultWorkspace=websiteWorkspace(workspace,null),normal=definitions(defaultWorkspace,websitePublisher(publisher,defaultWorkspace),()=>websiteJobQueue(current(),null)),result={};
 for(const [type,definition] of Object.entries(normal))result[type]=Object.fromEntries(Object.keys(definition).map(method=>[method,(job,...args)=>{
  if(!job.input.websiteId)return definition[method](job,...args);
  const scoped=websiteWorkspace(workspace,job.input.websiteId),services=definitions(scoped,websitePublisher(publisher,scoped),()=>websiteJobQueue(current(),job.input.websiteId));
  return services[type][method](job,...args);
 }]));return result;
}
export function workspaceJobDefinitions(workspace,publisher,current,services={}){return {...intakeJobDefinitions(workspace,current),...researchJobDefinitions(workspace,current,services),...mediaJobDefinitions(workspace,current),...publicationDefinitions(workspace,publisher,current,services)};}
export function workspaceJobs(workspace,publisher=new Publisher(workspace.root,{},workspace.vault),options={}){
 const current=()=>queue,comparisonAccess=options.comparisonAccess??new ComparisonJobAccess();
 const queue=new DurableJobs(workspace,workspaceJobDefinitions(workspace,publisher,current,{sourceAccess:options.sourceAccess,comparisonAccess}),options);
 return {queue,worker:new JobWorker(queue),comparisonAccess};
}
