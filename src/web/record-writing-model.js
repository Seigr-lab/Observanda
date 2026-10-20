import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {validProse} from './prose-model.js';
export const validWritingBase=value=>value&&Object.keys(value).sort().join()==='revision,sectionId,storageRevision'&&(value.sectionId===null||researchId(value.sectionId))&&revisionId(value.revision)&&revisionId(value.storageRevision);
export const writingSectionValue=section=>({title:section.title,body:section.body,...(Object.hasOwn(section,'share')?{share:section.share}:{})});
export const validWritingValue=(value,sectionId)=>value&&Object.keys(value).sort().join()===(sectionId===null?'body':Object.hasOwn(value,'share')?'body,share,title':'body,title')&&validProse(value.body)&&(sectionId===null||typeof value.title==='string'&&value.title.length<=160&&(!Object.hasOwn(value,'share')||typeof value.share==='boolean'));
