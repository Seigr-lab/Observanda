import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseFragment,serialize} from 'parse5';
import {AppError} from './errors.js';
import {validateWebsiteHTML} from './website-file-policy.js';
import {escapeWebsiteText} from './website-file-html.js';
import {attr,descendants} from './website-migration-views.js';

const layoutElements=new Set(('article section div header footer aside h1 h2 h3 h4 h5 h6 p span strong em b i small mark sup sub time a '+
 'ul ol li dl dt dd blockquote pre code br hr details summary figure figcaption table caption thead tbody tfoot tr th td').split(' '));
const flowContainers=new Set(['article','section','div','header','footer','aside','li','dd','blockquote','details','figure','td','th']);
const fields=new Set(['title','date','type','tags','content']);
const idRefs=new Set(['for','headers','list','aria-labelledby','aria-describedby','aria-details','aria-errormessage','aria-controls','aria-owns','aria-flowto','aria-activedescendant']);
const textNode=value=>({nodeName:'#text',value});
const invalid=()=>{throw new AppError('INVALID');};

function namespaceFragment(root,prefix){
 const ids=new Map(),used=new Set();
 for(const node of descendants(root)){
  const id=node.attrs?.find(a=>a.name==='id');if(!id)continue;
  const old=id.value;let unique=prefix+old;
  for(let n=2;used.has(unique);n++)unique=prefix+n+'-'+old;
  if(!ids.has(old))ids.set(old,unique);
  used.add(unique);id.value=unique;
 }
 for(const node of descendants(root))for(const a of node.attrs??[]){
  if(a.name==='href'&&a.value.startsWith('#')&&ids.has(a.value.slice(1)))a.value='#'+ids.get(a.value.slice(1));
  if(idRefs.has(a.name))a.value=a.value.replace(/\S+/gu,id=>ids.get(id)??id);
  if(a.value.includes('url('))a.value=a.value.replace(/url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/gu,(full,_,id)=>ids.has(id)?'url(#'+ids.get(id)+')':full);
 }
}

// The input is a grant-projected website fragment. Its anchors originally
// identified one document. Each repetition needs independent IDs on the page.
export function feedContentAtPage(html,page,instance,{omitTitle=false}={}){
 const root=parseFragment(html);
 if(omitTitle)root.childNodes=root.childNodes.filter(node=>attr(node,'data-observanda-part')!=='title');
 namespaceFragment(root,'feed-'+instance+'-content-');
 for(const node of descendants(root))for(const a of node.attrs??[]){
  if(['src','href','poster'].includes(a.name)&&/^assets\/[a-f0-9]{64}\.[a-z0-9]+$/i.test(a.value))a.value=path.posix.relative(path.posix.dirname(page),a.value);
 }
 return serialize(root);
}

// Compile only site-authored layout, never insert research into an attribute,
// URL, CSS rule or element name. Render metadata-only layouts without opening
// entry files. Validation also runs on templates saved through the HTTP API.
export function compileWebsiteFeedTemplate(itemHTML){
 if(typeof itemHTML!=='string'||!itemHTML.trim())invalid();
 if(Buffer.byteLength(itemHTML)>256*1024)throw new AppError('LIMIT');
 const marker='obfeed'+randomUUID().replaceAll('-',''),tokens=[],bound=new Set();
 function token(value){tokens.push(value);return marker+(tokens.length-1)+'x';}
 const root=parseFragment(itemHTML,{onParseError:invalid}),pending=[{node:root,depth:0}];
 while(pending.length){
  const {node,depth}=pending.pop();if(depth>128)throw new AppError('LIMIT');
  if(node.tagName){
   if(!layoutElements.has(node.tagName))invalid();
   for(const a of node.attrs){
    if(!['id','class','title','lang','dir','role','style','data-feed-field','datetime','colspan','rowspan','scope','headers','open','start','href','rel'].includes(a.name)&&!a.name.startsWith('aria-'))invalid();
    if(a.name==='style'&&(/\\|\/\*/u.test(a.value)||[...a.value.matchAll(/([\w-]+)\s*\(/gu)].some(([,fn])=>!['var','calc','min','max','clamp','repeat','minmax','rgb','rgba','hsl','hsla','color-mix'].includes(fn.toLowerCase()))))invalid();
    if(a.name==='href'&&(node.tagName!=='a'||!/^#|^https?:\/\/|^mailto:/iu.test(a.value)))invalid();
   }
   const slot=attr(node,'data-feed-field');
   if(slot!==undefined){
    if(!fields.has(slot)||node.childNodes.some(child=>child.nodeName!=='#text'||child.value.trim())||
       ['br','hr'].includes(node.tagName)||slot==='content'&&!flowContainers.has(node.tagName)||
       ['ol','ul'].includes(node.tagName)&&slot!=='tags')invalid();
    bound.add(slot);node.childNodes=[textNode(token({field:slot,list:node.tagName==='ul'||node.tagName==='ol'}))];continue;
   }
  }
  for(const child of node.childNodes??[])pending.push({node:child,depth:depth+1});
 }
 if(!bound.size)invalid();
 const scopeToken=token({prefix:true});namespaceFragment(root,scopeToken);
 const layout=serialize(root);validateWebsiteHTML('<!doctype html><html><body>'+layout+'</body></html>');
 const program=[],pattern=new RegExp(marker+'(\\d+)x','g');let last=0;
 for(const match of layout.matchAll(pattern)){program.push(layout.slice(last,match.index),tokens[Number(match[1])]);last=match.index+match[0].length;}
 program.push(layout.slice(last));
 return {needsContent:bound.has('content'),render(input){
  const {row,page,instance}=input;
  if(typeof instance!=='string'||!/^[a-zA-Z0-9_-]+$/.test(instance))invalid();
  let contentIndex=0;
  return program.map(part=>{
   if(typeof part==='string')return part;
   if(part.prefix)return 'feed-'+instance+'-layout-';
   if(part.field==='content')return feedContentAtPage(input.html??'',page,instance+'-'+(++contentIndex),{omitTitle:bound.has('title')});
   if(part.field==='tags')return (row.tags??[]).map(tag=>part.list?'<li>'+escapeWebsiteText(tag)+'</li>':'<span class="website-feed-tag">'+escapeWebsiteText(tag)+'</span>').join(part.list?'':' ');
   const value=part.field==='title'?row.title:part.field==='date'?row.displayDate:row.recordType;
   return escapeWebsiteText(value??'');
  }).join('');
 }};
}
