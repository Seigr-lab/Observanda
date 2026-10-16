import {researchId} from './research-reference.js';
import {validWebsiteSelection} from './website-selection.js';

export const WEBSITE_DOCUMENT_FIELDS=['website','pages','branding','appearance','themes','activeThemeId'];
export function siteProjectIds(metadata,projectId){
 const ids=new Set([projectId]);
 for(let changed=true;changed;){changed=false;for(const p of metadata.projects)if(ids.has(p.parentId)&&!ids.has(p.id)){ids.add(p.id);changed=true;}}
 return ids;
}
export function validWebsites(sites,metadata){
 return Array.isArray(metadata?.projects)&&Array.isArray(sites)&&sites.length<=100&&new Set(sites.map(s=>s?.id)).size===sites.length&&sites.every(s=>
  s&&Object.keys(s).sort().join()===['id','name','projectId','document','projects','selection'].sort().join()&&researchId(s.id)&&
  typeof s.name==='string'&&s.name.trim().length>0&&s.name.length<=160&&!/[\x00-\x1f]/.test(s.name)&&metadata.projects.some(p=>p.id===s.projectId)&&
  s.document&&Object.keys(s.document).sort().join()===WEBSITE_DOCUMENT_FIELDS.slice().sort().join()&&
  Array.isArray(s.projects)&&new Set(s.projects.map(p=>p?.id)).size===s.projects.length&&s.projects.every(p=>p&&Object.keys(p).sort().join()==='id,logoId,share'&&siteProjectIds(metadata,s.projectId).has(p.id)&&typeof p.share==='boolean'&&(p.logoId===null||researchId(p.logoId)))&&
  validWebsiteSelection(s.selection)&&s.selection.defaultShare===false&&s.selection.includeProjects.every(id=>siteProjectIds(metadata,s.projectId).has(id)));
}
export function websiteDocument(book){return Object.fromEntries(WEBSITE_DOCUMENT_FIELDS.map(key=>[key,structuredClone(book[key])]));}
export function websiteBook(metadata,site){
 const {websites,...base}=metadata,ids=siteProjectIds(metadata,site.projectId);
 const projects=metadata.projects.filter(p=>ids.has(p.id)).map(p=>({...p,...site.projects.find(v=>v.id===p.id),share:site.projects.find(v=>v.id===p.id)?.share??false,...(p.id===site.projectId&&p.parentId?{parentId:null}:{})}));
 const notebooks=metadata.notebooks.filter(n=>ids.has(n.projectId)),notebookIds=new Set(notebooks.map(n=>n.id));
 return {...base,...structuredClone(site.document),projects,notebooks,entries:(metadata.entries??[]).filter(r=>notebookIds.has(r.notebookId))};
}
