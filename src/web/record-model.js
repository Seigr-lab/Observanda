import {workflowRole} from './record-workflow.js';
import {RECORD_TYPES} from './record-types.js';
import {locationName} from './workspace-structure.js';
import {upgradeFigure} from './figure-model.js';
// Shared record metadata contract, independent of routes, storage and accounts.
import {researchId,validTarget} from './research-reference.js';
export {researchId,validTarget,researchReference,parseResearchReference} from './research-reference.js';
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const text=value=>typeof value==='string'&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const unique=items=>new Set(items.map(item=>item?.id)).size===items.length;
export const RELATION_TYPES=['Related to','Builds on','Supports','Contradicts','Reproduces','Uses','Part of'];
export function validContributors(items,{draft=false}={}){
  return Array.isArray(items)&&unique(items)&&items.every(item=>keys(item,['id','name','role'])&&researchId(item.id)&&text(item.name)&&(draft||item.name.trim())&&text(item.role));
}
export function validRelations(items){
  return Array.isArray(items)&&unique(items)&&items.every(item=>keys(item,['id','type','target','label',...(Object.hasOwn(item??{},'role')?['role']:[])])&&(!Object.hasOwn(item,'role')||!!workflowRole(item.role))&&researchId(item.id)&&text(item.type)&&item.type.trim()&&text(item.label)&&validTarget(item.target));
}
export function upgradeRecord(source){
  return upgradeOwnedRecord(structuredClone(source));
}
// Only use for a newly decoded, exclusively owned value. Saved snapshots and
// caller-owned records still use upgradeRecord's independent copy.
export function upgradeOwnedRecord(record){
  if(Object.hasOwn(record,'author')){
    // An embedded contributor ID identifies this attribution, not an account.
    // The existing record UUID gives a deterministic migration on every read.
    record.contributors=record.author.trim()?[{id:record.id,name:record.author,role:'Author'}]:[];
    record.relations=[];
    delete record.author;
  }
  if(Object.hasOwn(record,'chart')){record.figures=record.chart?[upgradeFigure(record.chart,record.id)]:[];delete record.chart;}
  return record;
}
export function researchTargets(book){
  return [{kind:'workspace',id:book.id,title:book.title,context:'Workspace'},...book.projects.map(item=>({kind:'project',id:item.id,title:item.title,context:(item.kind??'Project')+' ? '+locationName(book,item.id)})),
    ...book.notebooks.map(item=>({kind:'notebook',id:item.id,title:item.title,context:'Lab book \u00b7 '+locationName(book,item.projectId)})),
    ...book.entries.map(item=>({kind:'record',id:item.id,title:item.title,context:'Record \u00b7 '+(book.notebooks.find(n=>n.id===item.notebookId)?.title??'')}))]
    .map(item=>({...item,workspaceId:book.id}));
}
export function targetRoute(target,book){
  if(target.workspaceId!==book.id||!researchTargets(book).some(item=>item.kind===target.kind&&item.id===target.id))return null;
  return {workspace:'#/workspace',project:'#/projects/'+target.id,notebook:'#/notebooks/'+target.id,record:'#/records/'+target.id}[target.kind];
}

// Saved template identity drives filters across record lists and dashboard sources.
export const matchesRecordType=(record,filter)=>filter==='all'||(record.template?'template:'+record.template.id:record.type)===filter;
export const recordTypeChoices=records=>[...RECORD_TYPES.map(t=>({value:t.id,label:t.label})),...[...new Map(records.filter(e=>e.template).map(e=>[e.template.id,e.template])).values()].map(t=>({value:'template:'+t.id,label:t.label}))];
