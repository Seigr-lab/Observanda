import {decodedWebsiteCSS,websiteCSSURLs} from './website-css-urls.js';
import {websiteHTML} from './website-html-document.js';

// Consult the store for resources the historical document actually uses.
// An author may also write an image's filename as ordinary paragraph text.
export function websiteHistoryMedia(html,css,page,stylesheet,pending){
 const result=new Set(),origin='https://website.invalid';
 const add=(value,base)=>{
  try{
   const url=new URL(value,new URL(base,origin)),name=url.pathname.slice(1);
   if(url.origin===origin&&/^(?:pictures|recordings)\//.test(name)&&!pending(name))result.add(name);
  }catch{}
 };
 const styles=(value,base)=>{for(const url of websiteCSSURLs(decodedWebsiteCSS(value)))add(url,base);};
 styles(css,stylesheet);
 const roots=[websiteHTML(html)];
 for(let i=0;i<roots.length;i++){
  for(const node of roots[i].querySelectorAll('[src],[href],[poster],[background],[srcset],[style],style,template')){
   if(node.localName==='template')roots.push(node.content);
   for(const attr of ['src','href','poster','background','srcset'])if(node.hasAttribute(attr))add(node.getAttribute(attr),page);
   if(node.hasAttribute('style'))styles(node.getAttribute('style'),page);
   if(node.localName==='style')styles(node.textContent,page);
  }
 }
 return [...result];
}
