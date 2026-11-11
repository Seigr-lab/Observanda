import path from 'node:path';
import {parse,parseFragment,serializeOuter} from 'parse5';
import {AppError} from './errors.js';
import {validateWebsiteHTML,websiteFileName} from './website-file-policy.js';
import {attr,put,descendants} from './website-migration-views.js';
import {websiteRecordingKind} from './website-recordings.js';
import {mathNamespace,safeEquationElement} from './web/website-equation-markup.js';
import {slotMarker,entryField,componentSlots,shapeComponent,checkInstanceOptions} from './website-component-schema.js';
import {componentStyleId,componentPaint} from './website-component-styles.js';
import {mapImageCandidates} from './web/website-image-candidates.js';

const marker='data-website-instance';
const blocks=new Set('section article aside div figure picture table p h1 h2 h3 h4 h5 h6 blockquote ol ul dl details pre hr img video audio'.split(' '));
const children=new Set([...blocks,...'span strong em b i u s sup sub small mark code br a time figcaption caption colgroup col thead tbody tfoot tr th td li dt dd summary source track'.split(' ')]);
const containers=new Set('body main section article aside div blockquote li dd'.split(' '));
const common=new Set([...('id class style title lang dir role aria-label aria-hidden aria-describedby aria-labelledby data-section-id data-website-theme'.split(' ')),slotMarker]);
const playerAttrs=['src','controls','loop','muted','preload'];
const galleryAttrs=['data-image-gallery','data-viewer','data-previous','data-next','data-close','data-download','data-position','data-zoom'];
const attributes={div:galleryAttrs,section:galleryAttrs,a:['href','rel','target','data-gallery-image','aria-haspopup'],img:['src','srcset','sizes','alt','width','height','loading','decoding'],th:['scope','colspan','rowspan','headers'],td:['colspan','rowspan','headers'],ol:['start','reversed','type'],li:['value'],time:['datetime'],details:['open','data-website-transcript'],col:['span'],
 audio:playerAttrs,video:[...playerAttrs,'playsinline','poster','width','height'],track:['src','kind','srclang','label','default'],source:['src','type','srcset','sizes','media','width','height'],figure:['data-website-recording','data-website-equation']};
