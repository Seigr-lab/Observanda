import {contentHash,contentSize} from './file-content.js';
import {AppError} from './errors.js';

export function validLiveManifestBudget(receipt){return Number.isSafeInteger(receipt?.manifestBytes)&&receipt.manifestBytes>0&&Number.isSafeInteger(receipt.manifestFiles)&&receipt.manifestFiles>=0;}
export async function reviewedManifest(candidate){
 const manifest=await candidate.files.get('publication.json'),result={manifestHash:contentHash(manifest),manifestBytes:contentSize(manifest),manifestFiles:candidate.files.size-1};
 if(!validLiveManifestBudget(result))throw new AppError('JOB_DAMAGED');return result;
}
// Old receipts can recover exact bounds from their authenticated retained
// edition. Remote headers and a heuristic bytes-per-file ratio are not authority.
export async function liveManifestReceipt(workspace,key,receipt){
 if(validLiveManifestBudget(receipt))return receipt;
 if(receipt.manifestBytes!==undefined||receipt.manifestFiles!==undefined)return null;
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(receipt.deploymentId??''))return null;
 const raw=await workspace.readMetadata('.observanda/deployments/'+receipt.deploymentId+'.json',16*1024*1024);if(raw===null)return null;
 let deployment;try{deployment=JSON.parse(raw);}catch{throw new AppError('JOB_DAMAGED');}
 const prior=deployment?.journal?.receipt;
 if(!prior||![1,2,3].includes(deployment?.version)||deployment.id!==receipt.deploymentId||deployment.intent?.key!==key||deployment.intent.releaseId!==receipt.releaseId||prior.commit!==receipt.commit||prior.manifestHash!==receipt.manifestHash||!/^[a-f0-9]{64}$/.test(deployment.intent.reviewId??''))throw new AppError('JOB_DAMAGED');
 const {PublicationJobs}=await import('./publication-jobs.js'),stored=await new PublicationJobs(workspace).stored(deployment.intent.reviewId);if(!stored)return null;if(stored.id!==receipt.releaseId)throw new AppError('JOB_DAMAGED');
 let manifest,files;
 if(stored.version===3){const {openPublicationOutput}=await import('./publication-output.js'),output=await openPublicationOutput(workspace,stored);manifest=await output.get('files','publication.json');files=output.count('files')-1;}
 else{const found=stored.files.filter(file=>file.name==='publication.json');if(found.length!==1)throw new AppError('JOB_DAMAGED');manifest=found[0];files=stored.files.length-1;}
 if(manifest?.sha256!==receipt.manifestHash)throw new AppError('JOB_DAMAGED');
 const result={...receipt,manifestBytes:manifest.size,manifestFiles:files};if(!validLiveManifestBudget(result))throw new AppError('JOB_DAMAGED');return result;
}
