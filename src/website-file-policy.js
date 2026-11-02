import path from 'node:path';
import {parse} from 'parse5';
import {AppError} from './errors.js';
import {outputName} from './local-export-files.js';

const forbidden=new Set(['base','iframe','frame','frameset','object','embed','portal','fencedframe','foreignObject','animate','animateMotion','animateTransform','set']);
const resources=new Set(['src','poster','background','action','formaction','srcset']);
export const websiteFileName=outputName;
function localURL(value,file){
 const url=String(value).trim();if(url.startsWith('#'))return '';
 if(!url||/[\\\u0000-\u0020%:]/.test(url)||url.startsWith('/')||url.includes('?'))return null;
 const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(file),url.split('#')[0]));
 try{websiteFileName(resolved);return /^(?:api|\.observanda)(?:\/|$)/i.test(resolved)?null:resolved;}catch{return null;}
}
export function validateWebsiteCSS(css,{file='style.css'}={}){
 if(typeof css!=='string'||Buffer.byteLength(css)>16*1024*1024)throw new AppError('LIMIT');
 const decoded=css.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\\([a-f0-9]{1,6})\s?/gi,(_,hex)=>String.fromCodePoint(Math.min(parseInt(hex,16),0x10ffff))).replace(/\\([^\r\n])/g,'$1');
 if(/@import\b|(?:image-set|cross-fade|expression|src)\s*\(|-moz-binding\s*:|(?:^|[;{])\s*behavior\s*:/i.test(decoded))throw new AppError('INVALID');
 for(const match of decoded.matchAll(/url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi))if(localURL(match[1]??match[2]??match[3],file)===null)throw new AppError('INVALID');
 return css;
}
function externalLink(value){
 try{const url=new URL(value);return url.protocol==='mailto:'||['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!/^(?:localhost|127\.|\[::1\])/.test(url.hostname)&&!/^\/api(?:\/|$)/i.test(url.pathname);}catch{return false;}
}
export function validateWebsiteHTML(html,{scripts=new Set(),file='index.html'}={}){
 if(typeof html!=='string'||Buffer.byteLength(html)>16*1024*1024)throw new AppError('LIMIT');
 const root=parse(html);
 function visit(node){
  if(forbidden.has(node.tagName)||node.tagName==='meta'&&node.attrs?.some(attr=>attr.name==='http-equiv'))throw new AppError('INVALID');
  if(node.tagName==='script'){
   const src=node.attrs?.find(attr=>attr.name==='src')?.value;
   if(!src||!scripts.has(localURL(src,file))||(node.childNodes??[]).some(child=>(child.value??'').trim()))throw new AppError('INVALID');
  }
  for(const {name,value} of node.attrs??[]){
   if(/^on/i.test(name)||['srcdoc','formaction','ping','is','action'].includes(name))throw new AppError('INVALID');
   if(name==='style')validateWebsiteCSS(value,{file});
   if(resources.has(name)&&value&&localURL(value,file)===null)throw new AppError('INVALID');
   if(name==='href'){
    if(node.tagName==='link'){if(localURL(value,file)===null||!['stylesheet','icon','alternate'].includes(node.attrs.find(attr=>attr.name==='rel')?.value))throw new AppError('INVALID');}
    else if(value&&localURL(value,file)===null&&(node.tagName!=='a'||!externalLink(value)))throw new AppError('INVALID');
   }
  }
  if(node.tagName==='style')validateWebsiteCSS((node.childNodes??[]).map(child=>child.value??'').join(''),{file});
  for(const child of node.childNodes??[])visit(child);if(node.content)visit(node.content);
 }
 visit(root);return html;
}
