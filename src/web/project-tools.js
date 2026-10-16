import {descendants} from './workspace-structure.js';

// Availability and adoption are separate choices. Missing selections never
// imply activation, including older workspaces and newly created children.
export const validToolId=id=>typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id);
export const validProjectTools=value=>Array.isArray(value)&&value.length<=64&&value.every(validToolId)&&new Set(value).size===value.length;
export const projectUsesTool=(book,projectId,moduleId)=>!projectId||Boolean(book.projects.find(p=>p.id===projectId)?.tools?.includes(moduleId));
export function projectToolScope(book,projectId,moduleId){
 if(!projectId)return 'overview';
 if(projectUsesTool(book,projectId,moduleId))return 'own';
 const ids=descendants(book,projectId);
 return book.projects.some(p=>ids.has(p.id)&&p.tools?.includes(moduleId))?'overview':null;
}
export function selectToolProjects(book,moduleId,projectIds){
 if(!validToolId(moduleId)||!Array.isArray(projectIds)||new Set(projectIds).size!==projectIds.length||projectIds.some(id=>!book.projects.some(p=>p.id===id)))throw new TypeError('Invalid project tool selection');
 const selected=new Set(projectIds);
 for(const project of book.projects){
  const tools=(project.tools??[]).filter(id=>id!==moduleId);
  if(selected.has(project.id))tools.push(moduleId);
  if(!validProjectTools(tools))throw new TypeError('Invalid project tools');
  project.tools=tools;
 }
}
