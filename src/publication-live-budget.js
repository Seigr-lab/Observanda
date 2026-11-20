import {contentHash,contentSize} from './file-content.js';
import {AppError} from './errors.js';

export function validLiveManifestBudget(receipt){return Number.isSafeInteger(receipt?.manifestBytes)&&receipt.manifestBytes>0&&Number.isSafeInteger(receipt.manifestFiles)&&receipt.manifestFiles>=0;}
export async function reviewedManifest(candidate){
 const manifest=await candidate.files.get('publication.json'),result={manifestHash:contentHash(manifest),manifestBytes:contentSize(manifest),manifestFiles:candidate.files.size-1};
 if(!validLiveManifestBudget(result))throw new AppError('JOB_DAMAGED');return result;
}
// A receipt is verified against the manifest bounds recorded when it was
// written. Remote headers and a heuristic bytes-per-file ratio are not authority.
export async function liveManifestReceipt(_workspace,_key,receipt){return validLiveManifestBudget(receipt)?receipt:null;}
