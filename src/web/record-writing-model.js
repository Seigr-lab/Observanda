import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {validProse} from './prose-model.js';
export const validWritingBase=value=>value&&Object.keys(value).sort().join()==='revision,sectionId,storageRevision'&&(value.sectionId===null||researchId(value.sectionId))&&revisionId(value.revision)&&revisionId(value.storageRevision);
export const validWritingValue=(value,sectionId)=>value&&Object.keys(value).sort().join()===(sectionId===null?'body':'body,title')&&validProse(value.body)&&(sectionId===null||typeof value.title==='string'&&value.title.length<=160);
