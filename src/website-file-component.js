import path from 'node:path';
import {parse,parseFragment,serializeOuter} from 'parse5';
import {AppError} from './errors.js';
import {validateWebsiteHTML,websiteFileName} from './website-file-policy.js';
import {attr,put,descendants} from './website-migration-views.js';
import {websiteRecordingKind} from './website-recordings.js';
import {mathNamespace,safeEquationElement} from './web/website-equation-markup.js';

const marker='data-website-instance';
const blocks=new Set('section article aside div figure table p h1 h2 h3 h4 h5 h6 blockquote ol ul dl details pre hr img video audio'.split(' '));
const children=new Set([...blocks,...'span strong em b i u s sup sub small mark code br a time figcaption caption colgroup col thead tbody tfoot tr th td li dt dd summary source track'.split(' ')]);
const containers=new Set('body main section article aside div blockquote li dd'.split(' '));
const common=new Set('id class style title lang dir role aria-label aria-hidden aria-describedby aria-labelledby data-section-id data-website-theme'.split(' '));
const playerAttrs=['src','controls','loop','muted','preload'];
const attributes={a:['href','rel','target'],img:['src','alt','width','height','loading','decoding'],th:['scope','colspan','rowspan','headers'],td:['colspan','rowspan','headers'],ol:['start','reversed','type'],li:['value'],time:['datetime'],details:['open','data-website-transcript'],col:['span'],
 audio:playerAttrs,video:[...playerAttrs,'playsinline','poster','width','height'],track:['src','kind','srclang','label','default'],source:['src','type'],figure:['data-website-recording','data-website-equation']};
const idRefs=new Set(['aria-describedby','aria-labelledby','headers']);
const invalid=()=>{throw new AppError('INVALID');};
const conflict=()=>{throw new AppError('CONFLICT');};
const protectedNode=node=>['nav','header','footer','template'].includes(node.tagName)||node.attrs?.some(a=>a.name.startsWith('data-observanda-')||['data-record-id','data-public-record','data-feed-item','data-website-feed','data-website-feed-source','data-website-source-gallery',marker,'data-website-menu','hidden'].includes(a.name));
const nodes=root=>[...descendants(root)].filter(node=>node.tagName);

