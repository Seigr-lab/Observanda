import {researchId} from './research-reference.js';
export const dashboardSourceKey=(workspaceId,key)=>workspaceId+'/'+key;
export function dashboardSourceIdentity(value){
 if(value===null)return {workspaceId:null,key:null};if(typeof value!=='string'||value.length>512)return null;
 const parts=value.split('/');if(parts.length>2||parts.length===2&&!researchId(parts[0]))return null;
 const key=parts.at(-1);if(!key.split(':').every(researchId))return null;
 return {workspaceId:parts.length===2?parts[0]:null,key};
}
