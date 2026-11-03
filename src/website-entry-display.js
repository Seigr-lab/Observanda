import path from 'node:path';
import {parseFragment,serializeOuter} from 'parse5';
import {AppError} from './errors.js';
import {attr,descendants} from './website-migration-views.js';
import {researchId} from './web/research-reference.js';

export const displayId='data-observanda-display-id',displayMode='data-observanda-display';
const part=node=>attr(node,'data-observanda-part');
const fields=new Set(['body','outcome','results','contributors','attempt','tags']);
const paras=new Set('p div article section ul ol li dl dt dd blockquote pre br'.split(' '));
const skipText=new Set('figure figcaption img video audio source track svg math table button nav'.split(' '));
const concealed=node=>['script','style','template','noscript'].includes(node.tagName)||node.attrs?.some(a=>a.name==='hidden'||a.name==='aria-hidden'&&a.value==='true'||a.name==='data-observanda-link'||a.name==='data-observanda-source');
const sectionKey=key=>typeof key==='string'&&key.startsWith('section:')&&researchId(key.slice(8));
const escaped=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sourceAsset=/^(?:\.\.\/)*(assets\/[a-f0-9]{64}\.[a-z0-9]{1,12})$/;
export const sourceFragmentAtPage=(html,page)=>page.includes('/')?html.replace(/(\b(?:src|href|poster)\s*=\s*["'])(assets\/[a-f0-9]{64}\.[a-z0-9]+)/gi,(_,prefix,name)=>prefix+path.posix.relative(path.posix.dirname(page),name)):html;

function textOf(root,{paragraph=false,skipHeadings=false}={}){
 let line='',first='';
 function boundary(){if(paragraph&&!first&&line.trim())first=line.trim();line='';}
 function visit(node){
  if(first||concealed(node)||node!==root&&part(node)!==undefined||skipText.has(node.tagName)||skipHeadings&&/^h[1-6]$/.test(node.tagName))return;
  const block=paragraph&&paras.has(node.tagName);if(block)boundary();
  if(node.nodeName==='#text')line+=node.value;
  else for(const child of node.childNodes??[])visit(child);
  if(block)boundary();
 }
 visit(root);return (first||line).replace(/\s+/gu,' ').trim();
}
export function entryDisplayChoices(html){
 const entries=new Map();
 function titleOf(node){
  if(concealed(node))return '';
  if(/^h[1-6]$/.test(node.tagName))return textOf(node);
  for(const child of node.childNodes??[]){if(part(child)!==undefined)continue;const title=titleOf(child);if(title)return title;}
  return '';
 }
 function walk(node){
  if(concealed(node))return;
  const key=part(node);
  if((sectionKey(key)||fields.has(key))&&!entries.has(key)){
   const section=sectionKey(key),title=section?titleOf(node):'',text=textOf(node,{paragraph:true,skipHeadings:true});
   if(section||text)entries.set(key,{key,kind:section?'section':'field',title,text,node});
  }
  for(const child of node.childNodes??[])walk(child);
 }
 walk(parseFragment(html));return entries;
}
export function displayPlacement(node){
 const id=attr(node,displayId),presentation=attr(node,displayMode);if(id===undefined&&presentation===undefined)return null;
 if(node.tagName!=='section'||!researchId(id)||!['card','section'].includes(presentation))throw new AppError('INVALID');
 const assets=new Set();for(const child of descendants(node))for(const a of child.attrs??[]){
  if(['src','href','poster'].includes(a.name)){const match=sourceAsset.exec(a.value);if(match)assets.add(match[1]);}
 }
 return {display:id,presentation,assets:[...assets]};
}

// Keep the chosen section's own permitted markup. Each placed copy has its
// own anchor namespace, so two copies on a page cannot share element IDs.
function sectionHTML(entry,id){
 const root=parseFragment(serializeOuter(entry.node)).childNodes[0],ids=new Map();
 function trim(node){
  node.childNodes=(node.childNodes??[]).filter(c=>!concealed(c)&&!sectionKey(part(c)));
  const old=attr(node,'id');if(old)ids.set(old,'entry-'+id+'-'+old);
  for(const child of node.childNodes)trim(child);
 }
 trim(root);
 for(const node of descendants(root))for(const a of [...node.attrs??[]]){
  if(['srcset','background'].includes(a.name)||a.name==='style'&&/url\s*\(|\\/i.test(a.value)){node.attrs=node.attrs.filter(item=>item!==a);continue;}
  if(a.name==='id')a.value=ids.get(a.value);
  if(a.name==='href'&&a.value.startsWith('#')){
   const target=ids.get(a.value.slice(1));if(target)a.value='#'+target;else node.attrs=node.attrs.filter(item=>item!==a);
  }
  if(['headers','aria-labelledby','aria-describedby','for'].includes(a.name)){
   const value=a.value.split(/\s+/).map(key=>ids.get(key)).filter(Boolean).join(' ');
   if(value)a.value=value;else node.attrs=node.attrs.filter(item=>item!==a);
  }
 }
 return serializeOuter(root);
}
export function renderEntryPlacement(node,{id,revision,title,visible,html,choices,page,display,requireChoice=false}){
 const retained=node.attrs.filter(a=>['id','class','style'].includes(a.name)).map(a=>' '+a.name+'="'+escaped(a.value)+'"').join('');
 const start='<section'+retained+' data-observanda-source="'+id+'" data-observanda-source-revision="'+revision+'"';
 if(!display)return start+'>'+sourceFragmentAtPage(visible?html:'',page)+'</section>';
 const {slot,presentation,choice}=display;
 if(!researchId(slot)||!['card','section'].includes(presentation)||!(presentation==='card'&&(choice==='title'||fields.has(choice))||sectionKey(choice)))throw new AppError('INVALID');
 const item=choices?.get(choice);
 if(requireChoice&&choice!=='title'&&(!item||presentation==='card'&&!item.text))throw new AppError('NOT_FOUND');
 let body='';
 if(visible){
  body='<h2>'+escaped(title)+'</h2>';
  if(item&&presentation==='section')body+=sourceFragmentAtPage(sectionHTML(item,slot),page);
  else if(item?.text)body+=(item.title?'<h3>'+escaped(item.title)+'</h3>':'')+'<p>'+escaped(item.text)+'</p>';
  body='<article class="website-entry-'+presentation+'">'+body+'</article>';
 }
 return start+' '+displayId+'="'+slot+'" '+displayMode+'="'+presentation+'">'+body+'</section>';
}
