import {researchId} from './research-reference.js';

// Website layouts may retain destinations in independently owned sources,
// including temporarily deselected or unavailable sources. A presentation
// reference never grants content access: rendering resolves it against the
// authenticated, explicitly selected owners.
export function publicationPresentationTarget(website,target,{records=true}={}){
 if(!Array.isArray(website?.researchSources)||typeof target!=='string')return false;
 const [kind,id,...rest]=target.split(':');
 return rest.length===0&&(kind==='project'||kind==='notebook'||records&&kind==='entry')&&researchId(id);
}
