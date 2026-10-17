// A configuration reference is meaningful only at its authenticated snapshot slot.
import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
export const isConfigurationReference=value=>value?.format==='observanda-configuration';
export const validConfigurationOwner=value=>exact(value,['workspaceId','projectId','notebookId','slot'])&&researchId(value.workspaceId)&&researchId(value.projectId)&&(['configuration','labBookTemplate'].includes(value.slot))&&(value.slot==='configuration'?researchId(value.notebookId):value.notebookId===null);
const table=v=>v===null||exact(v,['count','first','hash','height','last'])&&revisionId(v.hash)&&Number.isSafeInteger(v.count)&&v.count>0&&Number.isSafeInteger(v.height)&&v.height>0&&v.height<=64&&typeof v.first==='string'&&!!v.first&&typeof v.last==='string'&&v.first<=v.last;
export function validConfigurationReference(value,owner){
 return exact(value,['format','version','owner','root','index'])&&isConfigurationReference(value)&&value.version===1&&validConfigurationOwner(value.owner)&&revisionId(value.root)&&exact(value.index,['version','source','root'])&&value.index.version===1&&value.index.source===value.root&&table(value.index.root)&&(!owner||validConfigurationOwner(owner)&&Object.keys(owner).every(key=>owner[key]===value.owner[key]));
}
