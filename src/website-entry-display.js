import path from 'node:path';
import {parseFragment,serializeOuter} from 'parse5';
import {AppError} from './errors.js';
import {attr,descendants,words} from './website-migration-views.js';
import {researchId} from './web/research-reference.js';
import {imageResourceURLs,mapImageCandidates} from './web/website-image-candidates.js';
import {figureVariantKey,figureVariants,mapFigureVariants} from './website-figure-variants.js';

export const displayId='data-observanda-display-id',displayMode='data-observanda-display';
const part=node=>attr(node,'data-observanda-part');
const fields=new Set(['body','outcome','results','contributors','attempt','tags']);
const paras=new Set('p div article section ul ol li dl dt dd blockquote pre br'.split(' '));
const skipText=new Set('figure figcaption img video audio source track svg math table button nav'.split(' '));
const concealed=node=>['script','style','template','noscript'].includes(node.tagName)||node.attrs?.some(a=>a.name==='hidden'||a.name==='aria-hidden'&&a.value==='true'||a.name==='data-observanda-link'||a.name==='data-observanda-source');
const sectionKey=key=>typeof key==='string'&&key.startsWith('section:')&&researchId(key.slice(8));
const tableKey=key=>typeof key==='string'&&key.startsWith('table:')&&researchId(key.slice(6));
const escaped=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sourceAsset=/^(?:\.\.\/)*(assets\/[a-f0-9]{64}\.[a-z0-9]{1,12})$/;
export function sourceFragmentAtPage(html,page){
 if(!page.includes('/')||!html.includes('assets/'))return html;
 const root=parseFragment(html,{sourceCodeLocationInfo:true}),patches=[];
 const relative=url=>url.startsWith('assets/')&&sourceAsset.test(url)?path.posix.relative(path.posix.dirname(page),url):url;
 for(const node of descendants(root))for(const attr of node.attrs??[]){
  const next=attr.name==='srcset'?mapImageCandidates(attr.value,relative):attr.name===figureVariantKey?mapFigureVariants(attr.value,relative):['src','href','poster'].includes(attr.name)?relative(attr.value):attr.value;
  if(next===attr.value)continue;
  const loc=node.sourceCodeLocation?.attrs?.[attr.name];
  if(loc)patches.push({start:loc.startOffset,end:loc.endOffset,value:attr.name+'="'+escaped(next)+'"'});
 }
 const parts=[];let at=0;for(const {start,end,value} of patches.sort((a,b)=>a.start-b.start)){parts.push(html.slice(at,start),value);at=end;}
 return parts.join('')+html.slice(at);
}

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
  const result=attr(node,'data-result-table-id');
  if(researchId(result)&&attr(node.parentNode,'id')==='result-'+result){
   function findTable(root){
    if(concealed(root))return;
    if(root.tagName==='table')return root;
    for(const child of root.childNodes??[]){const table=findTable(child);if(table)return table;}
   }
   const table=findTable(node);
   if(table){
    const key='table:'+result,title=titleOf(node.parentNode),caption=table.childNodes?.find(child=>child.tagName==='caption');
    let contents=table;
    for(let p=table.parentNode;p&&p!==node;p=p.parentNode)if((attr(p,'class')??'').split(/\s+/).includes('retained-result-table')){contents=p;break;}
    entries.set(key,{key,kind:'table',title,text:caption?textOf(caption):'',node:contents});
   }
  }
  if((sectionKey(key)||fields.has(key))&&!entries.has(key)){
   const section=sectionKey(key),title=section?titleOf(node):'',text=textOf(node,{paragraph:true,skipHeadings:true});
   if(section||text)entries.set(key,{key,kind:section?'section':'field',title,text,node});
  }
  for(const child of node.childNodes??[])walk(child);
 }
 const root=parseFragment(html);walk(root);
 // Card extras travel with the choices: the entry's own photographs that can
 // be a cover, and its date as the converter wrote it.
 Object.defineProperty(entries,'card',{value:cardExtras(root)});
 return entries;
}
function cardExtras(root){
 const covers=new Map();let date=null;
 for(const node of descendants(root)){
  if(concealed(node))continue;
  const key=part(node);
  if(key?.startsWith('media:')&&researchId(key.slice(6))&&!covers.has(key)){
   const image=[...descendants(node)].find(child=>child.tagName==='img'&&sourceAsset.test(attr(child,'src')??''));
   if(image){const caption=[...descendants(node)].find(child=>child.tagName==='figcaption');covers.set(key,{key,image,label:(caption?words(caption):attr(image,'alt')??'').replace(/\s+/gu,' ').trim()});}
  }
  if(key==='metadata'&&!date)date=(node.childNodes??[]).find(child=>child.tagName==='time'&&attr(child,'datetime')||child.tagName==='span'&&attr(child,'class')==='record-date')??null;
 }
 return {covers,date};
}
export const cardCoverChoices=choices=>[...(choices?.card?.covers.values()??[])].map(({key,label})=>({key,label:label.slice(0,120)}));
export const cardHasDate=choices=>Boolean(choices?.card?.date);
function coverHTML(item){
 const allowed=['src','srcset','width','height','alt'];
 return '<img class="website-entry-cover" loading="lazy" sizes="auto, (min-width: 40rem) 40rem, 100vw"'+item.image.attrs.filter(a=>allowed.includes(a.name)).map(a=>' '+a.name+'="'+escaped(a.value)+'"').join('')+'>';
}
function dateHTML(node){
 const value=node.childNodes.map(child=>child.value??'').join('');
 return '<p class="website-entry-date">'+(node.tagName==='time'?'<time datetime="'+escaped(attr(node,'datetime'))+'" data-observanda-term="date">':'<span class="record-date" data-observanda-term="date">')+escaped(value)+(node.tagName==='time'?'</time>':'</span>')+'</p>';
}
// A full copy keeps the converter's part order. Whole groups of parts can be
// left out; standalone figures and media are separate from those placed
// inline in the writing, which stay with their paragraph.
export const recordGroups=Object.freeze(['title','details','outcome','contributors','body','sections','figures','media','relations','tags','attempt','results']);
export const recordLayouts=Object.freeze(['article','plain','compact','split']);
const hideKey='data-observanda-hide',layoutKey='data-observanda-layout';
const groupOf=key=>key==='title'?'title':key==='metadata'?'details':key.startsWith('section:')?'sections':key.startsWith('figure:')?'figures':key.startsWith('media:')?'media':recordGroups.includes(key)?key:null;
function recordItems(html){
 const root=parseFragment(html,{sourceCodeLocationInfo:true}),items=[],slice=node=>html.slice(node.sourceCodeLocation.startOffset,node.sourceCodeLocation.endOffset);
 let article=null,articleStart=null;
 for(const node of root.childNodes??[]){
  if(!node.tagName||!node.sourceCodeLocation)continue;
  if(node.tagName==='article'&&!article&&node.sourceCodeLocation.startTag){
   article=node;const tag=node.sourceCodeLocation.startTag;articleStart=html.slice(tag.startOffset,tag.endOffset);
   for(const child of node.childNodes??[])if(child.tagName&&child.sourceCodeLocation)items.push({key:part(child)??'',html:slice(child),article:true});
  }else items.push({key:part(node)??'',html:slice(node),article:false});
 }
 return {items,articleStart};
}
export function recordPartGroups(html){
 const present=new Set(recordItems(html).items.map(item=>groupOf(item.key)));
 return recordGroups.filter(group=>present.has(group));
}
export function validRecordPresentation({hidden=[],layout='article'}={}){
 return Array.isArray(hidden)&&hidden.every(group=>recordGroups.includes(group))&&new Set(hidden).size===hidden.length&&recordLayouts.includes(layout);
}
export function recordPresentation(node){
 const hidden=(attr(node,hideKey)??'').split(/\s+/).filter(group=>recordGroups.includes(group)),layout=attr(node,layoutKey);
 return {hidden:[...new Set(hidden)].sort(),layout:recordLayouts.includes(layout)?layout:'article'};
}
// Rebuild in the source's order. A part already on the page keeps its saved
// markup; a part shown again comes from the current permitted source.
export function presentRecordParts(current,source,hidden){
 const hide=new Set(hidden),now=recordItems(current),next=recordItems(source),used=new Map();
 const take=key=>{if(!key)return null;const n=used.get(key)??0;used.set(key,n+1);return now.items.filter(item=>item.key===key)[n]?.html??null;};
 let html='',open=false;
 for(const item of next.items){
  if(item.article&&!open){html+=now.articleStart??next.articleStart;open=true;}
  if(!item.article&&open){html+='</article>';open=false;}
  const group=groupOf(item.key);if(group&&hide.has(group))continue;
  html+=take(item.key)??item.html;
 }
 return open?html+'</article>':html;
}
const recordAttributes=record=>{
 if(!record)return '';const hidden=[...new Set(record.hidden)].sort();
 return (hidden.length?' '+hideKey+'="'+hidden.join(' ')+'"':'')+(record.layout&&record.layout!=='article'?' '+layoutKey+'="'+record.layout+'"':'');
};
function placedAssets(node){
 const assets=new Set();for(const child of descendants(node))for(const a of child.attrs??[]){
  if(['src','href','poster','srcset'].includes(a.name))for(const url of imageResourceURLs(a.name,a.value)){const match=sourceAsset.exec(url);if(match)assets.add(match[1]);}
  // Every language's drawing of a figure stays available to the page.
  if(a.name===figureVariantKey)for(const url of figureVariants(a.value).values()){const match=sourceAsset.exec(url);if(match)assets.add(match[1]);}
 }
 return [...assets];
}
export function displayPlacement(node){
 const id=attr(node,displayId),presentation=attr(node,displayMode);
 // A full copy that leaves parts out publishes only the files it still shows,
 // with its stylesheet and the fonts that stylesheet uses.
 if(id===undefined&&presentation===undefined)return node.tagName==='section'&&attr(node,hideKey)!==undefined?{partial:true,assets:placedAssets(node)}:null;
 if(node.tagName!=='section'||!researchId(id)||!['card','section'].includes(presentation))throw new AppError('INVALID');
 return {display:id,presentation,assets:placedAssets(node)};
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
  if(a.name==='background'||a.name==='srcset'&&!imageResourceURLs(a.name,a.value).every(url=>sourceAsset.test(url))||a.name==='style'&&/url\s*\(|\\/i.test(a.value)){node.attrs=node.attrs.filter(item=>item!==a);continue;}
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
export function renderEntryPlacement(node,{id,revision,title,visible,html,choices,page,display,requireChoice=false,record=null}){
 const retained=node.attrs.filter(a=>['id','class','style'].includes(a.name)).map(a=>' '+a.name+'="'+escaped(a.value)+'"').join('');
 const start='<section'+retained+' data-observanda-source="'+id+'" data-observanda-source-revision="'+revision+'"';
 if(!display){
  if(record&&!validRecordPresentation(record))throw new AppError('INVALID');
  const fragment=sourceFragmentAtPage(visible?html:'',page);
  return start+recordAttributes(record)+'>'+(record&&visible?presentRecordParts(record.current??fragment,fragment,record.hidden):fragment)+'</section>';
 }
 const {slot,presentation,choice}=display;
 if(!researchId(slot)||!['card','section'].includes(presentation)||!(presentation==='card'&&(choice==='title'||fields.has(choice))||sectionKey(choice)||presentation==='section'&&tableKey(choice)))throw new AppError('INVALID');
 if(display.cover!==undefined&&(presentation!=='card'||typeof display.cover!=='string'||!display.cover.startsWith('media:')||!researchId(display.cover.slice(6)))||display.date!==undefined&&(presentation!=='card'||display.date!==true))throw new AppError('INVALID');
 const item=choices?.get(choice);
 if(requireChoice&&choice!=='title'&&(!item||presentation==='card'&&!item.text))throw new AppError('NOT_FOUND');
 let body='';
 if(visible){
  // A chosen cover that is no longer permitted simply leaves the card.
  const cover=display.cover&&choices?.card?.covers.get(display.cover),date=display.date&&choices?.card?.date;
  body=(cover?sourceFragmentAtPage(coverHTML(cover),page):'')+'<h2>'+escaped(title)+'</h2>'+(date?dateHTML(date):'');
  if(item&&presentation==='section'){
   if(item.kind==='table'&&item.title)body+='<h3>'+escaped(item.title)+'</h3>';
   body+=sourceFragmentAtPage(sectionHTML(item,slot),page);
  }
  else if(item?.text)body+=(item.title?'<h3>'+escaped(item.title)+'</h3>':'')+'<p>'+escaped(item.text)+'</p>';
  body='<article class="website-entry-'+presentation+'">'+body+'</article>';
 }
 return start+' '+displayId+'="'+slot+'" '+displayMode+'="'+presentation+'">'+body+'</section>';
}
