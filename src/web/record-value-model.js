import {revisionId} from './revision-model.js';
import {validRecordDate} from './record-date.js';
import {STATUSES,RECORD_TYPES} from './record-types.js';
import {researchId,validContributors} from './record-model.js';
import {validRelationValue} from './record-relation-value.js';
import {validMediaDetails} from './record-media-value.js';
import {figureIssues} from './figure-model.js';
import {attemptValueField,validAttemptValue} from './record-attempt-value.js';
import {resultValueId} from './record-result-value.js';
import {validResultStatement} from './result-statements.js';
import {validFigureCopies} from './record-figure-copy-model.js';
export const recordValueFields=['title','type','status','outcome','occurredOn','share'];
export const contributorValueId=field=>typeof field==='string'&&field.startsWith('contributor:')&&researchId(field.slice(12))?field.slice(12):null;
export const relationValueId=field=>typeof field==='string'&&field.startsWith('relation:')&&researchId(field.slice(9))?field.slice(9):null;
export const mediaValueId=field=>typeof field==='string'&&field.startsWith('media:')&&researchId(field.slice(6))?field.slice(6):null;
export const figureValueId=field=>typeof field==='string'&&field.startsWith('figure:')&&researchId(field.slice(7))?field.slice(7):null;
export const recordValueCollection=field=>contributorValueId(field)?{id:contributorValueId(field),name:'contributors',kind:'contributor'}:relationValueId(field)?{id:relationValueId(field),name:'relations',kind:'relation'}:mediaValueId(field)?{id:mediaValueId(field),name:'attachments',kind:'media'}:figureValueId(field)?{id:figureValueId(field),name:'figures',kind:'figure'}:null;
export const validRecordValueField=field=>recordValueFields.includes(field)||!!recordValueCollection(field)||!!attemptValueField(field)||!!resultValueId(field)||typeof field==='string'&&/^template:[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(field)&&!['__proto__','constructor','prototype'].includes(field.slice(9));
export const validRecordValueBase=value=>value&&Object.keys(value).sort().join()==='field,revision,storageRevision'&&validRecordValueField(value.field)&&revisionId(value.revision)&&revisionId(value.storageRevision);
// Draft admission preserves incomplete values. Final saves additionally run the
// record's domain rules, including its immutable template and completion policy.
export function validRecordValue(value,field){
 if(!value||Object.keys(value).sort().join()!==(value.copies?'copies,value':'value')||value.copies&&(!figureValueId(field)||!validFigureCopies(value.copies,value.value)))return false;
 const item=value.value;
 if(attemptValueField(field))return validAttemptValue(item,field);
 if(resultValueId(field))return item===null||item?.id===resultValueId(field)&&validResultStatement(item,{draft:true});
 const contributor=contributorValueId(field);
 if(figureValueId(field))return item?.id===figureValueId(field)&&figureIssues(item,{draft:true}).length===0;
 if(mediaValueId(field))return validMediaDetails(item);
 if(relationValueId(field))return item===null||validRelationValue(item);
 if(contributor)return item===null||item&&Object.keys(item).sort().join()==='name,role'&&validContributors([{id:contributor,...item}],{draft:true});
 if(field==='title')return typeof item==='string'&&item.length<=180;
 if(field==='type')return RECORD_TYPES.some(type=>type.id===item);
 if(field==='status')return STATUSES.includes(item);
 if(field==='outcome')return item===null||typeof item==='string'&&item.length<=500;
 if(field==='occurredOn')return validRecordDate(item,{draft:true});
 if(field==='share')return typeof item==='boolean';
 return validRecordValueField(field)&&(item===null||typeof item==='boolean'||typeof item==='string');
}
