import {parseFragment,serializeOuter} from 'parse5';
import {AppError} from './errors.js';
import {validRecordTag} from './web/record-tags-model.js';

// Replace only the identified source-owned list. Preserve the literal
// spelling of all other saved prose, styles, links and embedded content.
export function replaceSourceTags(html,tags){
 if(!Array.isArray(tags)||!tags.every(validRecordTag))throw new AppError('INVALID');
 const fragment=parseFragment(html,{sourceCodeLocationInfo:true}),marked=[];
 let article;
 function visit(node){
  const attr=name=>node.attrs?.find(a=>a.name===name)?.value;
  if(attr('data-observanda-part')==='tags')marked.push(node);
  if(node.tagName==='article'&&attr('class')?.split(/\s+/).includes('record-page'))article=node;
  for(const child of node.childNodes??[])visit(child);
 }
 visit(fragment);if(marked.length>1)throw new AppError('FORMAT');
 const list=tags.length?'<ul class="tags" aria-label="Tags" data-observanda-part="tags">'+tags.map(tag=>'<li>'+serializeOuter({nodeName:'#text',value:tag})+'</li>').join('')+'</ul>':'';
 const at=marked[0]?.sourceCodeLocation;
 if(at)return html.slice(0,at.startOffset)+list+html.slice(at.endOffset);
 const next=article?.childNodes.find(node=>node.attrs?.some(a=>a.name==='data-observanda-part'&&['attempt','results'].includes(a.value)));
 const end=next?.sourceCodeLocation?.startOffset??article?.sourceCodeLocation?.endTag?.startOffset??html.length;
 return html.slice(0,end)+list+html.slice(end);
}
