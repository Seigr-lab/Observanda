import path from 'node:path';
import {parse} from 'parse5';
import {websiteLocalURL,websiteFileName} from './website-file-policy.js';
import {AppError} from './errors.js';
import {escapeWebsiteText} from './website-file-html.js';
import {replaceWebsiteStyleURLs} from './website-page-dependencies.js';
import {digest} from './storage-format.js';

const pathAttributes=new Set(['href','src','poster','background','srcset']);
export const websitePageIdentity=(site,page)=>page.pageId??digest(JSON.stringify(['website-page',site,page.path]));

export function assertPageDestination(manifest,destination,collision='EXISTS'){
 websiteFileName(destination);
 if(!destination.endsWith('.html')||destination.includes('#')||websiteLocalURL(destination,'index.html')!==destination||/^(?:feeds|pictures|recordings|assets|website-themes)\//i.test(destination))throw new AppError('INVALID');
 const target=destination.normalize('NFC').toLowerCase();
 for(const file of manifest.files){
  const existing=file.name.normalize('NFC').toLowerCase();
  if(existing===target||existing.startsWith(target+'/')||target.startsWith(existing+'/'))throw new AppError(collision);
 }
}

// A move changes both the address other documents use to reach the page and
// the base against which the moved document's own links resolve.
export function movedWebsiteURL(value,from,to,moved,destination){
 const target=websiteLocalURL(value,from);
 if(!target)return value;
 const name=moved instanceof Map?moved.get(target.toLowerCase())??target:target.toLowerCase()===moved.toLowerCase()?destination:target;
 if(websiteLocalURL(value,to)===name)return value;
 const fragment=value.indexOf('#');
 return path.posix.relative(path.posix.dirname(to),name)+(fragment<0?'':value.slice(fragment).trimEnd());
}

export function movedWebsiteText(text,from,to,moved,destination){
 const rebase=value=>movedWebsiteURL(value,from,to,moved,destination);
 const style=css=>replaceWebsiteStyleURLs(css,value=>{
  const url=rebase(value);
  if(url!==value)return 'url("'+url.replaceAll('\\','\\\\').replaceAll('"','\\"')+'")';
 },{authoredOnly:true});
 if(from.endsWith('.css'))return style(text);
 const edits=[],pending=[parse(text,{sourceCodeLocationInfo:true})];
 while(pending.length){
  const node=pending.pop(),loc=node.sourceCodeLocation;
  if(node.tagName==='style'&&loc?.endTag){
   const start=loc.startTag.endOffset,end=loc.endTag.startOffset,css=text.slice(start,end),replacement=style(css);
   if(replacement!==css)edits.push({start,end,replacement});
  }
  for(const attr of node.attrs??[]){
   const location=loc?.attrs?.[attr.name];
   if(!location)continue;
   const value=attr.name==='style'?style(attr.value):pathAttributes.has(attr.name)?rebase(attr.value):attr.value;
   if(value!==attr.value){
    const name=attr.prefix?attr.prefix+':'+attr.name:attr.name;
    edits.push({start:location.startOffset,end:location.endOffset,replacement:name+'="'+escapeWebsiteText(value)+'"'});
   }
  }
  if(node.content)pending.push(node.content);
  for(const child of node.childNodes??[])if(child.tagName)pending.push(child);
 }
 if(!edits.length)return text;
 edits.sort((a,b)=>a.start-b.start);
 const parts=[];let at=0;
 for(const {start,end,replacement} of edits){parts.push(text.slice(at,start),replacement);at=end;}
 parts.push(text.slice(at));return parts.join('');
}

export function namedWebsitePage(html,title){
 const document=parse(html,{sourceCodeLocationInfo:true});
 const head=document.childNodes.find(n=>n.tagName==='html')?.childNodes.find(n=>n.tagName==='head');
 const current=head?.childNodes.find(n=>n.tagName==='title'),loc=current?.sourceCodeLocation;
 const escaped=escapeWebsiteText(title);
 if(loc?.endTag){
  if(current.attrs.some(a=>a.name.startsWith('data-observanda-'))){
   return html.slice(0,loc.startOffset)+'<title>'+escaped+'</title>'+html.slice(loc.endOffset);
  }
  return html.slice(0,loc.startTag.endOffset)+escaped+html.slice(loc.endTag.startOffset);
 }
 const at=head?.sourceCodeLocation?.startTag?.endOffset;
 if(Number.isInteger(at))return html.slice(0,at)+'<title>'+escaped+'</title>'+html.slice(at);
 const htmlStart=head?.parentNode?.sourceCodeLocation?.startTag?.endOffset;
 const afterDoctype=document.childNodes.find(n=>n.nodeName==='#documentType')?.sourceCodeLocation?.endOffset??0;
 const start=htmlStart??afterDoctype;
 return html.slice(0,start)+'<head><title>'+escaped+'</title></head>'+html.slice(start);
}
