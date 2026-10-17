import {validConfiguration} from './notebook-schema.js';
import {validFields,fieldChoiceValid} from './custom-fields.js';
export const configurationCollections=['profiles','sections','fields','choices'];
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
export const validConfigurationProfile=value=>exact(value,['id','version','enabled'])&&validConfiguration({profiles:[value],sections:[]});
export function validConfigurationSection(value,{draft=false}={}){
 if(!exact(value,['id','profileId','key','label','description','enabled'])||typeof value.label!=='string')return false;
 return validConfiguration({profiles:value.profileId===null?[]:[{id:value.profileId,version:1,enabled:true}],sections:[{...value,label:draft&&!value.label.trim()?'Draft':value.label,fields:[]}]});
}
export function validConfigurationField(value,{draft=false}={}){
 if(!exact(value,['key','label','type','unit','required',...(Object.hasOwn(value??{},'numeric')?['numeric']:[])])||typeof value.label!=='string')return false;
 return validFields([{...value,label:draft&&!value.label.trim()?'Draft':value.label,choices:value.type==='select'?['Draft']:[]}]);
}
export const validConfigurationChoice=(value,{draft=false}={})=>draft&&value===''||fieldChoiceValid(value);
