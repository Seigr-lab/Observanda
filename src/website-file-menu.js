import path from 'node:path';
import {parse,parseFragment,serializeOuter} from 'parse5';
import {AppError} from './errors.js';
import {validateWebsiteHTML,websiteFileName} from './website-file-policy.js';
import {escapeWebsiteText as esc} from './website-file-html.js';
import {attr,descendants,put,words} from './website-migration-views.js';

const fail=()=>{throw new AppError('INVALID');};
const has=(node,name)=>attr(node,name)!==undefined;
const hasClass=(node,name)=>(attr(node,'class')??'').split(/\s+/).includes(name);
const children=node=>(node.childNodes??[]).filter(child=>child.tagName);
const list=node=>['ul','ol'].includes(node?.tagName);
const fragment=html=>parseFragment(html).childNodes[0];
const clone=node=>fragment(serializeOuter(node));
const inner=(node,nodes)=>{node.childNodes=nodes;for(const child of nodes)child.parentNode=node;};
const drop=(node,name)=>{node.attrs=node.attrs.filter(attribute=>attribute.name!==name);};
const part=(page,href)=>href.startsWith('#')||/^[a-z][a-z0-9+.-]*:/i.test(href)?href:
 path.posix.join(path.posix.dirname(page),href.split('#')[0])+(href.includes('#')?'#'+href.split('#').slice(1).join('#'):'');
const relative=(page,to)=>to.startsWith('#')||/^[a-z][a-z0-9+.-]*:/i.test(to)?to:
 path.posix.relative(path.posix.dirname(page),to.split('#')[0])+(to.includes('#')?'#'+to.split('#').slice(1).join('#'):'');
