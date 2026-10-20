import {validRecordDate} from './web/record-date.js';
import {validAttempt} from './web/attempt-model.js';
import {validResultStatement} from './web/result-statements.js';
import {validTemplate} from './web/notebook-schema.js';
import {validProse} from './web/prose-model.js';
import {validFigure} from './web/figure-model.js';
import {validContributors,validRelations} from './web/record-model.js';
import {researchId} from './web/research-reference.js';

const text=value=>typeof value==='string';
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const required=['id','notebookId','type','title','body','tags','occurredOn','createdAt','updatedAt','share','status','sections','attachments'];
const optional=['attempt','results','outcome','template'];
const fields={
 id:researchId,notebookId:researchId,type:text,title:text,body:validProse,createdAt:text,updatedAt:text,status:text,author:text,
 occurredOn:value=>validRecordDate(value,{draft:true}),share:value=>typeof value==='boolean',attempt:value=>validAttempt(value,{draft:true}),results:value=>keys(value,['version','statements'])&&value.version===1&&Array.isArray(value.statements)&&new Set(value.statements.map(s=>s?.id)).size===value.statements.length&&value.statements.every(s=>validResultStatement(s,{draft:true})),
 outcome:value=>text(value)&&value.length<=500,template:value=>validTemplate(value,{draft:true}),
 chart:value=>value===null||keys(value,['title','kind','xLabel','yLabel','points'])&&['title','kind','xLabel','yLabel'].every(key=>text(value[key]))&&Array.isArray(value.points)&&value.points.every(p=>keys(p,['label','value'])&&text(p.label)&&(p.value===null||Number.isFinite(p.value)))
};
const collections={
 tags:text,
 sections:value=>keys(value,['id','title','body',...(Object.hasOwn(value??{},'share')?['share']:[])])&&(!Object.hasOwn(value,'share')||typeof value.share==='boolean')&&researchId(value.id)&&text(value.title)&&validProse(value.body),
 attachments:value=>keys(value,['id','kind','caption','alt','transcript','share'])&&researchId(value.id)&&['image','audio','video'].includes(value.kind)&&['caption','alt','transcript'].every(key=>text(value[key]))&&typeof value.share==='boolean',
 figures:value=>validFigure(value,{draft:true}),
 contributors:value=>validContributors([value],{draft:true}),relations:value=>validRelations([value])
};
export const draftRecordCollection=name=>Object.hasOwn(collections,name);
export const draftRecordField=name=>Object.hasOwn(fields,name)||draftRecordCollection(name);

// Direct requests and streamed checkpoints use the same domain contracts.
// Keep only the selected field/item and the contributor/relationship identities
// needed by their uniqueness contracts, never a growing collection of bodies.
// Drafts may contain unfinished fields; research commits validate them again.
export class DraftRecordValidation{
 constructor(){this.names=new Set();this.identities=new Map();this.recordId=null;this.notebookId=null;this.title='';}
 array(name){
  if(!draftRecordCollection(name)||this.names.has(name))return false;
  this.names.add(name);if(['contributors','relations'].includes(name))this.identities.set(name,new Set());return true;
 }
 item(name,value){
  if(!this.names.has(name)||!draftRecordCollection(name)||!collections[name](value))return false;
  const ids=this.identities.get(name);if(ids){if(ids.has(value.id))return false;ids.add(value.id);}return true;
 }
 field(name,value){
  if(draftRecordCollection(name))return Array.isArray(value)&&this.array(name)&&value.every(item=>this.item(name,item));
  if(this.names.has(name)||!Object.hasOwn(fields,name)||!fields[name](value))return false;
  this.names.add(name);if(name==='id')this.recordId=value;if(name==='notebookId')this.notebookId=value;if(name==='title')this.title=value.slice(0,160);return true;
 }
 valid(){
  const expected=[...required,...optional.filter(name=>this.names.has(name)),...(this.names.has('author')?['author']:['contributors','relations']),this.names.has('figures')?'figures':'chart'];
  return this.names.size===expected.length&&expected.every(name=>this.names.has(name));
 }
}
export function validDraftRecord(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const validation=new DraftRecordValidation();return Object.entries(value).every(([name,item])=>validation.field(name,item))&&validation.valid();
}
