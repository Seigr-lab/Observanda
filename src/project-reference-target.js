// Internal ownership addresses include retained evidence. Public navigation
// URLs retain their own narrower validation in web/research-reference.js.
import {validTarget,researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
export const projectReferenceKinds=Object.freeze(['project','notebook','record','artifact','dataset','analysis','collection']);
export function validProjectReferenceTarget(value){
 if(validTarget(value))return value.kind!=='workspace';
 return !!value&&Object.keys(value).sort().join()==='id,kind,revision,workspaceId'&&projectReferenceKinds.slice(3).includes(value.kind)&&researchId(value.workspaceId)&&researchId(value.id)&&revisionId(value.revision);
}