const idRefs=new Set(['aria-describedby','aria-labelledby','headers']);
const invalid=()=>{throw new AppError('INVALID');};
const conflict=()=>{throw new AppError('CONFLICT');};
const protectedNode=node=>['nav','header','footer','template'].includes(node.tagName)||node.attrs?.some(a=>a.name.startsWith('data-observanda-')||['data-record-id','data-public-record','data-feed-item','data-website-feed','data-website-feed-source','data-website-source-gallery',marker,'data-website-menu','data-website-region','hidden'].includes(a.name));
// A site region holds its one instance directly, or inside the phone toggle.
function regionHolder(node,slot){
 const toggle=node.parentNode?.tagName==='details'&&attr(node.parentNode,'data-website-region-toggle')!==undefined?node.parentNode:null;
 const wrapper=toggle?toggle.parentNode:node.parentNode;
 return attr(wrapper,'data-website-region')===slot&&wrapper.parentNode?.tagName==='body'?wrapper:null;
}
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
  if(file?.sourceId||file?.feedAsset||file?.feedPage||!file||file.draft&&!draft)invalid();
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
  if(['track','source'].includes(node.tagName)&&!['audio','video'].includes(node.parentNode?.tagName)&&!(node.tagName==='source'&&node.parentNode?.tagName==='picture'&&attr(node,'src')===undefined))invalid();
  for(const attribute of node.attrs){
   const {name,value}=attribute;if(!common.has(name)&&!attributes[node.tagName]?.includes(name))invalid();
   if(name==='id')attribute.value=localId(value);
   if(idRefs.has(name))attribute.value=value.trim().split(/\s+/).map(localId).join(' ');
   if(name==='style')safeStyle(value);
   if(name==='href')attribute.value=url(value,'link');
   if(name==='poster')attribute.value=url(value,'img');
   if(name==='src')attribute.value=url(value,node.tagName==='source'?node.parentNode.tagName:node.tagName);
   if(name==='srcset')attribute.value=mapImageCandidates(value,candidate=>url(candidate,'img'));
  }
 }
 const result=serializeOuter(root);
 validateWebsiteHTML(result,{file:to});
 return {html:result,pictures:[...pictures.values()],recordings:[...recordings.values()]};
}
export function componentTemplate(html,main={}){
 const root=oneRoot(html);
 for(const node of nodes(root))if(protectedNode(node))invalid();
 if(main.slots?.length||html.includes(slotMarker))componentSlots(root,main);
 return root;
}
export function prepareComponent(html,from,context,main={}){
 return rewrite(componentTemplate(html,main),{...context,from,to:'index.html'});
}
function componentTree(main,instance,page,context,entries){
 const root=oneRoot(main.html);
 let nested=[];
 if(main.slots?.length||main.variants?.length||instance.values||instance.variant){
  checkInstanceOptions(main,instance,context.files,page.draft);
  nested=shapeComponent(root,main,instance,context);
 }
 rewrite(root,{...context,from:'index.html',to:page.path,instance:instance.id,originalIds:instance.originalIds,draft:page.draft});
 if(main.css)put(root,componentPaint,componentStyleId(main));
 for(const {node,child,id,field} of nested){
  if(field){
   put(node,entryField,instance.id+'-'+field);
   if(instance.entries?.[field]){
    const source=entries?.get(field);if(!source||attr(source,'data-observanda-source')!==instance.entries[field])conflict();
    const copy=parseFragment(serializeOuter(source)).childNodes[0];node.childNodes=[copy];copy.parentNode=node;
   }
   continue;
  }
  if(!child||child.draft&&!page.draft)invalid();
  const subtree=componentTree(child,{id},page,context);
  node.childNodes=[subtree];subtree.parentNode=node;
 }
 return root;
}
export function componentEntries(node,instance){
 if(!instance.entries)return;
 const saved=new Map();
 for(const target of nodes(node)){
  const marker=attr(target,entryField);if(!marker?.startsWith(instance.id+'-'))continue;
  const field=marker.slice(instance.id.length+1),source=Object.hasOwn(instance.entries,field)&&instance.entries[field];if(!source)continue;
  const content=target.childNodes.filter(n=>n.tagName||n.nodeName!=='#text'||n.value.trim());
  if(saved.has(field)||content.length!==1||attr(content[0],'data-observanda-source')!==source)conflict();
  saved.set(field,content[0]);
 }
 if(saved.size!==Object.keys(instance.entries).length)conflict();return saved;
}
export function renderComponentInstance(main,instance,page,context,entries){
 const root=componentTree(main,instance,page,context,entries);
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
 const parts=[];let at=0;
 for(const e of edits.sort((a,b)=>a.start-b.start)){
  if(e.start<at)conflict();
  parts.push(html.slice(at,e.start),e.html);at=e.end;
 }
 return parts.join('')+html.slice(at);
}
function rewriteAt(html,node,replacement){const loc=location(node);return changesFor(html,[{start:loc.startOffset,end:loc.endOffset,html:replacement}]);}
export function makeFirstInstance(html,doc,blockPath,main,instance,page,context){
 const node=atPath(doc,blockPath);return rewriteAt(html,node,renderComponentInstance(main,instance,page,context));
}
export function wrapComponentEntry(html,doc,blockPath,main,instance,page,context,{field,sourceId,sourceRevision}){
 const node=atPath(doc,blockPath),id=attr(node,'data-observanda-source'),revision=attr(node,'data-observanda-source-revision');
 if(node.tagName!=='section'||!main.slots?.some(s=>s.type==='entry'&&s.id===field)||!page.placements.some(p=>p.id===id&&p.revision===revision))invalid();
 if(sourceId!==id||sourceRevision!==revision)conflict();
 ancestry(node.parentNode);instance.entries={[field]:id};
 return rewriteAt(html,node,renderComponentInstance(main,instance,page,context,new Map([[field,node]])));
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
export function rewriteComponentInstances(html,doc,main,page,context,{detach,affected,only}={}){
 const matches=new Map((page.instances??[]).filter(i=>(affected?.has(i.component)??(i.component===main.id))&&(!only||i.id===only)&&(!detach||i.id===detach)).map(i=>[i.id,i])),changes=[];
 for(const node of nodes(doc)){
  const id=attr(node,marker),instance=matches.get(id);if(!instance)continue;
  matches.delete(id);const loc=location(node);node.attrs=node.attrs.filter(a=>a.name!==marker);
  if(detach)for(const child of nodes(node))child.attrs=child.attrs.filter(a=>a.name!==entryField);
  changes.push({start:loc.startOffset,end:loc.endOffset,html:detach?serializeOuter(node):renderComponentInstance(context.components.get(instance.component),instance,page,context,componentEntries(node,instance))});
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
  if(instance.region){if(!regionHolder(node,instance.region))conflict();}
  else ancestry(node.parentNode);
  instances.delete(id);
  if(renderComponentInstance(main,instance,page,{...context,verifyOnly:true},componentEntries(node,instance))!==serializeOuter(node))conflict();
  const authored=[node];
  while(authored.length){
   const child=authored.pop();if(attr(child,'data-observanda-source')!==undefined)continue;
   const anchor=attr(child,'id');if(anchor&&ids.get(anchor)!==1)conflict();
   for(const element of child.childNodes??[])if(element.tagName)authored.push(element);
  }
 }
 if(instances.size)conflict();
}
