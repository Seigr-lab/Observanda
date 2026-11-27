import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {validProse} from './prose-model.js';
import {validRecordDraftBase} from './record-value-model.js';
// Writing is read from a saved version or from a new record's draft at one edit, as values are.
export const validWritingBase=value=>Boolean(value)&&typeof value==='object'&&(value.sectionId===null||researchId(value.sectionId))&&revisionId(value.revision)&&(Object.keys(value).sort().join()==='revision,sectionId,storageRevision'&&revisionId(value.storageRevision)||Object.keys(value).sort().join()==='recordDraft,revision,sectionId'&&validRecordDraftBase(value.recordDraft));
export const writingSectionValue=section=>({title:section.title,body:section.body,...Object.fromEntries(['share','sharePdf'].filter(key=>Object.hasOwn(section,key)).map(key=>[key,section[key]]))});
export const validWritingValue=(value,sectionId)=>value&&Object.keys(value).filter(key=>sectionId===null||!['share','sharePdf'].includes(key)).sort().join()===(sectionId===null?'body':'body,title')&&validProse(value.body)&&(sectionId===null||typeof value.title==='string'&&value.title.length<=160&&['share','sharePdf'].every(key=>!Object.hasOwn(value,key)||typeof value[key]==='boolean'));
