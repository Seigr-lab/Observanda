
import {validFields,fieldValueErrors} from './custom-fields.js';
import {researchId} from './research-reference.js';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||!!v.trim())&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
const key=v=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,79}$/.test(v);
export const emptyConfiguration=()=>({profiles:[],sections:[]});
export const configurationOf=notebook=>notebook?.configuration??emptyConfiguration();
export function validConfiguration(c){
 return exact(c,['profiles','sections'])&&Array.isArray(c.profiles)&&c.profiles.every(p=>exact(p,['id','version','enabled'])&&key(p.id)&&Number.isSafeInteger(p.version)&&p.version>0&&typeof p.enabled==='boolean')&&new Set(c.profiles.map(p=>p.id)).size===c.profiles.length
 &&Array.isArray(c.sections)&&new Set(c.sections.map(s=>s?.id)).size===c.sections.length&&new Set(c.sections.map(s=>(s?.profileId??'')+':'+s?.key)).size===c.sections.length
 &&c.sections.every(s=>exact(s,['id','profileId','key','label','description','enabled','fields'])&&researchId(s.id)&&(s.profileId===null||c.profiles.some(p=>p.id===s.profileId))&&key(s.key)&&text(s.label,160,true)&&text(s.description,2000)&&typeof s.enabled==='boolean'&&validFields(s.fields));
}
export const templateFrom=section=>({id:section.id,profileId:section.profileId,label:section.label,description:section.description,fields:structuredClone(section.fields),values:{}});
export function validTemplate(t,options){
 return t===null||exact(t,['id','profileId','label','description','fields','values'])&&researchId(t.id)&&(t.profileId===null||key(t.profileId))&&text(t.label,160,true)&&text(t.description,2000)&&validFields(t.fields)&&!fieldValueErrors(t.fields,t.values,options).length;
}
