import {richTextAdmission,RICH_TEXT_LIMITS} from './rich-text-model.js';

// Preserve block order and inline attributes. A scientific object or nested
// block that cannot fit on its own stays with the original source.
export function splitWritingSections(blocks,maxCharacters=RICH_TEXT_LIMITS.characters){
 const document=content=>({type:'doc',content});
 const sections=[];
 let current=[],characters=0,nodes=1;
 function append(block,usage){
  if(!usage.valid)return false;
  if(current.length&&(characters+usage.characters>maxCharacters||nodes+usage.nodes-1>RICH_TEXT_LIMITS.nodes)){
   sections.push(document(current));current=[];characters=0;nodes=1;
  }
  current.push(block);characters+=usage.characters;nodes+=usage.nodes-1;return true;
 }
 for(const block of blocks){
  const measure=part=>richTextAdmission(document([part]),{maxCharacters});
  const usage=measure(block);
  if(append(block,usage))continue;
  if(!['characters','nodes'].includes(usage.issue.dimension)||!['paragraph','code_block'].includes(block.type))return null;
  let content=[],units=0;
  function flush(){
   if(!content.length)return true;
   const part={...block,content};content=[];units=0;return append(part,measure(part));
  }
  for(const inline of block.content){
   if(inline.type!=='text'){
    if(content.length===RICH_TEXT_LIMITS.nodes-2&&!flush())return null;
    content.push(inline);continue;
   }
   const text=inline.text;
   for(let start=0;start<text.length;){
    if((units===maxCharacters||content.length===RICH_TEXT_LIMITS.nodes-2)&&!flush())return null;
    let end=Math.min(text.length,start+maxCharacters-units);
    if(end<text.length&&/[\uD800-\uDBFF]/u.test(text[end-1])&&/[\uDC00-\uDFFF]/u.test(text[end]))end--;
    if(end===start){if(!content.length||!flush())return null;continue;}
    content.push({...inline,text:text.slice(start,end)});units+=end-start;start=end;
   }
  }
  if(!flush())return null;
 }
 if(current.length)sections.push(document(current));
 return sections.length?sections:null;
}