const managed=node=>has(node,'data-observanda-source')||has(node,'data-observanda-link');
function supported(nav){
 if(!nav||[...descendants(nav)].some(node=>has(node,'data-website-instance')||node!==nav&&has(node,'data-observanda-source')&&node.tagName!=='a'))return null;
 const items=children(nav),lists=items.filter(list);
 if(lists.length===1&&children(lists[0]).every(node=>node.tagName==='li'))return lists[0];
 return items.every(node=>node.tagName==='a')?nav:null;
}
function sourceTree(container,page,prior,byKey,prefix=''){
 const result=[];
 for(const node of children(container)){
  if(node.tagName!=='a'&&children(node).filter(child=>child.tagName==='a').length!==1)return null;
  const link=node.tagName==='a'?node:children(node).find(child=>child.tagName==='a');
  if(!link)return null;
  const key=prefix+result.length,receipt=prior.get(attr(link,'data-observanda-link-key'));
  const raw=attr(link,'href')??receipt?.href??attr(link,'data-observanda-href')??'';
  const href=raw?part(page,raw):'',blocked=!has(link,'href')&&managed(link);
  const label=words(link).trim()||attr(link,'aria-label')||attr(link,'title')||'',childList=children(node).find(list)??children(children(node).find(child=>child.tagName==='details')??{}).find(list);
  const nested=childList?sourceTree(childList,page,prior,byKey,key+'.'):[];
  if(!nested)return null;
  byKey.set(key,{node,link,href,blocked,label});
  result.push({key,label:blocked?'':label,href:blocked?'':href,managed:managed(link),blocked,children:nested});
 }
 return result;
}
export function menuDocument(html){return parse(html,{sourceCodeLocationInfo:true});}
function authoredNav(node){
 for(let n=node;n;n=n.parentNode)if(['data-observanda-source','data-observanda-part','data-website-instance','data-website-feed','data-website-source-gallery'].some(key=>has(n,key)))return false;
 return true;
}
export function namedWebsiteMenus(document){
 const menus=new Map();
 for(const nav of descendants(document))if(nav.tagName==='nav'&&has(nav,'data-website-menu-id')&&authoredNav(nav)){
  const id=attr(nav,'data-website-menu-id');if(menus.has(id))throw new AppError('FORMAT');
  menus.set(id,{id,name:attr(nav,'aria-label'),position:attr(nav,'data-website-menu-position'),nav});
 }
 return menus;
}
export function readWebsiteMenu(html,page,placements=[],id=null){
 const document=typeof html==='string'?menuDocument(html):html,nodes=[...descendants(document)],navs=nodes.filter(node=>node.tagName==='nav'&&authoredNav(node)&&!has(node,'data-website-menu-id'));
 const candidates=id?[namedWebsiteMenus(document).get(id)?.nav].filter(Boolean):[...new Set([
  ...navs.filter(n=>has(n,'data-website-menu')),
  ...navs.filter(n=>attr(n,'aria-label')==='Website'||hasClass(n.parentNode,'site-top')),
  ...navs.filter(n=>children(n).some(child=>list(child)&&hasClass(child,'site-menu'))),
  ...navs.filter(n=>['header','body'].includes(n.parentNode?.tagName)&&!has(n,'data-observanda-source')&&!['book-page-navigation','page-contents','section-index'].some(name=>hasClass(n,name)))
 ])];
 const prior=new Map(placements.filter(item=>item.link).map(item=>[item.link,item]));
 for(const nav of candidates){
  const container=supported(nav);if(!container?.sourceCodeLocation?.endTag)continue;
  const byKey=new Map(),siblings=container===nav?[]:children(nav).filter(node=>node.tagName==='a');
  const entries=siblings.length?{childNodes:children(nav).flatMap(node=>node===container?children(node):node.tagName==='a'?[node]:[])}:container;
  const items=sourceTree(entries,page,prior,byKey);
  if(items)return {document,nav,container,page,byKey,items,siblings,id};
 }
 if(id&&candidates.length)throw new AppError('FORMAT');
 return {document,page,byKey:new Map(),items:[],id};
}
function checkHref(href,pages){
 if(typeof href!=='string'||!href||href.length>4096||href.trim()!==href||href.startsWith('/')||/[\u0000-\u001f\\]/.test(href))fail();
 validateWebsiteHTML('<a href="'+esc(href)+'">Link</a>');
 if(href.startsWith('#')||/^[a-z][a-z0-9+.-]*:/i.test(href))return;
 const name=href.split('#')[0];websiteFileName(name);if(!pages.has(name))fail();
}
export function checkMenuChanges(items,base,pages){
 const used=new Set();
 function visit(rows,depth){
  if(!Array.isArray(rows)||depth>64)fail();
  for(const item of rows){
   if(!item||typeof item!=='object'||Array.isArray(item)||!Array.isArray(item.children))fail();
   const original=item.key===null?null:base.byKey.get(item.key);
   if(item.key!==null&&(!original||used.has(item.key)))fail();
   if(original)used.add(item.key);
   if(original?.blocked){
    if(item.href!==''||item.label!=='')fail();
   }else{
    if(typeof item.label!=='string'||!item.label.trim()&&item.label!==original?.label||item.label.length>1000||/[\u0000-\u001f]/.test(item.label))fail();
    if(!original||item.href!==original.href)checkHref(item.href,pages);
   }
   visit(item.children,depth+1);
  }
 }
 visit(items,0);
}
export function menuTargetOwner(html){
 const nodes=[...descendants(parse(html))],title=nodes.find(node=>node.tagName==='title'&&attr(node,'data-observanda-view')==='document-title');
 if(!title)return null;
 return {id:attr(title,'data-observanda-source'),revision:attr(title,'data-observanda-source-revision'),anchors:new Set(nodes.map(node=>attr(node,'id')).filter(Boolean))};
}
function sameMenu(base,local){
 if(!local.nav)return false;
 if(base.byKey.size!==local.byKey.size)return false;
 for(const [key,original] of base.byKey){
  const other=local.byKey.get(key);
  if(!other||original.href!==other.href||original.blocked!==other.blocked||['data-observanda-source','data-observanda-link'].some(key=>attr(original.link,key)!==attr(other.link,key)))return false;
 }
 return true;
}
function rename(link,label){
 const leaves=[...descendants(link)].filter(node=>node.nodeName==='#text'&&node.value.trim());
 if(leaves.length){leaves[0].value=label;for(const leaf of leaves.slice(1))leaf.value='';}
 else inner(link,[{nodeName:'#text',value:label}]);
}
function childContainer(item){
 const detail=children(item).find(node=>node.tagName==='details'&&children(node).some(list));
 const listNode=detail?children(detail).find(list):children(item).find(list);
 return {detail,listNode};
}
function publicAnchor(owner,href,label){
 const anchor=fragment('<a></a>');rename(anchor,label);
 if(owner){
  put(anchor,'data-observanda-link',owner.id);put(anchor,'data-observanda-link-revision',owner.revision);
  put(anchor,'data-observanda-link-label','title');
 }
 put(anchor,'href',href);return anchor;
}
function cloneAt(node,from,to){
 const result=clone(node);if(from===to)return result;
 for(const member of descendants(result))for(const attribute of member.attrs??[]){
  if(['href','src','poster','data-observanda-href'].includes(attribute.name)&&attribute.value)attribute.value=relative(to,part(from,attribute.value));
 }
 return result;
}
// Rewrite only the primary menu. Unrecognized custom navigation and neighboring
// controls (such as the published research browser) keep their original bytes.
export function writeWebsiteMenu(html,page,previous,base,items,owners,definition=null){
 const local=readWebsiteMenu(html,page,previous,base.id),match=sameMenu(base,local),owned=local.nav&&has(local.nav,'data-website-menu');
 const primary=local.nav&&(attr(local.nav,'aria-label')==='Website'||hasClass(local.nav.parentNode,'site-top')||hasClass(local.container,'site-menu'));
 const existing=match||owned||primary?local:null,prior=[...previous],keys=new Set(prior.filter(item=>item.link).map(item=>item.link));
 let sequence=0;
 function assign(link,target){
  let key;do{key=String(++sequence);}while(keys.has(key));keys.add(key);put(link,'data-observanda-link-key',key);
  prior.push({link:key,href:target});
 }
 function row(item,index,flat=false){
  const reference=base.byKey.get(item.key),sameSlot=existing?.byKey.get(item.key);
  // A page may have had a different primary menu before it was shared.
  // Position alone never transfers another link's label, grants or attributes.
  const localRow=match?sameSlot:null,original=localRow??reference;
  const to=relative(page,original?.blocked?original.href:item.href),owner=owners.get(item.href);
  const previousOwner=original&&(attr(original.link,'data-observanda-source')??attr(original.link,'data-observanda-link'));
  const replacesOwner=previousOwner&&owner&&owner.id!==previousOwner;
  const from=localRow?local.page:base.page,link=original&&!replacesOwner?cloneAt(original.link,from,page):publicAnchor(owner,to,replacesOwner?owner.title:item.label);
  if(original&&!original.blocked&&!replacesOwner&&item.label!==original.label){
   rename(link,item.label);
   if(has(link,'data-observanda-link'))put(link,'data-observanda-link-label','title');
  }
  if(original?.blocked)drop(link,'href');else put(link,'href',to);
  if(has(link,'data-observanda-href'))put(link,'data-observanda-href',to);
  if(has(link,'data-observanda-link')&&(!localRow||replacesOwner))assign(link,to);
  if(!original&&owner||original&&!managed(link)&&owner){
   put(link,'data-observanda-link',owner.id);put(link,'data-observanda-link-revision',owner.revision);put(link,'data-observanda-link-label','title');
   if(!has(link,'data-observanda-link-key'))assign(link,to);
  }
  drop(link,'aria-current');if(!original?.blocked&&item.href.split('#')[0]===page)put(link,'aria-current','page');
  if(flat&&!item.children.length)return link;
  const li=original?.node.tagName==='li'?cloneAt(original.node,from,page):fragment('<li></li>');
  const oldLink=children(li).find(child=>child.tagName==='a');if(oldLink)li.childNodes.splice(li.childNodes.indexOf(oldLink),1,link);else li.childNodes.unshift(link);link.parentNode=li;
  let {detail,listNode}=childContainer(li);
  if(!item.children.length){
   const remove=detail??listNode;if(remove)li.childNodes.splice(li.childNodes.indexOf(remove),1);
  }else{
   if(!listNode){
    detail=fragment('<details class="site-submenu"><summary>&#9662;</summary><ul class="site-menu"></ul></details>');
    li.childNodes.push(detail);detail.parentNode=li;listNode=children(detail).find(list);
   }
   if(detail){
    const summary=children(detail).find(node=>node.tagName==='summary');
    if(summary){const id=attr(link,'id')??'website-menu-item-'+index;put(link,'id',id);drop(summary,'aria-label');put(summary,'aria-labelledby',id);}
   }
   inner(listNode,item.children.map((child,i)=>row(child,index+'-'+i)));
  }
  return li;
 }
 const template=existing??base;
 const flat=template.container?.tagName==='nav'&&!items.some(item=>item.children.length);
 const standalone=item=>!item.children.length&&template.siblings?.includes(template.byKey.get(item.key)?.node);
 let start=0,end=items.length;
 while(start<end&&standalone(items[start]))start++;
 while(end>start&&standalone(items[end-1]))end--;
 const before=items.slice(0,start).map((item,i)=>row(item,String(i),true));
 const after=items.slice(end).map((item,i)=>row(item,String(end+i),true));
 const rows=items.slice(start,end).map((item,i)=>row(item,String(start+i),flat));
 const asHTML=rows.map(node=>serializeOuter(node)).join('');
 if(existing){
  const loc=existing.container.sourceCodeLocation;
  const content=list(existing.container)||flat?asHTML:'<ul class="site-menu">'+asHTML+'</ul>';
  const changes=[{start:loc.startTag.endOffset,end:loc.endTag.startOffset,value:content}];
  if(!has(existing.nav,'data-website-menu')){
   const insert=existing.nav.sourceCodeLocation.startTag.endOffset-1;
   changes.push({start:insert,end:insert,value:' data-website-menu=""'});
  }
  if(existing.siblings?.length){
   for(const node of existing.siblings){const {startOffset:start,endOffset:end}=node.sourceCodeLocation;changes.push({start,end,value:''});}
   changes.push({start:loc.startOffset,end:loc.startOffset,value:before.map(serializeOuter).join('')},
    {start:loc.endOffset,end:loc.endOffset,value:after.map(serializeOuter).join('')});
  }
  for(const change of changes.sort((a,b)=>b.start-a.start||b.end-a.end))html=html.slice(0,change.start)+change.value+html.slice(change.end);
  if(base.id&&definition){
   const updated=readWebsiteMenu(html,page,previous,base.id).nav,loc=updated.sourceCodeLocation;
   const moved=attr(updated,'data-website-menu-position')!==definition.position;
   put(updated,'aria-label',definition.name);put(updated,'data-website-menu-position',definition.position);
   const markup=serializeOuter(updated);
   html=html.slice(0,loc.startOffset)+(moved?'':markup)+html.slice(loc.endOffset);
   if(moved)html=placeNamedMenu(html,markup,definition.position);
  }
  return {html,prior};
 }
 if(!items.length&&!base.id)return {html,prior};
 const body=[...descendants(local.document)].find(node=>node.tagName==='body'),nodes=children(body),main=nodes.find(node=>node.tagName==='main');
 const at=main?.sourceCodeLocation?.startOffset??body.sourceCodeLocation?.startTag?.endOffset??nodes[0]?.sourceCodeLocation?.startOffset??0;
 const nav=base.nav?clone(base.nav):fragment('<nav aria-label="Website"></nav>');put(nav,'data-website-menu','');
 if(flat)inner(nav,rows);
 else{const ul=list(base.container)?clone(base.container):fragment('<ul class="site-menu"></ul>');inner(ul,rows);inner(nav,[...before,ul,...after]);}
 if(base.id){
  put(nav,'data-website-menu-id',base.id);put(nav,'aria-label',definition.name);put(nav,'data-website-menu-position',definition.position);
  return {html:placeNamedMenu(html,serializeOuter(nav),definition.position),prior};
 }
 return {html:html.slice(0,at)+serializeOuter(nav)+html.slice(at),prior};
}
function placeNamedMenu(html,nav,position){
 const doc=menuDocument(html),body=[...descendants(doc)].find(n=>n.tagName==='body'),nodes=children(body);
 const area=[...descendants(body)].find(node=>{
  if(node.tagName!==position&&!(position==='header'&&hasClass(node,'site-top')))return false;
  for(let p=node;p&&p!==body;p=p.parentNode)if(['main','article','section','aside','nav'].includes(p.tagName)||has(p,'hidden'))return false;
  return authoredNav(node);
 }),loc=area?.sourceCodeLocation?.endTag;
 const at=loc?.startOffset??(position==='footer'?(body.sourceCodeLocation?.endTag?.startOffset??nodes.at(-1)?.sourceCodeLocation?.endOffset??html.length):(body.sourceCodeLocation?.startTag?.endOffset??nodes[0]?.sourceCodeLocation?.startOffset??0));
 return html.slice(0,at)+nav+html.slice(at);
}
