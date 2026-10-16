import {researchId} from '../research-reference.js';
// A saved source identifies its catalogue as well as its local item. Bare IDs
// continue to refer only to the catalogue that owns the saved timeline.
export function timelineSource(value,workspaceId){
 if(researchId(value))return {workspaceId,id:value};
 if(typeof value!=='string')return null;
 const parts=value.split('/');return parts.length===2&&parts.every(researchId)?{workspaceId:parts[0],id:parts[1]}:null;
}
export const validTimelineSource=value=>!!timelineSource(value,null);
export const timelineSourceKey=(workspaceId,id,origin)=>workspaceId===origin?id:workspaceId+'/'+id;
