import path from 'node:path';
import {parse} from 'parse5';
import {AppError} from './errors.js';
import {outputName} from './local-export-files.js';
import {safeEquationElement} from './web/website-equation-markup.js';
import {imageCandidates,imageResourceURLs} from './web/website-image-candidates.js';
import {websiteReferencePath} from './web/website-local-fragment.js';
import {decodedWebsiteCSS,websiteCSSURLs,websiteCSSURLTokens,websiteCSSSourceRange,websiteCSSByteLimit} from './web/website-css-urls.js';

const forbidden=new Set(['base','iframe','frame','frameset','object','embed','portal','fencedframe','foreignObject','animate','animateMotion','animateTransform','set']);
const generatedPolicy="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; connect-src 'self'";
const resources=new Set(['src','poster','background','action','formaction','srcset']);
export const websiteFileName=outputName;
export function websiteLocalURL(value,file){
 const local=websiteReferencePath(String(value).trim());if(local===null||!local)return local;
 const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(file),local));
 try{websiteFileName(resolved);return /^(?:api|\.observanda)(?:\/|$)/i.test(resolved)?null:resolved;}catch{return null;}
}
const localURL=websiteLocalURL;
// An incomplete code edit is stored as private text and never rendered.
// Identify its owned-media references separately from the admission that an
// actual editable or published document must pass.
export function draftWebsiteMediaReferences(html,css,page,style){
 const pictures=new Set(),recordings=new Set();
 const add=(value,base)=>{const name=localURL(value,base);if(name?.startsWith('pictures/'))pictures.add(name);else if(name?.startsWith('recordings/'))recordings.add(name);};
 const stylesheet=(text,base)=>{for(const url of websiteCSSURLs(decodedWebsiteCSS(text)))add(url,base);};
 stylesheet(css,style);
 const pending=[parse(html)];
 while(pending.length){
  const node=pending.pop();
  for(const attr of node.attrs??[]){
   if(resources.has(attr.name)||attr.name==='href')for(const url of imageResourceURLs(attr.name,attr.value))add(url,page);
   if(attr.name==='style')stylesheet(attr.value,page);
  }
  if(node.tagName==='style')stylesheet((node.childNodes??[]).map(n=>n.value??'').join(''),page);
  for(const child of node.childNodes??[])if(child.tagName)pending.push(child);
  if(node.content)pending.push(node.content);
 }
 return {pictures,recordings};
}
function invalidSource(kind,reason,start,end){
 const error=new AppError('INVALID');
 if(Number.isSafeInteger(start)&&Number.isSafeInteger(end))error.sourceDiagnostic={kind,reason,start,end};
 throw error;
}
export function validateWebsiteCSS(css,{file='style.css',pictures,diagnose=false}={}){
 if(typeof css!=='string'||Buffer.byteLength(css)>websiteCSSByteLimit)throw new AppError('LIMIT');
 const decoded=decodedWebsiteCSS(css);
 function reject(reason,start,end){
  if(diagnose){const range=websiteCSSSourceRange(css,start,end);invalidSource('css',reason,range.start,range.end);}
  throw new AppError('INVALID');
 }
 const feature=/@import\b|(?:image-set|cross-fade|expression|src)\s*\(|-moz-binding\s*:|(?:^|[;{])\s*behavior\s*:/i.exec(decoded);
 if(feature)reject('cssFeature',feature.index,feature.index+feature[0].length);
 for(const token of websiteCSSURLTokens(decoded)){
  const name=localURL(token.value,file);if(name===null)reject('localResource',token.start,token.end);if(name.startsWith('pictures/'))pictures?.add(name);
 }
 return css;
}
function externalLink(value){
 try{const url=new URL(value);return url.protocol==='mailto:'||['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!/^(?:localhost|127\.|\[::1\])/.test(url.hostname)&&!/^\/api(?:\/|$)/i.test(url.pathname);}catch{return false;}
}
export const websiteHTMLByteLimit=16*1024*1024;
export function validateWebsiteHTML(html,{scripts=new Set(),file='index.html',pictures,recordings,diagnose=false,tree}={}){
 if(typeof html!=='string'||Buffer.byteLength(html)>websiteHTMLByteLimit)throw new AppError('LIMIT');
 const root=tree??parse(html,diagnose?{sourceCodeLocationInfo:true}:undefined);
 function visit(node,inPlacement=false,inEquation=false,inMath=false){
  const reject=(reason,attribute)=>{
   const location=node.sourceCodeLocation;
   const span=attribute&&location?.attrs?.[attribute]||location?.startTag||location;
   invalidSource('html',reason,span?.startOffset,span?.endOffset);
  };
  inPlacement ||= node.attrs?.some(attr=>attr.name==='data-observanda-source'||attr.name==='data-observanda-link')??false;
  inEquation ||= node.attrs?.some(attr=>attr.name==='data-website-equation')??false;
  inMath ||= inEquation&&node.tagName==='math';
  if(node.tagName&&inMath&&!safeEquationElement(node.tagName,node.namespaceURI,node.attrs))reject('equation');
  if(forbidden.has(node.tagName))reject('element');
  if(node.tagName==='meta'&&node.attrs?.some(attr=>attr.name==='http-equiv')){
   if(node.attrs.find(attr=>attr.name==='http-equiv').value.toLowerCase()!=='content-security-policy')reject('documentPolicy','http-equiv');
   if(node.attrs.find(attr=>attr.name==='content')?.value!==generatedPolicy)reject('documentPolicy','content');
  }
  if(node.tagName==='script'){
   const src=node.attrs?.find(attr=>attr.name==='src')?.value;
   if(!src||!scripts.has(localURL(src,file))||(node.childNodes??[]).some(child=>(child.value??'').trim()))reject('script',src?'src':null);
  }
  for(const {name,value} of node.attrs??[]){
   if(/^on/i.test(name)||['srcdoc','formaction','ping','is','action'].includes(name))reject('attribute',name);
   if(name==='srcset'){
    const candidates=imageCandidates(value);
    if(!['img','source'].includes(node.tagName)||node.tagName==='source'&&node.parentNode?.tagName!=='picture'||!candidates)reject('localResource',name);
    if(node.attrs.some(a=>a.name==='sizes')&&candidates.some(c=>!c.descriptor.endsWith('w')))reject('attribute','sizes');
    for(const {url} of candidates){
     const resource=localURL(url,file);if(!resource||!/\.(?:png|jpe?g|svg|webp|gif|avif)$/i.test(resource))reject('localResource',name);
     if(resource.startsWith('pictures/'))pictures?.add(resource);
    }
    continue;
   }
   if(name==='style'){try{validateWebsiteCSS(value,{file,pictures});}catch(e){if(e.code==='INVALID')reject('inlineStyle',name);throw e;}}
   if(pictures&&(resources.has(name)||name==='href')){const resource=localURL(value,file);if(resource?.startsWith('pictures/'))pictures.add(resource);}
   if(recordings&&(resources.has(name)||name==='href')){
    const resource=localURL(value,file);if(resource?.startsWith('recordings/')){
     if(inPlacement)reject('protectedMedia',name);recordings.add(resource);
    }
   }
   if(resources.has(name)&&value&&localURL(value,file)===null)reject('localResource',name);
   if(name==='href'){
    if(node.tagName==='link'){if(localURL(value,file)===null)reject('localResource',name);if(!['stylesheet','icon','alternate','canonical'].includes(node.attrs.find(attr=>attr.name==='rel')?.value))reject('linkRelation','rel');}
    else if(value&&localURL(value,file)===null&&(node.tagName!=='a'||!externalLink(value)))reject('link',name);
   }
  }
  if(node.tagName==='style'){
   const first=node.childNodes?.[0];
   try{validateWebsiteCSS((node.childNodes??[]).map(child=>child.value??'').join(''),{file,pictures,diagnose});}catch(e){
    if(e.sourceDiagnostic&&first?.sourceCodeLocation){
     const {reason,start,end}=e.sourceDiagnostic,raw=html.slice(first.sourceCodeLocation.startOffset,first.sourceCodeLocation.endOffset);
     if(raw===first.value)invalidSource('html',reason,first.sourceCodeLocation.startOffset+start,first.sourceCodeLocation.startOffset+end);
    }
    if(e.code==='INVALID')reject('inlineStyle');throw e;
   }
  }
  for(const child of node.childNodes??[])visit(child,inPlacement,inEquation,inMath);if(node.content)visit(node.content,inPlacement,inEquation,inMath);
 }
 visit(root);return html;
}
