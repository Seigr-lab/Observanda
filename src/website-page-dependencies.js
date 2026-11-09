import {parse} from 'parse5';
import {websiteLocalURL} from './website-file-policy.js';
import {decodedWebsiteCSS,websiteCSSURLs,websiteCSSURLTokens} from './web/website-css-urls.js';
import {digest} from './storage-format.js';

const resourceAttributes=new Set(['href','src','poster','background','srcset']);
function styleReferences(css,file,add){
 for(const url of websiteCSSURLs(decodedWebsiteCSS(css))){
  const name=websiteLocalURL(url,file);if(name)add('asset',name);
 }
}
function visitHTML(html,file,visitor,locations=false){
 const root=parse(html,{sourceCodeLocationInfo:locations}),pending=[{node:root,menu:false}];
 while(pending.length){
  const {node,menu}=pending.pop(),inMenu=menu||node.tagName==='nav';
  const references=[];
  const add=(kind,name,attribute)=>references.push({kind,name,attribute});
  for(const attr of node.attrs??[]){
   if(attr.name==='style')styleReferences(attr.value,file,(kind,name)=>add(kind,name,'style'));
   if(!resourceAttributes.has(attr.name))continue;
   const name=websiteLocalURL(attr.value,file);
   if(name)add(node.tagName==='a'&&attr.name==='href'?(inMenu?'menu':'link'):'asset',name,attr.name);
  }
  if(node.tagName==='style')styleReferences((node.childNodes??[]).map(child=>child.value??'').join(''),file,add);
  if(visitor(node,references)===false)continue;
  if(node.content)pending.push({node:node.content,menu:inMenu});
  for(const child of node.childNodes??[])if(child.tagName)pending.push({node:child,menu:inMenu});
 }
}
// Record only file names and relation types. Authors may use the same link
// dozens of times. One compact count suffices to review all occurrences.
export function websiteFileReferences(text,file){
 const refs=new Map();
 function add(kind,name){
  const key=kind+'\0'+name,prior=refs.get(key);
  if(prior)prior.count++;else refs.set(key,{kind,name,count:1});
 }
 if(file.endsWith('.css'))styleReferences(text,file,add);
 if(file.endsWith('.html'))visitHTML(text,file,(_node,list)=>{for(const {kind,name} of list)add(kind,name);});
 return [...refs.values()].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:a.kind.localeCompare(b.kind,'en'));
}
// A private target's name and anchor text stay solely in the authored file.
// Moving the page back into publication immediately restores the current
// authored link, including edits made while the target was private.
export function omitPrivatePageLinks(html,file,blocked){
 const cuts=[];
 visitHTML(html,file,(node,refs)=>{
  const affected=refs.filter(r=>blocked.has(r.name.toLowerCase()));
  if(!affected.length)return;
  const loc=node.sourceCodeLocation;if(!loc)return;
  const resource=affected.some(r=>r.attribute&&r.attribute!=='style');
  if(resource&&['a','link','img','source','track','script','video','audio','area'].includes(node.tagName)){
   cuts.push([loc.startOffset,loc.endOffset,'']);return false;
  }
  if(node.tagName==='style'&&affected.some(r=>!r.attribute)&&loc.endTag){
   const from=loc.startTag.endOffset,to=loc.endTag.startOffset;
   cuts.push([from,to,omitPrivateStyleURLs(html.slice(from,to),file,blocked)]);
  }
  for(const attr of new Set(affected.map(r=>r.attribute).filter(Boolean))){
   const attribute=loc.attrs?.[attr];if(attribute)cuts.push([attribute.startOffset,attribute.endOffset,'']);
  }
 },true);
 if(!cuts.length)return html;
 cuts.sort((a,b)=>a[0]-b[0]);const parts=[];let at=0;
 for(const [from,to,value] of cuts){parts.push(html.slice(at,from),value);at=to;}
 parts.push(html.slice(at));return parts.join('');
}

