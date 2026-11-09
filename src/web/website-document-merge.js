import {websiteHTML,serializeWebsiteHTML} from './website-html-document.js';
import {decodedWebsiteCSS,websiteCSSURLs} from './website-css-urls.js';
import {literal,mergeOrder} from './website-three-way.js';
import {imageResourceURLs} from './website-image-candidates.js';

const ownerNames=['data-observanda-source','data-observanda-link','data-website-source-gallery','data-website-feed','data-website-instance','data-website-menu-id','data-website-theme-sheet','data-website-appearance'];
const htmlOf=node=>node?.outerHTML??(node?.nodeType===8?'<!--'+node.data+'-->':node?.data??null);
const children=node=>[...(node.content??node).childNodes];
const anchor=node=>node.nodeType===1&&(node.getAttribute('data-section-id')||node.id)||null;
const kind=node=>node.namespaceURI+'/'+node.nodeName;
const strings=(items,fn)=>{
 const map=new Map();
 for(const value of items){
  const id=fn(value);if(id!==null)map.set(id,map.has(id)?null:value);
 }
 return map;
};
function align(base,side,externalKey){
 const result=new Map(),used=new Set();
 const claim=(a,b)=>{result.set(b,'base '+baseIndex.get(a));used.add(a);};
 const baseIndex=new Map(base.map((row,i)=>[row,i])),sideIndex=new Map(side.map((row,i)=>[row,i]));
 for(const key of [externalKey,htmlOf,kind]){
  const former=strings(base.filter(row=>!used.has(row)),key),now=strings(side.filter(row=>!result.has(row)),key);
  for(const [id,a] of former){const b=now.get(id);if(a&&b&&kind(a)===kind(b)&&(!externalKey(a)||!externalKey(b)||externalKey(a)===externalKey(b)))claim(a,b);}
 }
 const old=base.filter(row=>!used.has(row)),remaining=side.filter(row=>!result.has(row));
 // Identical duplicate siblings share no distinguishable authoring identity.
 // Only an unchanged run at the same positions can inherit positional keys.
 const ambiguous=old.length&&remaining.length&&(old.length!==remaining.length||!old.every((row,i)=>htmlOf(row)===htmlOf(remaining[i])&&baseIndex.get(row)===sideIndex.get(remaining[i])));
 if(!ambiguous&&old.length&&remaining.length)for(let i=0;i<old.length;i++)claim(old[i],remaining[i]);
 const unique=strings(remaining,externalKey);
 for(const node of remaining){
  if(result.has(node))continue;
  const key=externalKey(node);
  if(!key||unique.get(key)!==node)continue;
  result.set(node,'add '+key);
 }
 return {keys:result,ambiguous};
}
function secureDocument(html,context,latest){
 const doc=websiteHTML(html),pending=[doc.documentElement],seen=new Map();
 while(pending.length){
  const el=pending.pop(),attributes=[...el.attributes],known=ownerNames.find(name=>el.hasAttribute(name));
  const marker=known||attributes.find(a=>a.name.startsWith('data-observanda-')||['data-record-id','data-public-record','data-feed-item','data-website-feed-source'].includes(a.name))?.name;
  let identity;
  if(marker)identity=[el.localName,marker,el.getAttribute(marker),el.getAttribute('data-website-source-slot'),el.getAttribute('data-observanda-link-key')];
  else if(el.matches('script,nav'))identity=[el.localName,el.id,el.getAttribute('src')];
  else if(context.governed){
   const protectedStyle=text=>{for(const url of websiteCSSURLs(decodedWebsiteCSS(text)))if(context.governed(url))return true;return false;};
   const resource=attributes.find(a=>['href','src','poster','srcset','background'].includes(a.name)&&imageResourceURLs(a.name,a.value).some(url=>context.governed(url)));
   if(resource||el.hasAttribute('style')&&protectedStyle(el.getAttribute('style'))||el.localName==='style'&&protectedStyle(el.textContent))identity=[el.localName,'resource',resource?.value];
  }
  if(identity){
   const name=JSON.stringify(identity),occurrence=seen.get(name)??0,k=name+'/'+occurrence;
   seen.set(name,occurrence+1);
   if(!context.ids.has(k))context.ids.set(k,context.ids.size);
   const tag=context.nonce+context.ids.get(k),comment=doc.createComment(tag);
   if(latest)context.live.set(tag,el);
   el.replaceWith(comment);continue;
  }
  const list=(el.content??el).children;
  for(let i=list.length-1;i>=0;i--)pending.push(list[i]);
 }
 return doc;
}

