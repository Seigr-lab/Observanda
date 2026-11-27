// Agents write record text in a small, bounded Markdown: headings (#, ##, ###),
// paragraphs with line breaks, bulleted and numbered lists, quotes, fenced code,
// **bold**, *italic*, `code` and https links. It becomes the app's rich text
// document, the same grammar formatted-text.js renders. Raw HTML stays text.
import {validRichText,richTextPlain,safeRichLink} from './web/rich-text-model.js';
import {AppError} from './errors.js';

const INLINE=/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\(https:\/\/[^\s)]+\))/g;
function text(value,marks){return value?[{type:'text',text:value,...(marks?{marks}:{})}]:[];}
function inline(source){
 const nodes=[];let last=0;
 for(const match of source.matchAll(INLINE)){
  nodes.push(...text(source.slice(last,match.index)));const token=match[0];
  if(token.startsWith('`'))nodes.push(...text(token.slice(1,-1),[{type:'code'}]));
  else if(token.startsWith('**'))nodes.push(...text(token.slice(2,-2),[{type:'strong'}]));
  else if(token.startsWith('*'))nodes.push(...text(token.slice(1,-1),[{type:'em'}]));
  else{
   const [,label,href]=/^\[([^\]]+)\]\((.+)\)$/.exec(token);
   nodes.push(...(safeRichLink(href)?text(label,[{type:'link',attrs:{href,title:'',target:'_blank',nofollow:false}}]):text(token)));
  }
  last=match.index+token.length;
 }
 nodes.push(...text(source.slice(last)));return nodes;
}
const paragraph=lines=>({type:'paragraph',content:lines.flatMap((line,index)=>[...(index?[{type:'hard_break'}]:[]),...inline(line)])});

export function markdownRichText(source){
 if(typeof source!=='string')throw new AppError('INVALID');
 const blocks=[];let lines=[],list=null,code=null;
 const flush=()=>{if(lines.length){blocks.push(paragraph(lines));lines=[];}if(list){blocks.push(list);list=null;}};
 for(const line of source.replace(/\r\n?/g,'\n').split('\n')){
  if(line.startsWith('```')){
   if(code){blocks.push({type:'code_block',attrs:code.language?{language:code.language}:{},content:text(code.lines.join('\n'))});code=null;}
   else{flush();code={language:line.slice(3).trim().slice(0,120),lines:[]};}
   continue;
  }
  if(code){code.lines.push(line);continue;}
  if(!line.trim()){flush();continue;}
  const heading=/^(#{1,3}) (.+)$/.exec(line),item=/^([-*]|\d+\.) (.+)$/.exec(line),quote=/^> ?(.*)$/.exec(line);
  if(heading){flush();blocks.push({type:'heading',attrs:{level:Math.min(4,heading[1].length+1)},content:inline(heading[2])});}
  else if(item){
   const kind=/\d/.test(item[1])?'ordered_list':'bullet_list';
   if(lines.length){blocks.push(paragraph(lines));lines=[];}
   if(list?.type!==kind){if(list)blocks.push(list);list={type:kind,...(kind==='ordered_list'?{attrs:{order:1}}:{}),content:[]};}
   list.content.push({type:'list_item',content:[paragraph([item[2]])]});
  }
  else if(quote){flush();blocks.push({type:'blockquote',content:[paragraph([quote[1]])]});}
  else{if(list){blocks.push(list);list=null;}lines.push(line);}
 }
 if(code)blocks.push({type:'code_block',attrs:code.language?{language:code.language}:{},content:text(code.lines.join('\n'))});
 flush();
 const doc={type:'doc',content:blocks.length?blocks:[{type:'paragraph',content:[]}]};
 if(!validRichText(doc))throw new AppError('INVALID',[{field:'text'}]);
 return doc;
}
// Agents read record text back in the same Markdown they write, so what they wrote, and
// the formatting written in the app, can be checked and sent back unchanged.
function markedText(node){
 let value=node.text??'';
 for(const mark of node.marks??[]){
  if(mark.type==='code')value='`'+value+'`';
  else if(mark.type==='strong')value='**'+value+'**';
  else if(mark.type==='em')value='*'+value+'*';
  else if(mark.type==='link'&&safeRichLink(mark.attrs?.href))value='['+value+']('+mark.attrs.href+')';
 }
 return value;
}
const inlineMarkdown=(nodes,breaks='\n')=>(nodes??[]).map(node=>node.type==='text'?markedText(node):node.type==='hard_break'?breaks:richTextPlain(node)).join('');
// Parts the Markdown cannot express (figures, tables, equations...) are named in place; a
// section or summary sent back unchanged keeps them, since it is then left exactly as stored.
function blockMarkdown(block){
 if(block.type==='paragraph')return inlineMarkdown(block.content);
 if(block.type==='heading')return '#'.repeat(Math.min(3,Math.max(1,(block.attrs?.level??2)-1)))+' '+inlineMarkdown(block.content,' ');
 if(block.type==='bullet_list'||block.type==='ordered_list')return (block.content??[]).map((item,index)=>(block.type==='ordered_list'?(index+1)+'. ':'- ')+(item.content??[]).map(part=>part.type==='paragraph'?inlineMarkdown(part.content,' '):richTextPlain(part)).join(' ')).join('\n');
 if(block.type==='blockquote')return (block.content??[]).map(part=>'> '+(part.type==='paragraph'?inlineMarkdown(part.content,' '):richTextPlain(part))).join('\n');
 if(block.type==='code_block')return '```'+(block.attrs?.language??'')+'\n'+(block.content??[]).map(node=>node.text??'').join('')+'\n```';
 return '['+block.type.replace(/_/g,' ')+': '+richTextPlain(block).replace(/\s+/g,' ').trim().slice(0,200)+']';
}
export function richTextMarkdown(doc){
 if(typeof doc==='string')return doc;
 return (doc?.content??[]).map(blockMarkdown).join('\n\n');
}
export const richTextForAgents=richTextMarkdown;
// A text sent back as it was read keeps the stored document exactly; a changed text is
// read as Markdown.
export const agentRichText=(source,stored)=>stored!==undefined&&source===richTextMarkdown(stored)?stored:markdownRichText(source);
