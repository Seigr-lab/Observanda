import {publicRecordSections,sourcePublicationRecord} from './source-publication-permissions.js';
import {researchId,validTarget,researchReference} from './research-reference.js';
import {revisionId} from './revision-model.js';

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();
const ids=(value,valid=researchId)=>Array.isArray(value)&&value.length<=1000&&value.every(valid)&&new Set(value).size===value.length;
export const EDITION_DETAILS=Object.freeze(['preparationInputs','attempt','relations','contributors','results']);
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
 record=sourcePublicationRecord(record);
 return {id:record.id,revision,include:record.share===true,body:true,sections:publicRecordSections(record).map(s=>s.id),fields:(record.template?.fields??[]).map(f=>f.key),attachments:record.attachments.filter(a=>a.share).map(a=>a.id),figures:record.figures.map(f=>({id:f.id,data:false}))};
}
