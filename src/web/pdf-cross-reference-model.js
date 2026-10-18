import {researchId} from './research-reference.js';
import {proseDocument,validProse} from './prose-model.js';
export const PDF_CROSS_REFERENCE_PREFIX='#pdf-reference-v1:';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys;
export function validPdfCrossReference(value){
 return !!(exact(value,'blockId,documentId,kind,sectionId')&&researchId(value.documentId)&&researchId(value.sectionId)&&['section','figure','table'].includes(value.kind)&&(value.kind==='section'?value.blockId===null:researchId(value.blockId)));
}
export function pdfCrossReference(target){
 if(!validPdfCrossReference(target))throw new TypeError('Invalid PDF reference');
 return PDF_CROSS_REFERENCE_PREFIX+[target.documentId,target.sectionId,target.kind,...(target.blockId?[target.blockId]:[])].join(':');
}
export function parsePdfCrossReference(value){
 if(typeof value!=='string'||!value.startsWith(PDF_CROSS_REFERENCE_PREFIX))return null;
 const parts=value.slice(PDF_CROSS_REFERENCE_PREFIX.length).split(':');if(parts.length!==3&&parts.length!==4)return null;
 const target={documentId:parts[0],sectionId:parts[1],kind:parts[2],blockId:parts[3]??null};
 return validPdfCrossReference(target)&&pdfCrossReference(target)===value?target:null;
}
// The chosen section is already bounded by its ordinary prose/image contract.
// Identity is the placement/block ID, never a figure's moving source position.
export function pdfCrossReferenceTargets(section,{documentId}={}){
 if(!researchId(documentId)||!researchId(section?.id))throw new TypeError('Invalid PDF reference');
 const rows=[],counts=new Map(),figures=new Map((section.figures??[]).map(value=>[value.id,value.title]));
 function add(kind,blockId,label){const target={documentId,sectionId:section.id,kind,blockId},key=pdfCrossReference(target);counts.set(key,(counts.get(key)??0)+1);rows.push({target,label:String(label??'')});}
 add('section',null,section.title);
 function visit(node){
  const kind={book_table:'table',book_sketch:'figure',book_figure:'figure'}[node.type];
  if(kind)add(kind,node.attrs.id,node.type==='book_figure'?figures.get(node.attrs.figureId)??node.attrs.alternative:node.attrs.title);
  for(const child of node.content??[])visit(child);
 }
 visit(proseDocument(section.content));for(const image of section.images??[])add('figure',image.id,image.caption||image.alt);
 return rows.map(row=>({...row,ambiguous:counts.get(pdfCrossReference(row.target))!==1}));
}
export function appendPdfCrossReference(content,target,label){
 if(typeof label!=='string'||!label.trim()||label.length>2000)throw new TypeError('Invalid PDF reference');
 const result=structuredClone(proseDocument(content));result.content.push({type:'paragraph',content:[{type:'text',text:label,marks:[{type:'link',attrs:{href:pdfCrossReference(target),title:'',target:'_self',nofollow:false}}]}]});
 if(!validProse(result))throw new RangeError('PDF reference exceeds the section limit');return result;
}
