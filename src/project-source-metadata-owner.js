import {retiredMetadataSourceOwner} from './project-retired-metadata.js';
import {projectSourceWorkspaceSettingsOwner} from './project-source-workspace-settings-owner.js';
import {projectSourcePeerReviewOwner} from './project-source-peer-review-owner.js';
import {projectSourceStarterOwner,newStarterPart} from './project-source-starter-owner.js';
import {projectSourceFontOwner} from './project-source-font-owner.js';
import {projectSourceMediaOwner} from './project-source-media-owner.js';
import {projectSourcePublicationOwner} from './project-source-publication-owner.js';
import {projectSourceDraftReviewOwner} from './project-source-draft-review-owner.js';
import {projectSourceAuthoringOwner} from './project-source-authoring-owner.js';
import {projectSourceModuleDraftOwner} from './project-source-module-draft-owner.js';
import {projectSourceIntakeOwner} from './project-source-intake-owner.js';
import {projectSourceJobOwner} from './project-source-job-owner.js';
// Domain ownership for metadata differences. Unknown owners remain explicit;
// this coordinator never infers ownership from links or a global writer lock.
import {projectSourceRecordOwner} from './project-source-record-owner.js';
import {projectSourceEvidenceOwner,newEvidencePart} from './project-source-evidence-owner.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const unknown=Object.freeze({kind:'unknown'}),derived=Object.freeze({kind:'derived'});
export function projectSourceMetadataOwner(store,inventory,{signal}={}){
 const settings=projectSourceWorkspaceSettingsOwner(store),record=projectSourceRecordOwner(store,inventory,{signal}),evidence=projectSourceEvidenceOwner(store,record,{signal}),jobs=projectSourceJobOwner(store,inventory,record,{signal}),intakes=projectSourceIntakeOwner(store,inventory,record,{signal}),moduleDrafts=projectSourceModuleDraftOwner(store,inventory,{signal}),authoring=projectSourceAuthoringOwner(store,inventory,record,{signal}),draftReviews=projectSourceDraftReviewOwner(store,inventory,record,{signal}),media=projectSourceMediaOwner(store,inventory,{signal}),publications=projectSourcePublicationOwner(store,inventory,{signal}),fonts=projectSourceFontOwner(store,inventory,{signal}),starters=projectSourceStarterOwner(store,inventory,record,{signal}),reviews=projectSourcePeerReviewOwner(store,inventory,record,{signal});
 return async(id,{added=false}={})=>{
  signal?.throwIfAborted();
  const retired=await retiredMetadataSourceOwner(store,id);if(retired)return retired;
  // A newly added immutable part cannot alter an already verified retained
  // graph. New references still change an owning header and are classified.
  // Changed/deleted parts must never use this exemption.
  if(added&&(newEvidencePart(id)||newStarterPart(id)))return derived;
  let match;
  if((match=/^metadata:\.observanda\/run-readiness\/projects\/([^/]+)\.json$/.exec(id))){if(!researchId(match[1]))throw new AppError('CATALOGUE_DAMAGED');return {kind:'project',projectId:match[1]};}
  if((match=/^metadata:\.observanda\/run-readiness\/(?:records|completed)\/([^/]+)\.json$/.exec(id)))return record(match[1]);
  if((match=/^metadata:\.observanda\/run-readiness\/receipts\/([^/.]+)(?:\.json|\/(?:items-order\.json|items\/[^/]+\.json|items-order\/[^/]+\.json|basis\/[a-f0-9]{64}\/[a-f0-9]{64}\/(?:validation|publication|git)\.json))$/.exec(id)))return record(match[1]);
  return await settings(id)??await evidence(id)??await jobs(id)??await intakes(id)??await moduleDrafts(id)??await authoring(id)??await draftReviews(id)??await media(id)??await publications(id)??await fonts(id)??await starters(id)??await reviews(id)??unknown;
 };
}
