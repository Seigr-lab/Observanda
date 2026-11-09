import {researchId} from './research-reference.js';
import {validProse,proseText,proseDocument} from './prose-model.js';
const prefix='#pdf-note-v1:';
export const pdfNoteCall=id=>{if(!researchId(id))throw new TypeError('Invalid note');return prefix+id;};
export const pdfNoteHref=node=>node?.marks?.find(mark=>mark.type==='link'&&mark.attrs.href.startsWith(prefix))?.attrs.href;
export function pdfNoteLocations(content){
 const locations=new Map();let ordinal=0;
 function visit(node,block){
  const href=pdfNoteHref(node);
  if(href){const id=href.slice(prefix.length),previous=locations.get(id);locations.set(id,{block,ordinal:ordinal++,ambiguous:!!previous||node.type!=='text'||node.text!=='†'});}
  for(const child of node.content??[])visit(child,block);
 }
 for(const [block,node] of (proseDocument(content).content??[]).entries())visit(node,block);
 return locations;
}
export const validPdfNoteContent=value=>validProse(value)&&!!proseText(value).trim();
export function validPdfNote(value){
 if(!value||typeof value!=='object'||!researchId(value.id)||!validPdfNoteContent(value.content)||!['footnote','page-footnote','endnote'].includes(value.kind))return false;
 const keys=Object.keys(value).sort().join();return keys==='anchor,content,id,kind'?value.anchor==='inline':keys==='block,content,id,kind'&&Number.isInteger(value.block)&&value.block>=0&&value.block<=12000;
}
export const validPdfNotes=values=>Array.isArray(values)&&values.every(validPdfNote)&&new Set(values.map(value=>value.id)).size===values.length;
