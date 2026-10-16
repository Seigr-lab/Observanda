import {researchId} from './research-reference.js';
import {attemptGroup,validAttemptFact} from './attempt-model.js';

export function attemptValueField(field){
 if(typeof field!=='string')return null;
 const parts=field.split(':');
 if(parts.length!==3||parts[0]!=='attempt'||!['preparation','event','assessment'].includes(parts[1])||!researchId(parts[2]))return null;
 return {kind:parts[1],group:attemptGroup(parts[1]),id:parts[2]};
}
export const validAttemptValue=(item,field)=>{const selected=attemptValueField(field);return !!selected&&item?.id===selected.id&&validAttemptFact(selected.kind,item,{draft:true});};
