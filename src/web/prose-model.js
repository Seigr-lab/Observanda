
import {validRichText,plainRichText,richTextPlain,renderRichText} from './rich-text-model.js';
import {parseResearchReference} from './research-reference.js';

// Strings are legacy plain prose, never HTML or implicit Markdown. A rich
// document is the only persisted source once edited; plain text is a projection.
export const proseText=value=>typeof value==='string'?value:value?richTextPlain(value):'';
export const proseDocument=value=>typeof value==='string'?plainRichText(value):value??plainRichText();
export const validProse=(value,{maxCharacters=60000}={})=>typeof value==='string'?value.length<=maxCharacters&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value):validRichText(value,{maxCharacters});
export const renderProse=(value,options)=>renderRichText(proseDocument(value),options);
export function proseReferences(value){
 const found=new Map();
 function visit(node){for(const mark of node.marks??[]){if(mark.type!=='link')continue;const target=parseResearchReference(mark.attrs.href);if(target)found.set(mark.attrs.href,target);}for(const child of node.content??[])visit(child);}
 if(value&&typeof value==='object')visit(value);
 return [...found.values()];
}
export function projectProse(value,resolve){
 if(typeof value==='string')return value;
 const doc=structuredClone(value);
 function visit(node){
  node.marks=(node.marks??[]).flatMap(mark=>{
   if(mark.type!=='link')return [mark];
   const href=resolve(mark.attrs.href);
   if(href)return [{...mark,attrs:{...mark.attrs,href}}];
   if(parseResearchReference(mark.attrs.href))node.text='Private research reference';return [];
  });
  if(!node.marks.length)delete node.marks;
  for(const child of node.content??[])visit(child);
 }
 visit(doc);return doc;
}
