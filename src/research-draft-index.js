import {CheckpointIndex,checkpointKey,validCheckpointSummary} from './checkpoint-index.js';
export const draftKey=checkpointKey;
export function draftSummary({draft,revision},sourceRevision){
 return {id:draft.id,workspaceId:draft.workspaceId,revision,sourceRevision,updatedAt:draft.updatedAt,count:[3,4,5,6].includes(draft.formatVersion)?draft.count:draft.changes.length,titles:[3,4,5,6].includes(draft.formatVersion)?draft.titles:draft.changes.slice(0,3).map(c=>c.record.title.slice(0,160))};
}
export const validDraftSummary=validCheckpointSummary;
export class ResearchDraftIndex extends CheckpointIndex{
 constructor(workspace,read){super(workspace,read,{source:'.observanda/drafts',order:'.observanda/draft-list',cursorKind:'draft-page',summary:draftSummary,validSummary:validDraftSummary});}
}
