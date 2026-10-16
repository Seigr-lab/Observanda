import {projectUsesTool,projectToolScope} from '../project-tools.js';
import {descendants,locationName} from '../workspace-structure.js';
// Shared by server projections, dashboard providers and every scoped editor.
export function ownerOf(entity,entities){
 const get=id=>entities instanceof Map?entities.get(id):entities.find(e=>e.id===id);
 if(Object.hasOwn(entity.data,'projectId'))return entity.data.projectId;
 if(entity.data.calendarId)return ownerOf(get(entity.data.calendarId)??{data:{}},entities);
 if(entity.data.resourceId)return ownerOf(get(entity.data.resourceId)??{data:{}},entities);
 return null;
}
export function inScope(book,owner,scope=null,recursive=true){
 if(!scope)return true;
 return recursive?descendants(book,scope).has(owner):scope===owner;
}
export function scopedItems(book,entities,scope=null,recursive=true){
 if(!scope)return entities;
 const ids=recursive?descendants(book,scope):new Set([scope]),index=new Map(entities.map(e=>[e.id,e]));
 return entities.filter(e=>ids.has(ownerOf(e,index)));
}
export function toolItems(book,entities,moduleId){
 const index=new Map(entities.map(e=>[e.id,e]));
 return entities.filter(e=>projectUsesTool(book,ownerOf(e,index),moduleId));
}
export const ownerLabel=(book,id)=>id?(locationName(book,id)||'Removed location'):(book.title+' / Workspace');
export function scopePath(projectId,path=''){return 'scope/'+(projectId||'workspace')+'/'+path;}
export function parseScope(path=''){
 const parts=path.split('/');
 return parts[0]==='scope'?{projectId:parts[1]==='workspace'?null:parts[1],path:parts.slice(2).join('/')}:{projectId:null,path};
}
export function normalizeScopePath(path='',fallback=''){const parsed=parseScope(path);return scopePath(parsed.projectId,parsed.path||fallback);}
export function scopeControl(book,projectId,esc,{recursive=true,moduleId=null}={}){
 return `<div class="operations-scope"><label>Show location<select data-operation-scope><option value="">${esc(book.title)} / All locations</option>${book.projects.filter(p=>!moduleId||projectToolScope(book,p.id,moduleId)).map(p=>`<option value="${p.id}" ${p.id===projectId?'selected':''}>${esc(locationName(book,p.id))}</option>`).join('')}</select></label>${projectId?`<label class="checkbox"><input type="checkbox" data-operation-descendants ${recursive?'checked':''}>Include locations inside</label>`:''}</div>`;
}
