import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {validBookSelector} from './book-selectors.js';
export function validProjectTarget(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const keys=['projectId','domain','kind','id',...(Object.hasOwn(value,'revision')?['revision']:[]),...(Object.hasOwn(value,'selector')?['selector']:[])];
 return Object.keys(value).sort().join()===keys.sort().join()&&researchId(value.projectId)&&value.domain==='research'&&['project','notebook','record'].includes(value.kind)&&researchId(value.id)&&(value.kind!=='project'||value.id===value.projectId)&&(!Object.hasOwn(value,'revision')||value.kind==='record'&&revisionId(value.revision))&&(!Object.hasOwn(value,'selector')||value.kind==='record'&&validBookSelector(value.selector));
}
