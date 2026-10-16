import {researchId} from './research-reference.js';

// A rendering window, never a ceiling on the selected book or project.
export const PUBLIC_COLLECTION_ROWS=24;
const kinds={project:'projects',notebook:'notebooks'};
export function collectionPagePath(target,page=0){
 const [kind,id,...extra]=String(target).split(':');
 if(!kinds[kind]||!researchId(id)||extra.length||!Number.isSafeInteger(page)||page<0)throw new TypeError('Invalid collection page');
 return kinds[kind]+'/'+id+(page?'-records-'+page:'')+'.html';
}
export function collectionPageFromPath(path){
 const match=/^(projects|notebooks)\/([a-f0-9-]{36})(?:-records-([1-9][0-9]*))?\.html$/.exec(path);
 if(!match||!researchId(match[2]))return null;
 const page=Number(match[3]??0);if(!Number.isSafeInteger(page))return null;
 return {target:(match[1]==='projects'?'project:':'notebook:')+match[2],page};
}
