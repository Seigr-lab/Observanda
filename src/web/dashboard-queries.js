import {recentRecordOrder} from './query-order.js';
import {matchesRecordType} from './record-model.js';
import {dashboardScope,dashboardBooks} from './dashboard-scope.js';
// Stored selections never broaden after a move or a workspace switch.
export function queryPanel(book,panel){
 const c=panel.config;
 if(c.workspaceId&&c.workspaceId!==book.id)return {unavailable:'This panel belongs to another workspace.'};
 try{
  const ids=dashboardScope(book,panel.options,c),notebooks=dashboardBooks(book,panel.options,c),bookIds=new Set(notebooks.map(n=>n.id));
  const entries=book.entries.filter(e=>bookIds.has(e.notebookId)&&matchesRecordType(e,c.recordType)&&(c.status==='all'||e.status===c.status)&&(!c.tag||e.tags.includes(c.tag))).sort(recentRecordOrder);
  return {projects:book.projects.filter(p=>ids.has(p.id)),notebooks,entries,project:book.projects.find(p=>p.id===c.projectId),notebook:notebooks.find(n=>n.id===c.notebookId)};
 }catch(error){return {unavailable:error.message};}
}
export function matchesTool(tool,search){
 const words=search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 const haystack=[tool.name,tool.description,tool.category].join(' ').toLocaleLowerCase();return words.every(word=>haystack.includes(word));
}