function oneRoot(html){
 if(typeof html!=='string'||Buffer.byteLength(html)>64*1024)invalid();
 const parts=parseFragment(html).childNodes.filter(n=>n.nodeName!=='#text'||n.value.trim());
 if(parts.length!==1||!blocks.has(parts[0].tagName))invalid();
 return parts[0];
}
function ancestry(node){for(let parent=node;parent;parent=parent.parentNode)if(protectedNode(parent))invalid();}
function safeStyle(value){
 // Formatting can travel with a block. URL-bearing CSS, custom properties
 // and escaped CSS carry resource references outside the HTML asset checks.
 if(/[\\@{}/!]/.test(value)||/\b(?:url|var|image-set|src|attr)\s*\(/i.test(value))invalid();
 for(const part of value.split(';').filter(s=>s.trim())){
  if(!/^\s*(?:[a-z][a-z-]*|--(?:page-(?:text|muted|background)|(?:reading|heading)-(?:font|weight)|body-size|line-height|letter-spacing|section-(?:heading|body|item-heading|details|caption|button)-align))\s*:\s*[\w\s#.,%()'" +-]+\s*$/i.test(part))invalid();
  for(const call of part.matchAll(/([\w-]+)\s*\(/g))if(!/^(?:rgb|rgba|hsl|hsla|calc|min|max|clamp)$/i.test(call[1]))invalid();
 }
}
function rewrite(root,{from,to,pages,files,themes,draft,instance,originalIds=false,verifyOnly=false}){
 const ids=new Map(),pictures=new Map(),recordings=new Map();
 for(const node of descendants(root))if(node.nodeName==='#comment')invalid();
 for(const node of nodes(root)){
  const id=attr(node,'id');if(id===undefined)continue;
  if(!/^[a-zA-Z][\w-]{0,95}$/.test(id)||ids.has(id)||id.startsWith('wc-'))invalid();
  ids.set(id,instance&&!originalIds?'wc-'+instance+'-'+id:id);
 }
 const localId=value=>ids.get(value)??invalid();
 const url=(value,kind)=>{
  if(kind==='link'&&value.startsWith('#'))return '#'+localId(value.slice(1));
  if(kind==='link'&&/^(?:https?:\/\/|mailto:)/i.test(value))return value;
  if(!value||/[\\\s%:?\u0000-\u001f]/.test(value)||value.startsWith('/')||value.includes('#'))invalid();
  const name=path.posix.normalize(path.posix.join(path.posix.dirname(from),value));websiteFileName(name);
  const file=files.get(name),page=pages.get(name);
  if(file?.sourceId||!file||file.draft&&!draft)invalid();
  if(file.picture===true&&/^pictures\/[\da-f-]{36}\.png$/.test(name)&&['link','img'].includes(kind))pictures.set(name,file);
  else if(file.recording===true&&websiteRecordingKind(file)&&(kind==='link'||websiteRecordingKind(file)===kind))recordings.set(name,file);
  else if(kind!=='link'||!page||!verifyOnly&&page.placements.length)invalid();
  return path.posix.relative(path.posix.dirname(to),name);
 };
 for(const node of nodes(root)){
  if(node.namespaceURI===mathNamespace){
   if(!safeEquationElement(node.tagName,node.namespaceURI,node.attrs))invalid();
   for(const item of node.attrs){if(item.name==='id')item.value=localId(item.value);if(idRefs.has(item.name))item.value=item.value.trim().split(/\s+/).map(localId).join(' ');}
   continue;
  }
  if(!children.has(node.tagName)||node.namespaceURI!=='http://www.w3.org/1999/xhtml')invalid();
  const theme=attr(node,'data-website-theme');
  if(theme!==undefined&&!themes?.has(theme)){
   if(!instance)invalid();node.attrs=node.attrs.filter(a=>a.name!=='data-website-theme');
  }
  if(['track','source'].includes(node.tagName)&&!['audio','video'].includes(node.parentNode?.tagName))invalid();
  for(const attribute of node.attrs){
   const {name,value}=attribute;if(!common.has(name)&&!attributes[node.tagName]?.includes(name))invalid();
   if(name==='id')attribute.value=localId(value);
   if(idRefs.has(name))attribute.value=value.trim().split(/\s+/).map(localId).join(' ');
   if(name==='style')safeStyle(value);
   if(name==='href')attribute.value=url(value,'link');
   if(name==='poster')attribute.value=url(value,'img');
   if(name==='src')attribute.value=url(value,node.tagName==='source'?node.parentNode.tagName:node.tagName);
  }
 }
 const result=serializeOuter(root);
 validateWebsiteHTML(result,{file:to});
 return {html:result,pictures:[...pictures.values()],recordings:[...recordings.values()]};
}
export function prepareComponent(html,from,context){
 return rewrite(oneRoot(html),{...context,from,to:'index.html'});
}
export function renderComponentInstance(main,instance,page,context){
 const root=oneRoot(main.html);
 rewrite(root,{...context,from:'index.html',to:page.path,instance:instance.id,originalIds:instance.originalIds,draft:page.draft});
 put(root,marker,instance.id);return serializeOuter(root);
}
export function pageComponentDocument(html){return parse(html,{sourceCodeLocationInfo:true});}
function location(node){const loc=node?.sourceCodeLocation;if(!loc||!Number.isInteger(loc.startOffset)||!Number.isInteger(loc.endOffset))invalid();return loc;}
function atPath(document,blockPath){
 if(typeof blockPath!=='string'||blockPath.length>255||!/^\d{1,5}(?:\/\d{1,5})*$/.test(blockPath))invalid();
 let node=nodes(document).find(n=>n.tagName==='body');for(const key of blockPath.split('/'))node=node?.childNodes.filter(n=>n.tagName)[Number(key)];
 if(!node)invalid();return node;
}
export function selectComponentBlock(document,blockPath){
 const node=atPath(document,blockPath);ancestry(node);location(node);return serializeOuter(node);
}
function changesFor(html,edits){
 return edits.sort((a,b)=>b.start-a.start).reduce((s,e)=>s.slice(0,e.start)+e.html+s.slice(e.end),html);
}
function rewriteAt(html,node,replacement){const loc=location(node);return changesFor(html,[{start:loc.startOffset,end:loc.endOffset,html:replacement}]);}
export function makeFirstInstance(html,doc,blockPath,main,instance,page,context){
 const node=atPath(doc,blockPath);return rewriteAt(html,node,renderComponentInstance(main,instance,page,context));
}
export function insertComponent(html,doc,position,blockPath,main,instance,page,context){
 let offset;
 if(position==='end'){
  const body=nodes(doc).find(n=>n.tagName==='body'),destination=nodes(body).find(n=>n.tagName==='main'&&attr(n,'hidden')===undefined)??body;
  ancestry(destination);offset=location(destination).endTag?.startOffset;
 }else if(['before','after'].includes(position)){
  const target=atPath(doc,blockPath);
  ancestry(target.parentNode);if(!containers.has(target.parentNode.tagName)||['main','nav','header','footer'].includes(target.tagName))invalid();
  const loc=location(target);offset=position==='before'?loc.startOffset:loc.endOffset;
 }
 if(!Number.isInteger(offset))invalid();
 return html.slice(0,offset)+renderComponentInstance(main,instance,page,context)+html.slice(offset);
}
export function rewriteComponentInstances(html,doc,main,page,context,{detach}={}){
 const matches=new Map((page.instances??[]).filter(i=>i.component===main.id&&(!detach||i.id===detach)).map(i=>[i.id,i])),changes=[];
 for(const node of nodes(doc)){
  const id=attr(node,marker),instance=matches.get(id);if(!instance)continue;
  matches.delete(id);const loc=location(node);node.attrs=node.attrs.filter(a=>a.name!==marker);
  changes.push({start:loc.startOffset,end:loc.endOffset,html:detach?serializeOuter(node):renderComponentInstance(main,instance,page,context)});
 }
 if(matches.size||detach&&!changes.length)conflict();return changesFor(html,changes);
}
export function checkComponentInstances(html,page,context){
 if(!page.instances?.length&&!html.toLowerCase().includes(marker))return;
 const all=nodes(pageComponentDocument(html)),instances=new Map((page.instances??[]).map(row=>[row.id,row])),ids=new Map();
 for(const node of all){const id=attr(node,'id');if(id)ids.set(id,(ids.get(id)??0)+1);}
 for(const node of all){
  const id=attr(node,marker);if(id===undefined)continue;
  const instance=instances.get(id),main=context.components.get(instance?.component);if(!main)conflict();
  ancestry(node.parentNode);instances.delete(id);
  if(renderComponentInstance(main,instance,page,{...context,verifyOnly:true})!==serializeOuter(node))conflict();
  for(const child of nodes(node)){const id=attr(child,'id');if(id&&ids.get(id)!==1)conflict();}
 }
 if(instances.size)conflict();
}
