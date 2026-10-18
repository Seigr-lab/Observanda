import {researchId} from './research-reference.js';
import {validProse,proseText} from './prose-model.js';
const exact=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()==='block,content,id,kind';
export const validPdfNoteContent=value=>validProse(value)&&!!proseText(value).trim();
export function validPdfNote(value){
 return exact(value)&&researchId(value.id)&&validPdfNoteContent(value.content)&&['footnote','endnote'].includes(value.kind)&&Number.isInteger(value.block)&&value.block>=0&&value.block<=12000;
}
export const validPdfNotes=values=>Array.isArray(values)&&values.every(validPdfNote)&&new Set(values.map(value=>value.id)).size===values.length;
