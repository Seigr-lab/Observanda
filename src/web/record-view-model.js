import {t} from './i18n/index.js';
import {recordBrowse,browseIssue} from './record-query.js';
import {researchId} from './research-reference.js';
import {RECORD_TYPES} from './record-types.js';
import {locationName} from './workspace-structure.js';
const message=(key,args)=>t('recordViews',key,args);

export const viewKeys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(k=>Object.hasOwn(value,k));
const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
export function viewQuery(state){
 return {projectId:state.notebook&&state.notebook!=='all'?null:state.project??null,notebookId:state.notebook&&state.notebook!=='all'?state.notebook:null,filter:state.filter??'all',search:state.search??'',browse:recordBrowse(state.recordBrowse)};
}
export const validViewFilter=value=>value==='all'||RECORD_TYPES.some(t=>t.id===value)||typeof value==='string'&&value.startsWith('template:')&&researchId(value.slice(9));
export function validViewQuery(q){
 if(!viewKeys(q,['projectId','notebookId','filter','search','browse'])||![q.projectId,q.notebookId].every(v=>v===null||researchId(v))||q.projectId&&q.notebookId||!text(q.search,512))return false;
 if(!validViewFilter(q.filter))return false;
 const normalized=recordBrowse(q.browse);
 return viewKeys(q.browse,Object.keys(normalized))&&Object.entries(normalized).every(([key,value])=>value===q.browse[key])&&!browseIssue(q.browse);
}
export function validRecordView(v){
 return viewKeys(v,['id','name','query'])&&researchId(v.id)&&text(v.name,120)&&!!v.name.trim()&&v.name===v.name.trim()&&validViewQuery(v.query);
}
export function viewScopeIssue(book,q){
 if(q.notebookId&&!book.notebooks.some(n=>n.id===q.notebookId))return message('missingNotebook');
 if(q.projectId&&!book.projects.some(p=>p.id===q.projectId))return message('missingProject');
 return '';
}
export function viewScopeLabel(book,q){
 const notebook=book.notebooks.find(n=>n.id===q.notebookId);
 return q.notebookId?(notebook?locationName(book,notebook.projectId)+' / '+notebook.title:message('unavailableNotebook')):q.projectId?(book.projects.some(p=>p.id===q.projectId)?message('projectScope',{name:locationName(book,q.projectId)}):message('unavailableProject')):message('allRecords');
}
