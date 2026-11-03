import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {calendarDate} from './web/record-date.js';
import {RECORD_TYPES,STATUSES} from './web/record-types.js';
import {researchId} from './web/research-reference.js';
import {fold} from './website-file-library-fields.js';

const invalid=()=>{throw new AppError('INVALID');};
export const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const optional=(value,check)=>{if(value==null||value==='')return null;if(!check(value))invalid();return value;};
const collators=new Map(['en','ca','es','nb','nn'].map(locale=>[locale,new Intl.Collator(locale,{numeric:true,sensitivity:'base'})]));
const compare=(a,b)=>a<b?-1:a>b?1:0;
export function libraryQuery({search='',filter='all',projectId=null,notebookId=null,searchField='all',dateFrom,dateTo,dateKnowledge='all',recordType,status,tags=[],tagMode='all',sort='default',locale='en'}={}){
 if(!collators.has(locale))invalid();
 if(typeof search!=='string'||search.length>160||!['all','media','text'].includes(filter)||!['all','title','exact-title','reference','tag','exact-tag'].includes(searchField)||!['all','known','unknown','estimated'].includes(dateKnowledge)||!Array.isArray(tags)||tags.some(tag=>typeof tag!=='string'||!tag.trim()||tag.length>40)||!['all','any'].includes(tagMode)||!['default','relevance','title-asc','title-desc','date-asc','date-desc'].includes(sort))invalid();
 if(sort==='relevance'&&!search.trim())sort='default';
 dateFrom=optional(dateFrom,calendarDate);dateTo=optional(dateTo,calendarDate);if(dateFrom&&dateTo&&dateFrom>dateTo)invalid();
 const literal=searchField==='exact-tag'?search.trim():searchField==='exact-title'?fold(search.trim()):'';
 return {terms:fold(search).trim().split(/\s+/u).filter(Boolean),literal,filter,projectId:optional(projectId,researchId),notebookId:optional(notebookId,researchId),searchField,dateFrom,dateTo,dateKnowledge,recordType:optional(recordType,v=>RECORD_TYPES.some(t=>t.id===v)),status:optional(status,v=>STATUSES.includes(v)),tags:[...new Set(tags)].sort(),tagMode,sort,locale};
}
export function matchesQuery(item,q){
 if(q.projectId&&q.projectId!==item.projectId||q.notebookId&&q.notebookId!==item.notebookId||q.filter!=='all'&&(q.filter==='media')!==item.media||q.dateKnowledge!=='all'&&q.dateKnowledge!==item.dateKnowledge||q.recordType&&q.recordType!==item.recordType||q.status&&q.status!==item.status)return false;
 if(q.dateFrom&&(!item.dateTo||item.dateTo<q.dateFrom)||q.dateTo&&(!item.dateFrom||item.dateFrom>q.dateTo))return false;
 const tags=item.tags??[];
 if(q.tags.length&&!(q.tagMode==='all'?q.tags.every(tag=>tags.includes(tag)):q.tags.some(tag=>tags.includes(tag))))return false;
 if(q.literal)return q.searchField==='exact-tag'?tags.includes(q.literal):fold(item.title.trim())===q.literal;
 if(!q.terms.length)return true;
 const refs=[item.id,item.recordId],fields=q.searchField==='title'?[item.title]:q.searchField==='reference'?refs:q.searchField==='tag'?tags:[item.title,...refs,item.notebookId,item.projectId,item.projectTitle,item.notebookTitle,item.recordType,item.status,item.displayDate,...tags];
 const haystack=fold(fields.filter(Boolean).join(' '));return q.terms.every(word=>haystack.includes(word));
}
export function compareLibraryRows(a,b,sort,locale='en'){
 let value=0;
 if(sort==='relevance')return a.rank-b.rank||collators.get(locale).compare(a.title,b.title)||compare(a.id,b.id);
 if(sort.startsWith('title'))value=collators.get(locale).compare(a.title,b.title);
 if(sort.startsWith('date')){
  if(!a.dateFrom||!b.dateFrom)return a.dateFrom?-1:b.dateFrom?1:compare(a.id,b.id);
  value=compare(a.dateFrom,b.dateFrom)||compare(a.dateTo,b.dateTo);
 }
 return (sort.endsWith('desc')?-value:value)||compare(a.id,b.id);
}
export function libraryMatchRank(item,q){
 const phrase=q.terms.join(' '),title=fold(item.title.trim()),scope=q.searchField;
 if((scope==='all'||scope==='reference')&&(item.id===phrase||item.recordId===phrase))return 0;
 if(['all','title','exact-title'].includes(scope)){
  if(title===phrase)return 1;
  if(title.startsWith(phrase))return 2;
  if(q.terms.every(term=>title.includes(term)))return 3;
 }
 if(['all','tag','exact-tag'].includes(scope)&&(item.tags??[]).some(tag=>fold(tag)===phrase))return 4;
 return 5;
}
export function libraryCursor(key,stamp,point){
 return Buffer.from(JSON.stringify([key,stamp.visibilityToken,point])).toString('base64url');
}
export function readLibraryCursor(value,key,stamp){
 if(value==null)return null;if(typeof value!=='string'||value.length>4096||!/^[\w-]+$/.test(value))invalid();
 let row;try{row=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{invalid();}
 if(!Array.isArray(row)||row.length!==3||typeof row[2]!=='object'||!row[2])invalid();
 if(row[0]!==key||row[1]!==stamp.visibilityToken)throw new AppError('WEBSITE_CHANGED');
 return row[2];
}
