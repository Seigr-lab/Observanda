import {publicationPresentationReader} from './publication-input-presentation.js';
import {readPublicationPage} from './publication-input-pages.js';
import {PublicationJobs} from './publication-jobs.js';
import {websiteWorkspace} from './website-workspace.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
import {verifyLocalExports} from './local-export-verification.js';
import {verifyDeploymentInventories} from './publication-live-inventory.js';

export async function verifyPublicationStorage(workspace){
 const check=async scoped=>{
  const releases=new PublicationJobs(scoped);
  for await(const file of scoped.metadataNames('.observanda/release-inputs')){
   if(researchId(file))continue;
   if(!file.endsWith('.json')||!researchId(file.slice(0,-5)))throw new AppError('JOB_DAMAGED');
   const id=file.slice(0,-5);
   // Unpublished capture journals may describe interrupted, partial cleanup.
   // Their inputs are recovered by the capture owner, never rendered as jobs.
   if(await scoped.readMetadata('.observanda/release-captures/'+id+'.json',1024)!==null)continue;
   const source=await releases.source(id);
   if(source.version>=4)for(const row of source.pageInputs)await readPublicationPage(scoped,source,row.id);
   if(source.version===5){const presentation=publicationPresentationReader(scoped,source);for(const target of presentation.layoutTargets())await presentation.layout(target);for(const target of presentation.brandingTargets())await presentation.branding(target);}
  }
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
