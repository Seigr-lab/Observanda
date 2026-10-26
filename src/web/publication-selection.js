import {publicRecordSections,sourcePublicationRecord} from './source-publication-permissions.js';
import {researchId,validTarget,researchReference} from './research-reference.js';
import {revisionId} from './revision-model.js';

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();
const ids=(value,valid=researchId)=>Array.isArray(value)&&value.length<=1000&&value.every(valid)&&new Set(value).size===value.length;
export const EDITION_DETAILS=Object.freeze(['preparationInputs','attempt','relations','contributors','results']);
export const validRetainedEditionSelection=value=>exact(value,['version','id','revision','source'])&&value.version===2&&researchId(value.id)&&revisionId(value.revision)&&revisionId(value.source);
export const emptyEditionSelection=()=>({version:1,records:[]});
export const editionRevisionKey=r=>r.id+':'+r.revision;
export const editionAvailabilityKey=r=>r.recordId+':'+researchReference(r.target);
export function validEditionRecord(r){
 return exact(r,['id','revision','include','body','sections','fields','attachments','figures',...(r?.details===undefined?[]:['details'])])&&researchId(r.id)&&revisionId(r.revision)&&typeof r.include==='boolean'&&typeof r.body==='boolean'&&ids(r.sections)&&ids(r.fields,v=>typeof v==='string'&&v.length>0&&v.length<=100)&&ids(r.attachments)&&Array.isArray(r.figures)&&r.figures.length<=1000&&new Set(r.figures.map(f=>f?.id)).size===r.figures.length&&r.figures.every(f=>exact(f,['id','data'])&&researchId(f.id)&&typeof f.data==='boolean')&&(r.details===undefined||ids(r.details,key=>EDITION_DETAILS.includes(key)));
}
export function validEditionSelection(value){
 if(!exact(value,['version','records',...(value?.history!==undefined?['history']:[]),...(value?.availability!==undefined?['availability']:[])])||value.version!==1)return false;
 for(const [key,identity] of [['records',r=>r.id],['history',editionRevisionKey]]){const rows=value[key]??[];if(!Array.isArray(rows)||rows.length>10000||!rows.every(validEditionRecord)||new Set(rows.map(identity)).size!==rows.length)return false;}
 const notes=value.availability??[];
 return Array.isArray(value.records)&&Array.isArray(notes)&&notes.length<=10000&&notes.every(r=>exact(r,['recordId','target','statement'])&&researchId(r.recordId)&&validTarget(r.target)&&typeof r.statement==='string'&&r.statement.trim().length>0&&r.statement.length<=2000)&&new Set(notes.map(editionAvailabilityKey)).size===notes.length;
}
export function defaultEditionRecord(record,revision){
 return {id:record.id,revision,include:record.share===true,body:true,sections:publicRecordSections(record).map(s=>s.id),fields:(record.template?.fields??[]).map(f=>f.key),attachments:record.attachments.filter(a=>a.share).map(a=>a.id),figures:record.figures.map(f=>({id:f.id,data:false}))};
}
// Work on an edition derivative only. The original and its revision remain
// intact in encrypted storage. CSV/table consent is separate from chart consent.
export function selectEditionRecord(record,choice){
 const selected=structuredClone(sourcePublicationRecord(record));
 if(!choice)return selected;
 selected.share=record.share===true&&choice.include;
 selected.body=choice.body?selected.body:'';
 selected.sections=selected.sections.filter(s=>choice.sections.includes(s.id));
 selected.attachments=selected.attachments.filter(a=>choice.attachments.includes(a.id)).map(a=>({...a,share:true}));
 selected.figures=selected.figures.filter(f=>choice.figures.some(c=>c.id===f.id));
 const details=choice.details??EDITION_DETAILS;
 if(!details.includes('attempt'))delete selected.attempt;
 else if(selected.attempt&&!details.includes('preparationInputs'))for(const preparation of selected.attempt.preparations)preparation.inputs=[];
 if(!details.includes('relations'))selected.relations=[];
 if(!details.includes('contributors'))selected.contributors=[];
 if(!details.includes('results'))delete selected.results;
 if(selected.template){selected.template.fields=selected.template.fields.filter(f=>choice.fields.includes(f.key));selected.template.values=Object.fromEntries(selected.template.fields.map(f=>[f.key,selected.template.values[f.key]]));}
 return selected;
}
