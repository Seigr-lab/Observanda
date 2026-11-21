// Before files leave the computer, the website editor candidate verifies its
// saved bytes and privacy. Websites are the only file sets Observanda publishes.
import {WebsiteFilesCandidate} from './website-files-candidate.js';
import {AppError} from './errors.js';
import {operationStage,operationAdvance,operationWork} from './operation-progress.js';
export async function verifyPublicationCandidate(candidate,{signal,onFile,remoteProgress=false}={}){
 if(!(candidate instanceof WebsiteFilesCandidate))throw new AppError('INVALID');
 if(remoteProgress)return operationStage('remoteCheckFiles',{unit:'files',total:candidate.files.size},()=>candidate.verify({signal,onFile:bytes=>{operationAdvance();operationWork({bytes});return onFile?.(bytes);}}));
 return candidate.verify({signal,onFile});
}
