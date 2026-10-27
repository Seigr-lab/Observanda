import {richTextStyles} from './rich-text-model.js';

const applied=new WeakMap();
// Readers can supply a selected record projection. Only its already loaded
// writing fields contribute styles; this never requests additional content.
function documents(value){
 if(value?.type==='doc')return [value];
 return [value?.body,...(value?.sections??[]).map(section=>section.body),...Object.values(value?.template?.values??{})].filter(value=>value?.type==='doc');
}
export function applyRichTextStyles(doc,value){
 const sheet=doc.querySelector('link[data-document-styles]')?.sheet;if(!sheet)return;
 let retained=applied.get(sheet);if(!retained){retained=new Set();applied.set(sheet,retained);}
 for(const rule of richTextStyles(documents(value)).css.split('\n').filter(Boolean))if(!retained.has(rule)){sheet.insertRule(rule,sheet.cssRules.length);retained.add(rule);}
}
