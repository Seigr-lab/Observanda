import {createHash} from 'node:crypto';
import {validRichText,safeRichLink} from '../web/rich-text-model.js';
import {AppError} from '../errors.js';
import {bookText} from '../web/book-messages.js';
// Convert explicitly selected HTML to inert book nodes. Unsupported structures
// are exact source blocks, never flattened, evaluated or fetched.
export function importBookHTML(root,source,file){
 const pending=[{node:root,depth:0}];while(pending.length){const {node,depth}=pending.pop();if(depth>48)throw new AppError('IMPORT_CONTENT');for(const child of node.childNodes??[])pending.push({node:child,depth:depth+1});}
 const mappings=[],omitted=[];let ordinal=0;
 const value=(n,key)=>n.attrs?.find(a=>a.name===key)?.value??'';
 const literal=n=>n.nodeName==='#text'?n.value:(n.childNodes??[]).map(literal).join('');
 const id=n=>{const h=createHash('sha256').update(file.sha256+':'+(value(n,'id')||n.sourceCodeLocation?.startOffset||ordinal++)).digest('hex').slice(0,32).split('');h[12]='4';h[16]='8';return h.slice(0,8).join('')+'-'+h.slice(8,12).join('')+'-'+h.slice(12,16).join('')+'-'+h.slice(16,20).join('')+'-'+h.slice(20).join('');};
 function map(n,identity,kind){const l=n.sourceCodeLocation;if(l)mappings.push({id:identity,kind,offset:(file.selector.kind==='bytes'?file.selector.offset:0)+Buffer.byteLength(source.slice(0,l.startOffset)),length:Buffer.byteLength(source.slice(l.startOffset,l.endOffset))});}
 function preserve(n){const l=n.sourceCodeLocation;if(!l)throw new AppError('IMPORT_CONTENT');const identity=id(n);map(n,identity,'preserved');omitted.push({element:'preserved-'+n.tagName,count:1});return {type:'book_preserved',attrs:{version:1,id:identity,format:'HTML '+n.tagName,source:source.slice(l.startOffset,l.endOffset),reason:bookText('preservedHTML')}};}
 const inline=(n,marks=[])=>{if(n.nodeName==='#text')return n.value?[{type:'text',text:n.value,...(marks.length?{marks}: {})}]:[];if(n.tagName==='br')return [{type:'hard_break'}];const type={b:'strong',strong:'strong',em:'em',i:'em',u:'underline',s:'strike',code:'code',sub:'subscript',sup:'superscript'}[n.tagName],href=value(n,'href');const mark=type?{type}:n.tagName==='a'&&safeRichLink(href)?{type:'link',attrs:{href,title:value(n,'title').slice(0,200),target:'_self',nofollow:false}}:null;return (n.childNodes??[]).flatMap(c=>inline(c,mark&&!marks.some(m=>m.type===mark.type)?[...marks,mark]:marks));};
 const supportedInline=n=>n.nodeName==='#text'||['br','span','b','strong','em','i','u','s','code','sub','sup','a'].includes(n.tagName)&&(n.tagName!=='a'||safeRichLink(value(n,'href')))&&(n.childNodes??[]).every(supportedInline)&&!(n.attrs??[]).some(a=>a.name==='hidden'||a.name==='style'||a.name.startsWith('on'));
 function blocks(n){
  if(n.nodeName==='#text')return n.value.trim()?[{type:'paragraph',content:[{type:'text',text:n.value}]}]:[];
  if(n.nodeName==='#comment'||n.nodeName==='#documentType')return [];
  if(['#document','html','body'].includes(n.nodeName)||['section','article','div','main'].includes(n.tagName)&&!(n.attrs??[]).some(a=>a.name==='hidden'||a.name==='style'||a.name.startsWith('on')))return (n.childNodes??[]).flatMap(blocks);
  if(n.tagName==='head')return [];
  if((n.attrs??[]).some(a=>a.name==='hidden'||a.name==='style'||a.name.startsWith('on')))return [preserve(n)];
  if(n.tagName==='pre'){if(!(n.childNodes??[]).every(c=>c.nodeName==='#text'||c.tagName==='code'&&(c.childNodes??[]).every(t=>t.nodeName==='#text')&&!(c.attrs??[]).some(a=>!['class','data-language'].includes(a.name))))return [preserve(n)];const identity=id(n),language=value(n,'data-language')||value(n.childNodes?.find(c=>c.tagName==='code')??{},'class').replace(/^language-/,'');if(language.length>120)return [preserve(n)];map(n,identity,'code');return [{type:'code_block',attrs:{language},content:literal(n)?[{type:'text',text:literal(n)}]:[]}];}
  if(n.tagName==='table'){
   const simple=x=>x.nodeName==='#text'||['table','thead','tbody','tfoot','tr','th','td','caption'].includes(x.tagName)&&!(x.attrs??[]).some(a=>!['id','scope','aria-label'].includes(a.name))&&(x.childNodes??[]).every(simple);
   if(!simple(n)||(n.childNodes??[]).some(c=>c.tagName==='caption'&&(c.childNodes??[]).some(t=>t.nodeName!=='#text')))return [preserve(n)];
   const rows=[],visit=x=>{if(x.tagName==='tr')rows.push(x);else for(const c of x.childNodes??[])visit(c);};visit(n);const matrix=rows.map(r=>r.childNodes.filter(c=>['th','td'].includes(c.tagName)));
   if(matrix.length<2||matrix[0].some(c=>c.tagName!=='th')||matrix.some(r=>r.length!==matrix[0].length||r.some(c=>(c.attrs??[]).some(a=>!['scope','id'].includes(a.name))||!(c.childNodes??[]).every(t=>t.nodeName==='#text'))))return [preserve(n)];
   const identity=id(n),title=literal(n.childNodes.find(c=>c.tagName==='caption')??{})||value(n,'aria-label')||bookText('importedTable');const node={type:'book_table',attrs:{version:1,id:identity,title,headers:matrix[0].map(literal),rows:matrix.slice(1).map(r=>r.map(literal))}};if(!validRichText({type:'doc',content:[node]}))return [preserve(n)];map(n,identity,'table');return [node];
  }
  if(['ul','ol'].includes(n.tagName)){const children=(n.childNodes??[]).filter(c=>c.tagName==='li');if(!children.length)return [];return [{type:n.tagName==='ul'?'bullet_list':'ordered_list',...(n.tagName==='ol'?{attrs:{order:Number(value(n,'start'))||1}}:{}),content:children.map(li=>{const content=(li.childNodes??[]).every(supportedInline)?[{type:'paragraph',content:li.childNodes.flatMap(c=>inline(c))}]:li.childNodes.flatMap(blocks);return {type:'list_item',content:content[0]?.type==='paragraph'?content:[{type:'paragraph'},...content]};})}];}
  if(n.tagName==='blockquote')return [{type:'blockquote',content:(n.childNodes??[]).flatMap(blocks)}];
  if(n.tagName==='hr')return [{type:'horizontal_rule'}];
  if(['p','h1','h2','h3','h4','h5','h6'].includes(n.tagName)&&(n.childNodes??[]).every(supportedInline)&&!(n.attrs??[]).some(a=>a.name==='hidden'||a.name==='style'||a.name.startsWith('on'))){const heading=n.tagName!=='p',identity=id(n);if(heading)map(n,identity,'section');return [{type:heading?'heading':'paragraph',...(heading?{attrs:{level:Math.min(4,Math.max(2,Number(n.tagName[1]))),id:identity}}:{}),content:(n.childNodes??[]).flatMap(c=>inline(c))}];}
  return [preserve(n)];
 }
 const content=blocks(root),body={type:'doc',content:content.length?content:[{type:'paragraph'}]};if(!validRichText(body))throw new AppError('IMPORT_CONTENT');return {body,conversion:'html-book-v1',omitted,mappings};
}
