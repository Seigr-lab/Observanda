import {dashboardCollection} from './dashboard-collection-client.js';
import {dashboardScopeChoices} from './dashboard-scope-choices.js';
import {t} from './i18n/index.js';
import {descendants,locationName} from './workspace-structure.js';

// One inclusion contract for dashboard providers. IDs select data, never tools or ownership.
export function dashboardSelection(options={},legacy={}){
 const projectId=options.projectId??legacy.projectId;
 return {scopeMode:options.scopeMode??(projectId?'selected':'all'),projectIds:options.projectIds??(projectId?[projectId]:[]),includeWorkspace:options.includeWorkspace??!projectId,includeDescendants:options.includeDescendants??true};
}
export function dashboardScope(book,options={},legacy={}){
 const selection=dashboardSelection(options,legacy),ids=new Set();
 if(selection.includeWorkspace)ids.add(null);
 if(selection.scopeMode==='all')book.projects.forEach(p=>ids.add(p.id));
 else for(const id of selection.projectIds){
  if(!book.projects.some(p=>p.id===id))throw new Error('A selected project is unavailable. Update Data from in this card’s settings.');
  for(const child of selection.includeDescendants?descendants(book,id):[id])ids.add(child);
 }
 return ids;
}
export function dashboardScopeSettings(c,options={},panel={}){
 const selection=dashboardSelection(options,panel.config);
 return [
  {key:'scopeMode',label:'Data from',type:'select',default:selection.scopeMode,choices:[{value:'all',label:'All projects'},{value:'selected',label:'Choose projects'}]},
  ...(selection.scopeMode==='selected'?[dashboardCollection(c)?dashboardScopeChoices('projects',{label:t('dashboardChoices','projects'),searchLabel:t('dashboardChoices','searchProjects'),selected:selection.projectIds}):{key:'projectIds',label:'Projects to include',type:'multi',default:selection.projectIds,choices:c.book.projects.map(p=>({value:p.id,label:locationName(c.book,p.id)}))},{key:'includeDescendants',label:'Include subprojects',type:'checkbox',default:selection.includeDescendants}]:[]),
  {key:'includeWorkspace',label:'Include workspace-level data',type:'checkbox',default:selection.includeWorkspace,help:c.book.title+' — data held outside projects.'}
 ];
}
export function dashboardScopeLabel(book,options={},legacy={},labels={}){
 const s=dashboardSelection(options,legacy),names=s.scopeMode==='all'?['All projects']:s.projectIds.map(id=>labels[id]||locationName(book,id)||'Unavailable project');
 if(s.scopeMode==='selected'&&s.includeDescendants&&names.length)names.push('including subprojects');
 if(s.includeWorkspace)names.push(book.title+' / workspace-level data');
 return names.join(' · ')||'No projects or workspace data selected';
}
export function dashboardBooks(book,options={},legacy={}){
 const ids=dashboardScope(book,options,legacy),old=options.notebookId??legacy.notebookId;
 const mode=options.notebookMode??(old?'selected':'all'),selected=options.notebookIds??(old?[old]:[]);
 const available=book.notebooks.filter(n=>ids.has(n.projectId??null));
 if(mode==='selected'&&selected.some(id=>!available.some(n=>n.id===id)))throw new Error('A selected lab book has moved or is unavailable. Update the card’s selection.');
 return mode==='selected'?available.filter(n=>selected.includes(n.id)):available;
}
export function dashboardBookSettings(c,options={},panel={}){
 const old=options.notebookId??panel.config?.notebookId,mode=options.notebookMode??(old?'selected':'all');
 let ids;try{ids=dashboardScope(c.book,options,panel.config);}catch{ids=new Set();}
 return [{key:'notebookMode',label:'Lab books',type:'select',default:mode,choices:[{value:'all',label:'All included lab books'},{value:'selected',label:'Choose lab books'}]},
 ...(mode==='selected'?[dashboardCollection(c)?dashboardScopeChoices('notebooks',{label:t('dashboardChoices','books'),searchLabel:t('dashboardChoices','searchBooks'),selected:options.notebookIds??(old?[old]:[])}):{key:'notebookIds',label:'Lab books to include',type:'multi',default:options.notebookIds??(old?[old]:[]),choices:c.book.notebooks.filter(n=>ids.has(n.projectId??null)).map(n=>({value:n.id,label:n.title+' / '+(locationName(c.book,n.projectId)||c.book.title)}))}]:[])];
}
