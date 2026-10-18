import {revisionText,revisionId} from './revision-model.js';
import {sha256} from './vendor/sha256.js';
import {proseDocument} from './prose-model.js';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys;
export const validPdfAudience=value=>value==='private'||value==='public';
export const validPdfPublication=value=>!!(exact(value,'include,review,version')&&value.version===1&&typeof value.include==='boolean'&&(value.review===null||value.include&&revisionId(value.review)));
export function pdfAudience(header){
 const value=Object.hasOwn(header,'audience')?header.audience:'private';
 if(!validPdfAudience(value))throw new TypeError('Invalid PDF audience');return value;
}
// Review is tied to this selected authored value, including retained assets and
// notes. Document text, typography and font pins also affect what is published.
// Audience/selection controls are excluded so the approval cannot approve itself.
export function pdfSectionReviewFingerprint(header,section){
 const {audience,...document}=header,{publication,...content}=section;void audience;void publication;
 const bytes=sha256(new TextEncoder().encode(revisionText({version:1,header:document,section:content})));
 return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
}
export function pdfSectionPublicationState(header,section){
 const audience=pdfAudience(header),publication=section.publication;
 if(Object.hasOwn(section,'publication')&&!validPdfPublication(publication))throw new TypeError('Invalid PDF publication selection');
 const choice=publication?(publication.include?'include':'omit'):'unselected';
 const review=choice==='omit'?'omitted':!publication?.review?'pending':publication.review===pdfSectionReviewFingerprint(header,section)?'reviewed':'changed';
 return {choice,review,included:choice!=='omit'&&(audience==='private'||choice==='include'),allowed:audience==='private'||choice==='omit'||review==='reviewed'};
}
export function pdfSectionContentSummary(section){
 return {blocks:proseDocument(section.content).content?.length??0,images:section.images?.length??0,notes:section.notes?.length??0,figures:section.figures?.length??0};
}
export function changePdfAudience(header,value){
 if(!validPdfAudience(value))return false;header.audience=value;return true;
}
export function changePdfPublication(header,section,command){
 if(!section||!['audience-include','audience-omit','audience-review'].includes(command))return false;
 section.publication={version:1,include:command!=='audience-omit',review:command==='audience-review'?pdfSectionReviewFingerprint(header,section):null};return true;
}
