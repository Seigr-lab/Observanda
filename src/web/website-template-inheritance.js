import {MAX_ELEMENTS} from './composition-tree.js';

// A link pins the actual parent document, not a mutable template name. Current
// sections remain ordinary composition data; rendering never follows this link.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const elementId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export function validTemplateLink(link){
 return exact(link,['version','templateId','root','sectionIds'])&&link.version===1&&uuid(link.templateId)&&revision(link.root)&&Array.isArray(link.sectionIds)&&link.sectionIds.length<=MAX_ELEMENTS&&link.sectionIds.every(item=>exact(item,['templateId','pageId'])&&elementId(item.templateId)&&elementId(item.pageId))&&new Set(link.sectionIds.map(item=>item.templateId)).size===link.sectionIds.length&&new Set(link.sectionIds.map(item=>item.pageId)).size===link.sectionIds.length;
}
