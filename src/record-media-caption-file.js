import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {executeResearchRequest} from './research-requests.js';
import {RecordHistoryDocuments} from './record-history-documents.js';
import {readableCaptions} from './website-recordings.js';

// The saved record is read through the ordinary record value command, so a
// caption is served only to whoever can read that record in this owner.
// Cues that cannot be read are left out; a track with none is an empty file.
// An earlier version is named by the revision and source the revision view
// read it with; its captions are exactly the ones that version held.
export async function recordCaptionText(storage,{recordId,attachmentId,language,revision=null,source=null},{signal}={}){
 if(!researchId(recordId)||!researchId(attachmentId))throw new AppError('INVALID');
 const workspaceId=await storage.catalogue(async store=>(await store.snapshot(await store.head())).metadata.id);
 const attachment=revision!==null||source!==null
  ?await new RecordHistoryDocuments(storage).attachment({workspaceId,recordId,revision,source},attachmentId,{signal})
  :(await executeResearchRequest(storage,'/api/research/records/values/read',{workspaceId,recordId,field:'media:'+attachmentId},{signal})).value?.value;
 const track=attachment?.captions?.find(item=>item.language===language);
 if(!track)throw new AppError('NOT_FOUND');
 return readableCaptions(track.vtt);
}
