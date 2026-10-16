import {CheckpointIndex,validCheckpointSummary} from '../checkpoint-index.js';
export const moduleIdValid=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,79}$/.test(value);
export function moduleDraftSummary({draft,etag},sourceRevision){
 if(!draft.drafts.length)return null;
 return {id:draft.id,workspaceId:draft.workspaceId,moduleId:draft.moduleId,revision:etag,sourceRevision,updatedAt:draft.updatedAt,count:draft.drafts.length,
  titles:draft.drafts.slice(0,3).map(d=>String(d.data?.name??d.data?.title??d.type).slice(0,160))};
}
export class ModuleDraftIndex extends CheckpointIndex{
 constructor(workspace,read){super(workspace,read,{source:'.observanda/module-drafts',order:'.observanda/module-draft-list',cursorKind:'module-draft-page',summary:moduleDraftSummary,
  validSummary:value=>validCheckpointSummary(value)&&moduleIdValid(value.moduleId),scopeOf:value=>value.moduleId});}
}
