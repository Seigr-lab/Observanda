import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {validBookSelector} from './book-selectors.js';
export function validProjectTarget(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const keys=['projectId','domain','kind','id',...(Object.hasOwn(value,'revision')?['revision']:[]),...(Object.hasOwn(value,'selector')?['selector']:[])];
 return Object.keys(value).sort().join()===keys.sort().join()&&researchId(value.projectId)&&value.domain==='research'&&['project','notebook','record'].includes(value.kind)&&researchId(value.id)&&(value.kind!=='project'||value.id===value.projectId)&&(!Object.hasOwn(value,'revision')||value.kind==='record'&&revisionId(value.revision))&&(!Object.hasOwn(value,'selector')||value.kind==='record'&&validBookSelector(value.selector));
}
export function projectReference(value){if(!validProjectTarget(value))throw new TypeError('Invalid project reference');return `observanda://project/${value.projectId}/research/${value.kind}/${value.id}${value.revision?'?revision='+value.revision:''}${value.selector?'#v1-'+value.selector.kind+'-'+value.selector.id:''}`;}
export function parseProjectReference(text){
 if(typeof text!=='string')return null;
 const match=/^observanda:\/\/project\/([a-f0-9-]+)\/research\/(project|notebook|record)\/([a-f0-9-]+)(?:\?revision=([a-f0-9]{64}))?(?:#v1-(section|figure|table|equation|citation|block)-([a-f0-9-]+))?$/.exec(text);
 if(!match)return null;const value={projectId:match[1],domain:'research',kind:match[2],id:match[3],...(match[4]?{revision:match[4]}:{}),...(match[5]?{selector:{version:1,kind:match[5],id:match[6]}}:{})};return validProjectTarget(value)?value:null;
}
