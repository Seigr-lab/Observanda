import {compareKey,compareTitles} from './query-order.js';
import {calendarDate,dateInRange,dateKnowledge,compareRecordDates} from './record-date.js';
import {matchesRecordType} from './record-model.js';
import {proseText,proseReferences} from './prose-model.js';
import {STATUSES} from './record-types.js';
import {BOOK_JOURNEYS,readingJourney} from './book-journeys.js';
import {researchCardSources} from './research-card-items.js';
import {attemptReferences,attemptSearchText} from './attempt-model.js';

const text=(value,max=512)=>typeof value==='string'?value.slice(0,max):'';
export function recordBrowse(value={}) {
 value=value&&typeof value==='object'?value:{};
 return {...(value.journey&&value.journey!=='all'?{journey:BOOK_JOURNEYS.includes(value.journey)?value.journey:'all'}:{}),dateKnowledge:['known','estimated','unknown'].includes(value.dateKnowledge)?value.dateKnowledge:'all',tags:text(value.tags),tagMode:value.tagMode==='any'?'any':'all',from:text(value.from,10),to:text(value.to,10),domain:text(value.domain,80)||'all',status:STATUSES.includes(value.status)?value.status:'all',sort:['date-asc','title'].includes(value.sort)?value.sort:'date-desc'};
}
export const browseTags=value=>[...new Set(value.tags.split(',').map(t=>t.trim().toLocaleLowerCase()).filter(Boolean))];
export const browseActive=value=>[value.journey&&value.journey!=='all',value.dateKnowledge!=='all',value.tags.trim(),value.from,value.to,value.domain!=='all',value.status!=='all',value.sort!=='date-desc'].filter(Boolean).length;
export function browseIssue(value) {
 if(value.dateKnowledge==='unknown'&&(value.from||value.to))return 'Clear the date range to show records with unknown dates.';
 if([value.from,value.to].some(s=>s&&!calendarDate(s)))return 'Choose valid record dates.';
 return value.from&&value.to&&value.from>value.to?'The start date must be on or before the end date.':'';
}
// Shared semantics for local previews and encrypted catalogue queries.
export const recordSearchText=e=>[e.title,proseText(e.body),e.outcome??'',...e.tags,...e.sections.flatMap(s=>[s.title,proseText(s.body)]),...e.contributors.flatMap(c=>[c.name,c.role]),e.template?.label??'',...Object.values(e.template?.values??{}),...(e.attempt?[attemptSearchText(e.attempt)]:[]),...(e.results?.statements??[]).flatMap(s=>[s.title,s.text,s.limitations])].join(' ').toLocaleLowerCase();
export function recordQueryMatcher({notebook='all',filter='all',search='',browse={},relatedTo=null,referenceNamespaces=null}={}) {
 const b=recordBrowse(browse),tags=browseTags(b),needle=search.trim().toLocaleLowerCase();
 return e=>{
  if(browseIssue(b))return false;
  if(b.journey&&b.journey!=='all'&&readingJourney(e)!==b.journey)return false;
  if(relatedTo&&!(e.referenceTargets??recordReferenceTargets(e)).some(t=>(referenceNamespaces??[relatedTo.workspaceId]).includes(t.workspaceId)&&t.id===relatedTo.id))return false;
  if(notebook!=='all'&&e.notebookId!==notebook||!matchesRecordType(e,filter))return false;
  if(b.domain!=='all'&&(e.template?.profileId??'general')!==b.domain||b.status!=='all'&&e.status!==b.status)return false;
  if(b.dateKnowledge!=='all'&&dateKnowledge(e.occurredOn)!==b.dateKnowledge||!dateInRange(e.occurredOn,b.from,b.to))return false;
  const recordTags=new Set(e.tags.map(t=>t.toLocaleLowerCase()));
  if(tags.length&&!(b.tagMode==='any'?tags.some(t=>recordTags.has(t)):tags.every(t=>recordTags.has(t))))return false;
  return !needle||(e.searchText??recordSearchText(e)).includes(needle);
 };
}
export function recordQueryOrder(browse={}){
 const b=recordBrowse(browse);
 return (a,c)=>(b.sort==='title'?compareTitles(a.title,c.title):compareRecordDates(a,c,{descending:b.sort==='date-desc'}))||compareKey(a.id,c.id);
}
export function queryRecords(records,query={}){
 return records.filter(recordQueryMatcher(query)).sort(recordQueryOrder(query.browse));
}
export function recordReferenceTargets(record){
 const mentions=[record.body,...(record.sections??[]).map(s=>s.body)].flatMap(proseReferences).map(target=>({type:'Mentioned in text',target}));
 const references=[...(record.relations??[]),...mentions,...attemptReferences(record.attempt).map(target=>({type:target.label,target}))].filter(l=>l.target.kind==='record').map(l=>({workspaceId:l.target.workspaceId,id:l.target.id,type:l.type,...(l.target.revision?{revision:l.target.revision}:{})}));
 return [...new Map(references.map(value=>[JSON.stringify(value),value])).values()];
}
// A derived search document, never an editable record or publication input.
export function recordQueryDocument(record){
 const {id,notebookId,type,title,occurredOn,status,outcome,share,tags,template}=record;
 return {id,notebookId,type,title,occurredOn,status,...(outcome!==undefined?{outcome}:{}),share,tags,
  ...(template?{template:{id:template.id,label:template.label,profileId:template.profileId}}:{}),referenceTargets:recordReferenceTargets(record),cardSources:researchCardSources(record),searchText:recordSearchText(record)};
}
