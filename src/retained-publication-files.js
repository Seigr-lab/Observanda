// Before files leave the computer, a website editor candidate verifies its saved
// bytes and privacy; other file sets are checked by the publication rules.
import {verifyPublication,verifyPublicationManifest} from './publication.js';
import {WebsiteFilesCandidate} from './website-files-candidate.js';
import {operationStage,operationAdvance,operationWork} from './operation-progress.js';
export async function verifyPublicationCandidate(candidate,{allowDesign=false,signal,privacy=true,onFile,remoteProgress=false}={}){
 if(candidate instanceof WebsiteFilesCandidate){
  if(remoteProgress)return operationStage('remoteCheckFiles',{unit:'files',total:candidate.files.size},()=>candidate.verify({signal,onFile:bytes=>{operationAdvance();operationWork({bytes});return onFile?.(bytes);}}));
  return candidate.verify({signal,onFile});
 }
 return privacy?verifyPublication(candidate,{allowDesign}):verifyPublicationManifest(candidate);
}
