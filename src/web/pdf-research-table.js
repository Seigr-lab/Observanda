import {researchId} from './research-reference.js';
import {validProse,proseDocument} from './prose-model.js';

// These operations work only on the existing bounded, authenticated prose value.
// A table is selected by its authored identity, never its caption or position.
function visitTables(node,consume){
 if(node.type==='book_table')consume(node);
 for(const child of node.content??[])visitTables(child,consume);
}
export function selectPdfResearchTable(content,blockId){
 if(!researchId(blockId)||!validProse(content))return null;
 let selected=null,count=0;
 visitTables(proseDocument(content),node=>{if(node.attrs.id===blockId){selected=node;count++;}});
 return count===1?{type:'doc',content:[structuredClone(selected)]}:null;
}
export function pdfResearchTableChoices(content,{offset=0,limit=20}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>20||!validProse(content))throw new TypeError('Invalid PDF research table window');
 const items=[];let total=0;
 visitTables(proseDocument(content),node=>{const position=total++;if(position>=offset&&items.length<limit)items.push({id:node.attrs.id,title:node.attrs.title});});
 return {items,total,offset,next:offset+items.length<total?offset+items.length:null};
}
export function validPdfResearchTableContent(content,blockId){
 return researchId(blockId)&&validProse(content)&&content?.type==='doc'&&Object.keys(content).sort().join()==='content,type'&&content.content.length===1&&content.content[0].type==='book_table'&&content.content[0].attrs.id===blockId;
}
