
import {profileById} from './catalog.js';
import {configurationOf} from '../notebook-schema.js';
import {notebooksIn,recordsIn} from '../workspace-structure.js';
export const notebookRoute=id=>({action:'filter-notebook',id});
export const notebookTypes=n=>configurationOf(n).profiles.filter(p=>p.enabled).map(p=>profileById(p.id)?.label??p.id);
export function notebookDirectory(book,projectId=null,options){
 return notebooksIn(book,projectId,options).map(n=>({id:n.id,title:n.title,kind:'notebook',projectIds:[n.projectId],types:notebookTypes(n),count:options?.counts?.[n.id]??(n.dedicated?null:book.entries.filter(e=>e.notebookId===n.id).length),route:notebookRoute(n.id)}));
}
export const generalProjectRecords=(book,projectId=null)=>recordsIn(book,projectId);
export function notebookRecordScope(book,{projectId=null,notebookId=null}={}){
 if(projectId&&!book.projects.some(p=>p.id===projectId))throw new Error('The selected location is unavailable.');
 const choices=notebooksIn(book,projectId,{recursive:true});
 if(notebookId&&!choices.some(n=>n.id===notebookId))throw new Error('The selected lab book has moved or is unavailable.');
 return {general:recordsIn(book,projectId).filter(e=>!notebookId||e.notebookId===notebookId)};
}
