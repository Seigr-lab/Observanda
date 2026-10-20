import {proseText} from './prose-model.js';
import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {validRecordDate} from './record-date.js';
import {STATUSES} from './record-types.js';
import {attemptComparison,CONDITION_BASES,ASSESSMENT_OUTCOMES,EVENT_KINDS,EVENT_EXTENTS,EVENT_CONTEXTS} from './attempt-model.js';
export const RUN_PAGE_SIZE=10;
export const RUN_DETAIL_PAGE_SIZE=4;
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const text=value=>typeof value==='string';
export const validRunDetailWindows=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>['conditions','methods','events','assessments'].includes(key)&&natural(value[key]));
export function validRunConditions(value){
 const preparationNumber=n=>Number.isSafeInteger(n)&&n>=1;
 const attempt=v=>v===null||v&&((v.preparationId===null&&v.preparationNumber===0)||(researchId(v.preparationId)&&preparationNumber(v.preparationNumber)))&&text(v.applicability)&&Array.isArray(v.conditions)&&v.conditions.every(c=>researchId(c.id)&&text(c.name)&&text(c.value)&&text(c.unit)&&CONDITION_BASES.includes(c.basis))&&Array.isArray(v.assessments)&&v.assessments.every(a=>researchId(a.preparationId)&&preparationNumber(a.preparationNumber)&&['criterion','expected','comparator','observed','denominator','domainOutcome'].every(key=>text(a[key]))&&['prospective','exploratory'].includes(a.scope)&&ASSESSMENT_OUTCOMES.includes(a.outcome))&&Array.isArray(v.events)&&v.events.every(e=>EVENT_KINDS.includes(e.kind)&&EVENT_EXTENTS.includes(e.extent)&&EVENT_CONTEXTS.includes(e.context)&&text(e.label));
 if(!value||!['parameters','changes','deviations'].every(key=>text(value[key]))||!Array.isArray(value.methods)||!value.methods.every(method=>text(method.label)&&revisionId(method.revision))||!attempt(value.attempt)||!value.windows||Object.keys(value.windows).sort().join()!=='assessments,conditions,events,methods')return false;
 return Object.entries(value.windows).every(([name,page])=>{
  const items=name==='methods'?value.methods:value.attempt?.[name]??[];
  return page&&Object.keys(page).sort().join()==='count,offset,total'&&[page.offset,page.total,page.count].every(natural)&&page.count===items.length&&page.count<=RUN_DETAIL_PAGE_SIZE&&page.offset+page.count<=page.total&&(page.total===0?page.offset===0:page.count>0);
 });
}
export const validRunComparisonPage=(page,command)=>page&&['workspaceId','recordId','runId','snapshotId'].every(key=>page[key]===command[key])&&validRunConditions(page.conditions)&&Object.entries(page.conditions.windows).every(([name,window])=>window.offset===Math.min(command.windows[name]??0,Math.max(0,window.total-1)));
export function runConditions(record){
 const body=title=>proseText(record.sections.find(section=>section.title===title)?.body??'');
 return {parameters:body('Parameters and conditions'),changes:body('Purpose and planned changes'),deviations:body('Observed deviations'),
  methods:record.relations.filter(link=>link.role==='uses-method').map(link=>({label:link.label,revision:link.target.revision})),attempt:attemptComparison(record.attempt)};
}
export function validRunPage(page,{workspaceId,recordId,compare}){
 const cursor=value=>value===null||typeof value==='string'&&value.length>0&&value.length<=4096;
 return page?.workspaceId===workspaceId&&page.recordId===recordId&&revisionId(page.snapshotId)&&page.compare===compare&&typeof page.changed==='boolean'&&
  Number.isSafeInteger(page.total)&&page.total>=0&&Number.isSafeInteger(page.offset)&&page.offset>=0&&Array.isArray(page.runs)&&page.runs.length<=RUN_PAGE_SIZE&&
  page.offset+page.runs.length<=page.total&&(page.total===0?page.offset===0:page.runs.length>0)&&new Set(page.runs.map(run=>run.id)).size===page.runs.length&&
  page.runs.every(run=>researchId(run.id)&&revisionId(run.revision)&&text(run.title)&&validRecordDate(run.occurredOn)&&STATUSES.includes(run.status)&&text(run.outcome)&&(compare?validRunConditions(run.conditions):run.conditions===undefined))&&
  typeof page.cursor==='string'&&cursor(page.cursor)&&cursor(page.previousCursor)&&cursor(page.nextCursor)&&Boolean(page.previousCursor)===(page.offset>0)&&Boolean(page.nextCursor)===(page.offset+page.runs.length<page.total);
}