export function websiteDocumentMerge(base,local,remote,choices,governed){
 if(base===local||local===remote)return literal(remote);
 const context={governed,nonce:'website-merge-'+crypto.randomUUID()+'-',ids:new Map(),live:new Map()};
 const branches=[base,local,remote].map((value,i)=>secureDocument(value,context,i===2));
 if(branches.some(doc=>!doc.documentElement))return literal(null);
 const mark=context.nonce,external=node=>node.nodeType===8&&node.data.startsWith(mark)?node.data:anchor(node);
 const clone=node=>node?.cloneNode(true)??null;
 function atomic(nodes,label,key){
  const values=nodes.map(htmlOf);
  if(values.some(v=>v?.includes(mark)))return ()=>clone(nodes[2]);
  const selected=choices.choose(key,'html',label,...values);
  return ()=>{const choice=selected();return clone(nodes[values.indexOf(choice)]);};
 }
 function ambiguousChildren(lists,maps,key,name,depth){
  const common=[...maps[0].keys()].filter(k=>maps[1].has(k)&&maps[2].has(k)),known=new Set(common);
  if(maps.some(map=>[...map.keys()].filter(k=>known.has(k)).some((k,i)=>k!==common[i])))return null;
  const cursors=[0,0,0],positions=lists.map(list=>new Map(list.map((node,i)=>[node,i]))),parts=[];
  for(const [index,anchor] of [...common,null].entries()){
   const nodes=lists.map((list,side)=>{
    const end=anchor===null?list.length:positions[side].get(maps[side].get(anchor));
    const run=list.slice(cursors[side],end);cursors[side]=end+1;return run;
   });
   const values=nodes.map(items=>items.map(htmlOf).join('')),label=name+' ['+(index+1)+']';
   const choose=values.some(v=>v.includes(mark))?literal(values[2]):choices.choose(key+'/group/'+index,'structure',label,...values);
   parts.push(()=>nodes[values.indexOf(choose())].map(clone));
   if(anchor!==null){const child=unit(maps.map(m=>m.get(anchor)),name,key+'/'+anchor,depth+1);parts.push(()=>[child()]);}
  }
  return ()=>parts.flatMap(run=>run());
 }
 function unit(nodes,label,key,depth){
  const values=nodes.map(htmlOf),[before,mine,theirs]=values;
  if(mine===before||mine===theirs)return ()=>clone(nodes[2]);
  if(theirs===before&&!values.some(v=>v?.includes(mark)))return ()=>clone(nodes[1]);
  if(nodes.some(n=>!n||n.nodeType!==1||kind(n)!==kind(nodes[0]))||depth>=64)return atomic(nodes,label,key);
  const lists=nodes.map(children),[original,mineNodes,theirNodes]=lists;
  const relevant=nodes[2].id?'#'+nodes[2].id:nodes[2].localName;
  const name=label?label+' › '+relevant:relevant;
  const localMap=align(original,mineNodes,external),remoteMap=align(original,theirNodes,external);
  const maps=[new Map(original.map((n,i)=>['base '+i,n])),...[[mineNodes,localMap.keys],[theirNodes,remoteMap.keys]].map(([list,keys],side)=>new Map(list.map((node,i)=>[keys.get(node)??('added '+side+'/'+i),node])))];
  let assemble;
  if(localMap.ambiguous||remoteMap.ambiguous){
   assemble=ambiguousChildren(lists,maps,key,name,depth);
   if(!assemble)return atomic(nodes,name,key);
  }else{
   const ordered=maps.map(m=>[...m.keys()]),keys=new Set(ordered.flat()),merged=new Map();
   const title=id=>{
    const node=maps[2].get(id)??maps[0].get(id)??maps[1].get(id);
    if(node.nodeType===8&&node.data.startsWith(mark))return '…';
    return (node.id?'#'+node.id:node.textContent.trim().slice(0,60)||node.nodeName);
   };
   const order=mergeOrder(...ordered,key,'structure',name,choices,title);
   for(const id of keys)merged.set(id,unit(maps.map(m=>m.get(id)),name,key+'/'+id,depth+1));
   assemble=()=>order().map(id=>merged.get(id)());
  }
  const attrs=new Set(nodes.flatMap(n=>[...n.attributes].map(a=>a.name))),valuesFor=new Map();
  for(const attr of attrs){
   const values=nodes.map(n=>n.getAttribute(attr));
   valuesFor.set(attr,attr.startsWith('data-website-theme')||attr==='data-website-page-theme'?literal(values[2]):choices.choose(key+'/@'+attr,'attribute',name+' · '+attr,...values));
  }
  return ()=>{
   const element=nodes[2].cloneNode(false);
   for(const [attr,get] of valuesFor){
    const value=get();if(value===null)element.removeAttribute(attr);else if(value!==element.getAttribute(attr))element.setAttribute(attr,value);
   }
   for(const node of assemble())if(node)(element.content??element).appendChild(node);
   return element;
  };
 }
 const result=unit(branches.map(d=>d.documentElement),'','html',0);
 return ()=>{
  const doc=branches[2].cloneNode(false),root=result();doc.appendChild(root);
  const live=new Set(),pending=[root];
  while(pending.length){
   const node=pending.pop();
   if(node.nodeType===8&&node.data.startsWith(mark)){
    const protectedNode=context.live.get(node.data);
    if(protectedNode&&!live.has(node.data)){live.add(node.data);node.replaceWith(clone(protectedNode));}
    else node.remove();
   }else{const kids=(node.content??node).childNodes;for(let i=kids.length-1;i>=0;i--)pending.push(kids[i]);}
  }
  if(live.size!==context.live.size)return null;
  return serializeWebsiteHTML(doc);
 };
}
