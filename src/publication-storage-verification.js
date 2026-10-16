import {PublicationJobs} from './publication-jobs.js';
import {websiteWorkspace} from './website-workspace.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
import {verifyLocalExports} from './local-export-verification.js';
import {verifyDeploymentInventories} from './publication-live-inventory.js';

export async function verifyPublicationStorage(workspace){
 const check=async scoped=>{
  const releases=new PublicationJobs(scoped);
  for await(const file of scoped.metadataNames('.observanda/release-candidates')){
   if(!/^[a-f0-9]{64}\.json$/.test(file))throw new AppError('JOB_DAMAGED');
   await releases.verifyFiles(file.slice(0,-5));
  }
  await verifyLocalExports(scoped);
  await verifyDeploymentInventories(scoped);
 };
 await check(workspace);
 // Also retain editions of removed sites. Current website selection must not
 // decide which historical publication files a backup promises to preserve.
 for await(const id of workspace.metadataNames('.observanda/websites')){
  if(!researchId(id))throw new AppError('JOB_DAMAGED');await check(websiteWorkspace(workspace,id));
 }
}
