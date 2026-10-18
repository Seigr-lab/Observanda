import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {validProse,proseDocument,proseText} from './prose-model.js';
import {validFigure} from './figure-model.js';
import {validPdfResearchTableContent} from './pdf-research-table.js';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.split(',').sort().join();
export const validPdfFigures=values=>Array.isArray(values)&&values.length<=64&&new Set(values.map(v=>v?.id)).size===values.length&&values.every(value=>validFigure(value));
export function validPdfResearch(value){
 return exact(value,'version,workspaceId,snapshotId,recordId,recordRevision,collection,itemId,title,content,figures'+(Object.hasOwn(value??{},'blockId')?',blockId':''))&&value.version===1&&[value.workspaceId,value.recordId,value.itemId].every(researchId)&&[value.snapshotId,value.recordRevision].every(revisionId)&&['body','sections','figures'].includes(value.collection)&&typeof value.title==='string'&&value.title.length<=240&&validProse(value.content)&&validPdfFigures(value.figures)&&(!Object.hasOwn(value,'blockId')||value.collection!=='figures'&&value.figures.length===0&&validPdfResearchTableContent(value.content,value.blockId));
}
export function pdfReferencedFigures(content){const ids=new Set();function visit(node){if(node.type==='book_figure')ids.add(node.attrs.figureId);for(const child of node.content??[])visit(child);}visit(proseDocument(content));return [...ids];}
export function pdfResearchChanges(section,next){
 const before=section.research;
 if(!validPdfResearch(before)||!validPdfResearch(next))throw new TypeError('Invalid PDF research selection');
 return {sourceChanged:JSON.stringify([before.title,before.content,before.figures])!==JSON.stringify([next.title,next.content,next.figures]),locallyEdited:JSON.stringify([section.title,section.content,section.figures??[]])!==JSON.stringify([before.title,before.content,before.figures]),before:proseText(before.content),after:proseText(next.content),figuresChanged:JSON.stringify(before.figures)!==JSON.stringify(next.figures)};
}
