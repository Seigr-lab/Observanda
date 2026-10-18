import {proseDocument,proseText} from './prose-model.js';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.split(',').sort().join();
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=12000;
const lineCount=value=>Number.isInteger(value)&&value>=1&&value<=10;
const prose=new Set(['paragraph','heading','blockquote','bullet_list','ordered_list','code_block']);
export function validPdfPaginationRule(value){return exact(value,'block,keepWithNext,keepTogether,widows,orphans')&&count(value.block)&&typeof value.keepWithNext==='boolean'&&typeof value.keepTogether==='boolean'&&lineCount(value.widows)&&lineCount(value.orphans);}
// Count mismatch is retained during ordinary authoring. Export requires the
// author to adjust the positional intentions to the current block sequence.
export function validPdfPagination(value){
 if(!exact(value,'version,blockCount,rules')||value.version!==1||!count(value.blockCount)||!Array.isArray(value.rules)||value.rules.length>value.blockCount)return false;
 const seen=new Set();for(const rule of value.rules){if(!validPdfPaginationRule(rule)||rule.block>=value.blockCount||seen.has(rule.block))return false;seen.add(rule.block);}return true;
}
export function pdfPaginationItems(section){return (proseDocument(section.content).content??[]).flatMap((node,block)=>prose.has(node.type)?[{block,type:node.type,label:proseText({type:'doc',content:[node]}).slice(0,160)}]:[]);}
export function pdfPaginationRuleDefaults(section,block){const node=(proseDocument(section.content).content??[])[block];return node&&prose.has(node.type)?{block,keepWithNext:node.type==='heading',keepTogether:false,widows:3,orphans:3}:null;}
export function pdfPaginationDefaults(section){return {version:1,blockCount:(proseDocument(section.content).content??[]).length,rules:[]};}
export function pdfPaginationStatus(section){
 const items=pdfPaginationItems(section),value=section.pagination,compatible=!section.composition,blockCount=(proseDocument(section.content).content??[]).length;
 const eligible=new Set(items.map(item=>item.block)),stale=!!value&&(!validPdfPagination(value)||value.blockCount!==blockCount||value.rules.some(rule=>!eligible.has(rule.block)));
 return {compatible,stale,ready:!compatible||!stale,blockCount,items};
}
export function pdfAdjustPagination(section){const next=pdfPaginationDefaults(section),valid=new Set(pdfPaginationItems(section).map(item=>item.block));next.rules=(section.pagination?.rules??[]).filter(rule=>validPdfPaginationRule(rule)&&valid.has(rule.block)).map(rule=>({...rule}));return next;}
export function pdfSetPaginationRule(section,block,patch){
 const status=pdfPaginationStatus(section),defaults=pdfPaginationRuleDefaults(section,block);if(!status.compatible||status.stale||!defaults||!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!['keepWithNext','keepTogether','widows','orphans'].includes(key)))return null;
 const value=section.pagination??pdfPaginationDefaults(section),rule={...(value.rules.find(row=>row.block===block)??defaults),...patch};if(!validPdfPaginationRule(rule))return null;
 const rules=value.rules.filter(row=>row.block!==block);if(Object.keys(defaults).some(key=>defaults[key]!==rule[key]))rules.push(rule);rules.sort((a,b)=>a.block-b.block);return {...value,rules};
}
export function pdfRemovePaginationRule(section,block){if(!section.pagination)return null;return {...section.pagination,rules:section.pagination.rules.filter(rule=>rule.block!==block)};}
