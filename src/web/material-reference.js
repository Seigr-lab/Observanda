import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
// The namespace is part of a retained address. Display fields and access grants
// are not; resolving the address still requires its owner's authorization.
export const materialKinds=Object.freeze(['artifact','dataset','analysis','collection']);
export const validMaterialReference=value=>!!value&&['record',...materialKinds].includes(value.kind)&&researchId(value.id)&&revisionId(value.revision)&&(value.workspaceId===undefined||researchId(value.workspaceId));
export const materialReference=value=>({kind:value.kind,id:value.id,revision:value.revision,...(value.workspaceId===undefined?{}:{workspaceId:value.workspaceId})});
export const materialReferenceKey=value=>value.kind+':'+value.id+':'+value.revision+(value.workspaceId===undefined?'':':'+value.workspaceId);
