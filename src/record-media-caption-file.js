import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {executeResearchRequest} from './research-requests.js';
import {readableCaptions} from './website-recordings.js';

// The saved record is read through the ordinary record value command, so a
// caption is served only to whoever can read that record in this owner.
// Cues that cannot be read are left out; a track with none is an empty file.
export async function recordCaptionText(storage,{recordId,attachmentId,language},{signal}={}){
 if(!researchId(recordId)||!researchId(attachmentId))throw new AppError('INVALID');
 const workspaceId=await storage.catalogue(async store=>(await store.snapshot(await store.head())).metadata.id);
 const read=await executeResearchRequest(storage,'/api/research/records/values/read',{workspaceId,recordId,field:'media:'+attachmentId},{signal});
 const track=read.value?.value?.captions?.find(item=>item.language===language);
 if(!track)throw new AppError('NOT_FOUND');
 return readableCaptions(track.vtt);
}
