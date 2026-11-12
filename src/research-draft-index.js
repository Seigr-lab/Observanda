import {CheckpointIndex,checkpointKey,validCheckpointSummary} from './checkpoint-index.js';
export const draftKey=checkpointKey;
export function draftSummary({draft,revision},sourceRevision){
 return {id:draft.id,workspaceId:draft.workspaceId,revision,sourceRevision,updatedAt:draft.updatedAt,count:[3,4,5,6].includes(draft.formatVersion)?draft.count:draft.changes.length,titles:[3,4,5,6].includes(draft.formatVersion)?draft.titles:draft.changes.slice(0,3).map(c=>c.record.title.slice(0,160))};
}
export const validDraftSummary=validCheckpointSummary;
// Project authorized headers only. A multi-record checkpoint is reviewed one
// record at a time and can contain several different saved base revisions.
export function recordRecoverySummary(result,sourceRevision,{projectId,labBookId}){
 const summary=draftSummary(result,sourceRevision),{draft}=result;
 const change=draft.changes?.length===1?draft.changes[0]:null;
 const recordId=draft.base?.recordId??change?.record.id??null;
 const baseRevision=draft.base?.revision??change?.expectedRevision??null;
 return {...summary,recovery:{
  surface:'record',id:draft.id,owner:{workspaceId:draft.workspaceId,projectId,labBookId,recordId},
  documentKey:recordId??draft.id,revision:result.revision,baseRevision,updatedAt:draft.updatedAt,
  state:'unchecked',capabilities:{recover:false,compare:true,discard:true}
 }};
}
export class ResearchDraftIndex extends CheckpointIndex{
 constructor(workspace,read,present=null){super(workspace,read,{source:'.observanda/drafts',order:'.observanda/draft-list',cursorKind:'draft-page',summary:draftSummary,validSummary:validDraftSummary,present});}
}