// Keep unrelated CSS byte-for-byte, including quoted font names and author
// comments. Map only the URL ranges back through the CSS policy's decoding.
function replaceMapped(input,pattern,replacement){
 const parts=[],spans=[];let at=0,delta=0;
 for(const match of input.matchAll(pattern)){
  const value=replacement(match),start=match.index-delta;
  parts.push(input.slice(at,match.index),value);at=match.index+match[0].length;
  delta+=match[0].length-value.length;
  spans.push({start,end:start+value.length,from:match.index,to:at,delta});
 }
 if(!spans.length)return {text:input,origin:i=>i};
 parts.push(input.slice(at));
 function origin(i,end){
  let lo=0,hi=spans.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(end?spans[mid].start<i:spans[mid].start<=i)lo=mid+1;else hi=mid;}
  const span=spans[lo-1];
  return !span?i:i<span.end?(end?span.to:span.from):i+span.delta;
 }
 return {text:parts.join(''),origin};
}
function* authoredCSSRanges(css){
 for(let i=0;i<css.length;i++){
  if(css[i]==='\\'){i++;continue;}
  if(css[i]==='/'&&css[i+1]==='*'){
   const start=i,end=css.indexOf('*/',i+2);i=end===-1?css.length:end+1;yield [start,i];continue;
  }
  const quote=css[i];if(quote!=='"'&&quote!=="'")continue;
  const start=i;
  while(++i<css.length){if(css[i]==='\\')i++;else if(css[i]===quote||css[i]==='\n'||css[i]==='\r'||css[i]==='\f')break;}
  yield [start,i];
 }
}
function originalStyleOffsets(css){
 const comments=replaceMapped(css,/\/\*[\s\S]*?\*\//g,()=>'');
 const hex=replaceMapped(comments.text,/\\([a-f0-9]{1,6})\s?/gi,m=>String.fromCodePoint(Math.min(parseInt(m[1],16),0x10ffff)));
 const escapes=replaceMapped(hex.text,/\\([^\r\n])/g,m=>m[1]);
 return (offset,end)=>comments.origin(hex.origin(escapes.origin(offset,end),end),end);
}
export function replaceWebsiteStyleURLs(css,replacement,{authoredOnly=false}={}){
 const parts=[],ranges=authoredOnly?authoredCSSRanges(css):null;
 let at=0,original,range;
 for(const token of websiteCSSURLTokens(decodedWebsiteCSS(css))){
  const value=replacement(token.value);if(value===undefined)continue;
  original??=originalStyleOffsets(css);
  const start=original(token.start,false);
  if(ranges){
   range??=ranges.next();
   while(!range.done&&range.value[1]<start)range=ranges.next();
   if(!range.done&&range.value[0]<=start||start>0&&/[\w-]/.test(css[start-1]))continue;
  }
  parts.push(css.slice(at,start),value);at=original(token.end,true);
 }
 if(!parts.length)return css;
 parts.push(css.slice(at));return parts.join('');
}
export function omitPrivateStyleURLs(css,file,blocked){
 return replaceWebsiteStyleURLs(css,url=>blocked.has(websiteLocalURL(url,file)?.toLowerCase())?'none':undefined);
}

export function privateWebsiteNames(manifest){return new Set(manifest.files.filter(file=>file.draft).map(file=>file.name.toLowerCase()));}
export async function fileReferences(store,file,signal){
 if(file.references)return file.references;
 return /\.(?:css|html)$/.test(file.name)?websiteFileReferences(await store.readText(file,{signal}),file.name):[];
}
export function publicText(text,name,blocked){
 return name.endsWith('.html')?omitPrivatePageLinks(text,name,blocked):omitPrivateStyleURLs(text,name,blocked);
}
export async function preparePublicPageFiles(store,manifest,signal){
 const blocked=privateWebsiteNames(manifest),prior=new Map((manifest.publicPageFiles??[]).map(row=>[row.file.name,row])),outputs=[];
 const files=[];
 for(let file of manifest.files){
  signal?.throwIfAborted();
  if(blocked.size&&!file.draft&&/\.(?:html|css)$/.test(file.name)){
   const refs=await fileReferences(store,file,signal);
   if(!file.references)file={...file,references:refs};
   const withheld=refs.filter(r=>blocked.has(r.name.toLowerCase())).map(r=>r.name);
   if(withheld.length){
    const pin=digest(JSON.stringify([file.sha256,withheld])),saved=prior.get(file.name);
    if(saved?.pin===pin)outputs.push(saved);
    else{
     const original=await store.readText(file,{signal}),value=publicText(original,file.name,blocked);
     outputs.push({pin,file:await store.siteFile(manifest.id,file.name,value,{signal})});
    }
   }
  }
  files.push(file);
 }
 return {...manifest,files,publicPageFiles:outputs};
}
