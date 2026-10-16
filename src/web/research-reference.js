import {revisionId} from './revision-model.js';
import {validBookSelector} from './book-selectors.js';
export const researchKindLabel=kind=>kind==='notebook'?'lab book':kind;
export const researchId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
export function validTarget(target){
  return keys(target,['workspaceId','kind','id',...(target?.revision?['revision']:[]),...(target?.selector?['selector']:[])])&&(!Object.hasOwn(target,'selector')||target.kind==='record'&&validBookSelector(target.selector))&&(!Object.hasOwn(target,'revision')||target.kind==='record'&&revisionId(target.revision))&&researchId(target.workspaceId)&&researchId(target.id)&&['workspace','project','notebook','record'].includes(target.kind)&&(target.kind!=='workspace'||target.workspaceId===target.id);
}
export const researchReference=target=>`observanda://${target.workspaceId}/${target.kind}/${target.id}${target.revision?'?revision='+target.revision:''}${target.selector?'#v1-'+target.selector.kind+'-'+target.selector.id:''}`;
export function parseResearchReference(value){
  if(typeof value!=='string')return null;
 const match=/^observanda:\/\/([a-f0-9-]+)\/(workspace|project|notebook|record)\/([a-f0-9-]+)(?:\?revision=([a-f0-9]{64}))?(?:#v1-(section|figure|table|equation|citation|block)-([a-f0-9-]+))?$/.exec(value.trim());
  if(!match)return null;const target={workspaceId:match[1],kind:match[2],id:match[3],...(match[4]?{revision:match[4]}:{}),...(match[5]?{selector:{version:1,kind:match[5],id:match[6]}}:{})};return validTarget(target)?target:null;
}
