import {verifyGithubPublishingPlans} from './github-plan-index.js';
import {PublicationEditionSelections} from './publication-edition-selections.js';
import {verifyRetainedPublicationRollback} from './publication-rollback.js';
import {AnalysisPublicationReview} from './analysis-publication-review.js';
import {openPublicationInput} from './publication-input-reader.js';
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
  await new PublicationEditionSelections(scoped).verify();
  for await(const file of scoped.metadataNames('.observanda/release-inputs')){
   if(researchId(file))continue;
   if(!file.endsWith('.json')||!researchId(file.slice(0,-5)))throw new AppError('JOB_DAMAGED');
   const id=file.slice(0,-5);
   // Unpublished capture journals may describe interrupted, partial cleanup.
   // Their inputs are recovered by the capture owner, never rendered as jobs.
   if(await scoped.readMetadata('.observanda/release-captures/'+id+'.json',1024)!==null)continue;
   const source=await releases.source(id);
   if(source.version===6){const input=await openPublicationInput(scoped,source);await input.verify();}
   if(source.version>=4&&source.version<6)for(const row of source.pageInputs)await readPublicationPage(scoped,source,row.id);
   if(source.version===5){const presentation=publicationPresentationReader(scoped,source);for(const target of presentation.layoutTargets())await presentation.layout(target);for(const target of presentation.brandingTargets())await presentation.branding(target);}
  }
  for await(const file of scoped.metadataNames('.observanda/release-candidates')){
   if(!/^[a-f0-9]{64}\.json$/.test(file))throw new AppError('JOB_DAMAGED');
   const id=file.slice(0,-5);await releases.verifyFiles(id);const candidate=await releases.stored(id);if(candidate?.version===3)await new AnalysisPublicationReview(scoped).verify(candidate);
  }
  for await(const file of scoped.metadataNames('.observanda/publication-rollback')){
   if(!file.endsWith('.json')||!researchId(file.slice(0,-5)))throw new AppError('JOB_DAMAGED');
   const raw=await scoped.readMetadata('.observanda/publication-rollback/'+file,16*1024*1024);let review;try{review=JSON.parse(raw);}catch{throw new AppError('JOB_DAMAGED');}
   if(!review||!/^[a-f0-9]{64}$/.test(review.reviewId))throw new AppError('JOB_DAMAGED');
   await verifyRetainedPublicationRollback(scoped,await releases.stored(review.reviewId),review,{id:file.slice(0,-5)});
  }
  await verifyLocalExports(scoped);
  await verifyDeploymentInventories(scoped);
  await verifyGithubPublishingPlans(scoped);
 };
 await check(workspace);
 // Also retain editions of removed sites. Current website selection must not
 // decide which historical publication files a backup promises to preserve.
 for await(const id of workspace.metadataNames('.observanda/websites')){
  if(!researchId(id))throw new AppError('JOB_DAMAGED');await check(websiteWorkspace(workspace,id));
 }
}
