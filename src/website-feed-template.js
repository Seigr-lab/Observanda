import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseFragment,serialize,serializeOuter} from 'parse5';
import {AppError} from './errors.js';
import {validateWebsiteHTML,websiteHTMLByteLimit} from './website-file-policy.js';
import {escapeWebsiteText} from './website-file-html.js';
import {attr,descendants} from './website-migration-views.js';
import {feedFields} from './web/website-feed-fields.js';

const layoutElements=new Set(('article section div header footer aside h1 h2 h3 h4 h5 h6 p span strong em b i small mark sup sub time a '+
 'ul ol li dl dt dd blockquote pre code br hr details summary figure figcaption table caption thead tbody tfoot tr th td').split(' '));
const flowContainers=new Set(['article','section','div','header','footer','aside','li','dd','blockquote','details','figure','td','th']);
const richField=field=>Object.hasOwn(feedFields,field)&&feedFields[field].tag==='div';
const idRefs=new Set(['for','headers','list','aria-labelledby','aria-describedby','aria-details','aria-errormessage','aria-controls','aria-owns','aria-flowto','aria-activedescendant']);
const textNode=value=>({nodeName:'#text',value});
const invalid=()=>{throw new AppError('INVALID');};

function namespaceFragment(root,prefix,related){
 const ids=new Map(),used=new Set();
 for(const node of descendants(root)){
  const id=node.attrs?.find(a=>a.name==='id');if(!id)continue;
  const old=id.value;let unique=prefix+old;
  for(let n=2;used.has(unique);n++)unique=prefix+n+'-'+old;
  if(!ids.has(old))ids.set(old,unique);
  used.add(unique);id.value=unique;
 }
 const scoped=id=>ids.get(id)??related?.get(id);
 for(const node of descendants(root))for(const a of node.attrs??[]){
  if(a.name==='href'&&a.value.startsWith('#')&&scoped(a.value.slice(1)))a.value='#'+scoped(a.value.slice(1));
  if(idRefs.has(a.name))a.value=a.value.replace(/\S+/gu,id=>scoped(id)??id);
  if(a.value.includes('url('))a.value=a.value.replace(/url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/gu,(full,_,id)=>scoped(id)?'url(#'+scoped(id)+')':full);
 }
}

// The input is a grant-projected website fragment. Its anchors originally
// identified one document. Each repetition needs independent IDs on the page.
export function feedContentAtPage(html,page,instance,{omitTitle=false,related}={}){
 const root=parseFragment(html);
 if(omitTitle)root.childNodes=root.childNodes.filter(node=>attr(node,'data-observanda-part')!=='title');
 namespaceFragment(root,'feed-'+instance+'-content-',related);
 for(const node of descendants(root))for(const a of node.attrs??[]){
  if(['src','href','poster'].includes(a.name)&&/^assets\/[a-f0-9]{64}\.[a-z0-9]+$/i.test(a.value))a.value=path.posix.relative(path.posix.dirname(page),a.value);
 }
 return serialize(root);
}

// Work only with the published parts already in the granted HTML. A table
// inside a result and a photograph inside a section retain their captions.
function selectedParts(html,bound){
 const values=new Map(),wanted=[...bound].filter(key=>richField(key)&&key!=='content');
 if(!wanted.length)return values;
 const root=parseFragment(html);
 function visit(node,remaining){
  if(node.attrs?.some(a=>a.name==='hidden'||a.name==='aria-hidden'&&a.value==='true')||node.tagName==='template')return;
  const key=attr(node,'data-observanda-part')??'';
  const matches=remaining.filter(field=>field==='tables'?node.tagName==='table':field==='figures'?key.startsWith('figure:')||key.startsWith('media:'):
   field==='sections'?key.startsWith('section:'):field==='results'?key==='results'||key==='outcome':key===field);
  if(matches.length){
   const markup=serializeOuter(node);
   for(const field of matches)values.get(field).push(markup);
   remaining=remaining.filter(field=>!matches.includes(field));
  }
  if(remaining.length)for(const child of node.childNodes??[])visit(child,remaining);
 }
 for(const key of wanted)values.set(key,[]);
 visit(root,wanted);
 for(const [key,parts] of values)values.set(key,parts.join(''));
 return values;
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
    if(!Object.hasOwn(feedFields,slot)||node.childNodes.some(child=>child.nodeName!=='#text'||child.value.trim())||
       ['br','hr'].includes(node.tagName)||richField(slot)&&!flowContainers.has(node.tagName)||
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
 const needsContent=[...bound].some(richField);
 const slots=program.filter(part=>richField(part?.field));
 return {needsContent,render(input){
  const {row,page,instance,maxBytes=websiteHTMLByteLimit}=input;
  if(typeof instance!=='string'||!/^[a-zA-Z0-9_-]+$/.test(instance))invalid();
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>websiteHTMLByteLimit)invalid();
  let contentIndex=0,bytes=0;
  const html=needsContent?input.html??'':'',parts=selectedParts(html,bound);
  const fragment=field=>field==='content'?html:parts.get(field);
  const related=new Map();
  if(parts.size&&slots.length>1){
   const seen=new Set();let position=0;
   for(const {field} of slots){
    const markup=fragment(field);if(!markup)continue;
    position++;if(seen.has(field))continue;seen.add(field);
    for(const node of descendants(parseFragment(markup))){
     const id=attr(node,'id');if(id&&!related.has(id))related.set(id,'feed-'+instance+'-'+position+'-content-'+id);
    }
   }
  }
  function renderPart(part){
   if(typeof part==='string')return part;
   if(part.prefix)return 'feed-'+instance+'-layout-';
   if(richField(part.field)){
    const markup=fragment(part.field);
    return markup?feedContentAtPage(markup,page,instance+'-'+(++contentIndex),{omitTitle:bound.has('title'),related}):'';
   }
   if(part.field==='tags')return (row.tags??[]).map(tag=>part.list?'<li>'+escapeWebsiteText(tag)+'</li>':'<span class="website-feed-tag">'+escapeWebsiteText(tag)+'</span>').join(part.list?'':' ');
   const value=part.field==='title'?row.title:part.field==='date'?row.displayDate:row.recordType;
   return escapeWebsiteText(value??'');
  }
  return program.map(part=>{
   const output=renderPart(part);bytes+=Buffer.byteLength(output);
   if(bytes>maxBytes)throw new AppError('WEBSITE_FEED_CAPACITY');
   return output;
  }).join('');
 }};
}
