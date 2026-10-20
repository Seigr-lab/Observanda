import {revisionId} from './revision-model.js';
import {researchId} from './research-reference.js';
import {attemptGroup,validAttemptFact} from './attempt-model.js';

export function attemptValueField(field){
 if(typeof field!=='string')return null;
 const parts=field.split(':');
 if(parts.length!==3||parts[0]!=='attempt'||!['preparation','event','assessment'].includes(parts[1])||!researchId(parts[2]))return null;
 return {kind:parts[1],group:attemptGroup(parts[1]),id:parts[2]};
}
export const validAttemptValue=(item,field)=>{const selected=attemptValueField(field);return !!selected&&item?.id===selected.id&&validAttemptFact(selected.kind,item,{draft:true});};

const validIdentityRoot=root=>root===null||!!root&&Object.keys(root).sort().join()==='count,first,hash,height,last'&&revisionId(root.hash)&&Number.isSafeInteger(root.count)&&root.count>0&&Number.isSafeInteger(root.height)&&root.height>0&&root.height<=64&&typeof root.first==='string'&&typeof root.last==='string'&&root.first.length>0&&root.first<=root.last;
export const validPreparationEdit=value=>!!value&&Object.keys(value).sort().join()==='commandId,identities,request'&&researchId(value.commandId)&&revisionId(value.request)&&value.identities&&Object.keys(value.identities).sort().join()==='root,source'&&revisionId(value.identities.source)&&validIdentityRoot(value.identities.root);
