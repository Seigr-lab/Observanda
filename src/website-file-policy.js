import path from 'node:path';
import {parse} from 'parse5';
import {AppError} from './errors.js';
import {outputName} from './local-export-files.js';
import {safeEquationElement} from './web/website-equation-markup.js';
import {decodedWebsiteCSS,websiteCSSURLs} from './web/website-css-urls.js';

const forbidden=new Set(['base','iframe','frame','frameset','object','embed','portal','fencedframe','foreignObject','animate','animateMotion','animateTransform','set']);
const generatedPolicy="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; connect-src 'self'";
const resources=new Set(['src','poster','background','action','formaction','srcset']);
export const websiteFileName=outputName;
function localURL(value,file){
 const url=String(value).trim();if(url.startsWith('#'))return '';
 if(!url||/[\\\u0000-\u0020%:]/.test(url)||url.startsWith('/')||url.includes('?'))return null;
 const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(file),url.split('#')[0]));
 try{websiteFileName(resolved);return /^(?:api|\.observanda)(?:\/|$)/i.test(resolved)?null:resolved;}catch{return null;}
}
export function validateWebsiteCSS(css,{file='style.css',pictures}={}){
 if(typeof css!=='string'||Buffer.byteLength(css)>16*1024*1024)throw new AppError('LIMIT');
 const decoded=decodedWebsiteCSS(css);
 if(/@import\b|(?:image-set|cross-fade|expression|src)\s*\(|-moz-binding\s*:|(?:^|[;{])\s*behavior\s*:/i.test(decoded))throw new AppError('INVALID');
 for(const url of websiteCSSURLs(decoded)){
  const name=localURL(url,file);if(name===null)throw new AppError('INVALID');if(name.startsWith('pictures/'))pictures?.add(name);
 }
 return css;
}
function externalLink(value){
 try{const url=new URL(value);return url.protocol==='mailto:'||['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!/^(?:localhost|127\.|\[::1\])/.test(url.hostname)&&!/^\/api(?:\/|$)/i.test(url.pathname);}catch{return false;}
}
export const websiteHTMLByteLimit=16*1024*1024;
export function validateWebsiteHTML(html,{scripts=new Set(),file='index.html',pictures,recordings}={}){
 if(typeof html!=='string'||Buffer.byteLength(html)>websiteHTMLByteLimit)throw new AppError('LIMIT');
 const root=parse(html);
 function visit(node,inPlacement=false,inEquation=false,inMath=false){
  inPlacement ||= node.attrs?.some(attr=>attr.name==='data-observanda-source'||attr.name==='data-observanda-link')??false;
  inEquation ||= node.attrs?.some(attr=>attr.name==='data-website-equation')??false;
  inMath ||= inEquation&&node.tagName==='math';
  if(node.tagName&&inMath&&!safeEquationElement(node.tagName,node.namespaceURI,node.attrs))throw new AppError('INVALID');
  if(forbidden.has(node.tagName))throw new AppError('INVALID');
  if(node.tagName==='meta'&&node.attrs?.some(attr=>attr.name==='http-equiv')){
   if(node.attrs.find(attr=>attr.name==='http-equiv').value.toLowerCase()!=='content-security-policy'||node.attrs.find(attr=>attr.name==='content')?.value!==generatedPolicy)throw new AppError('INVALID');
  }
  if(node.tagName==='script'){
   const src=node.attrs?.find(attr=>attr.name==='src')?.value;
   if(!src||!scripts.has(localURL(src,file))||(node.childNodes??[]).some(child=>(child.value??'').trim()))throw new AppError('INVALID');
  }
  for(const {name,value} of node.attrs??[]){
   if(/^on/i.test(name)||['srcdoc','formaction','ping','is','action'].includes(name))throw new AppError('INVALID');
   if(name==='style')validateWebsiteCSS(value,{file,pictures});
   if(pictures&&(resources.has(name)||name==='href')){const resource=localURL(value,file);if(resource?.startsWith('pictures/'))pictures.add(resource);}
   if(recordings&&(resources.has(name)||name==='href')){
    const resource=localURL(value,file);if(resource?.startsWith('recordings/')){
     if(inPlacement)throw new AppError('INVALID');recordings.add(resource);
    }
   }
   if(resources.has(name)&&value&&localURL(value,file)===null)throw new AppError('INVALID');
   if(name==='href'){
    if(node.tagName==='link'){if(localURL(value,file)===null||!['stylesheet','icon','alternate','canonical'].includes(node.attrs.find(attr=>attr.name==='rel')?.value))throw new AppError('INVALID');}
    else if(value&&localURL(value,file)===null&&(node.tagName!=='a'||!externalLink(value)))throw new AppError('INVALID');
   }
  }
  if(node.tagName==='style')validateWebsiteCSS((node.childNodes??[]).map(child=>child.value??'').join(''),{file,pictures});
  for(const child of node.childNodes??[])visit(child,inPlacement,inEquation,inMath);if(node.content)visit(node.content,inPlacement,inEquation,inMath);
 }
 visit(root);return html;
}
