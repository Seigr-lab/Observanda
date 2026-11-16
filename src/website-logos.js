import {parse} from 'parse5';
import {AppError} from './errors.js';
import {attr,descendants} from './website-migration-views.js';
import {escapeWebsiteText as esc} from './website-file-html.js';
import {contentBuffer} from './file-content.js';
import {websiteHTMLByteLimit} from './website-file-policy.js';

// A website made in the website editor shows only its own pictures as logos:
// each page may keep up to four in an inert template, and the home page's
// logos are the website's logos. They are placed when the site is previewed or
// published, from the website's own files; no research storage is read.
// A Logos block shows this page's logos or the website's; a page without one
// shows its logos at the top.
export const LOGOS_ATTRIBUTE='data-observanda-logos';
export const LOGOS_STYLESHEET='website-logos.css';
// Zero-specificity rules, so any style the author writes takes precedence.
export const LOGOS_CSS=':where(.site-logos){display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;margin:.75rem auto;padding:0 1rem;max-width:72rem}\n:where(.site-logos:empty){display:none}\n:where(.site-logos img){display:block;width:auto;height:auto;max-height:4rem;max-width:12rem}\n';
export const validLogoScope=value=>value==='auto'||value==='home';
export const PAGE_LOGOS_ATTRIBUTE='data-observanda-page-logos';
export const maxPageLogos=4;
function markers(html){
 const document=parse(html,{sourceCodeLocationInfo:true}),all=[...descendants(document)];
 const templates=all.filter(node=>node.tagName==='template'&&attr(node,PAGE_LOGOS_ATTRIBUTE)!==undefined);
 const own=templates.slice(0,1).flatMap(node=>[...descendants(node.content??{})]).filter(node=>node.tagName==='img'&&attr(node,'src')).slice(0,maxPageLogos).map(node=>({src:attr(node,'src'),alt:attr(node,'alt')??''}));
 return {document,templates,own,nodes:all.filter(node=>node.tagName&&attr(node,LOGOS_ATTRIBUTE)!==undefined)};
}
// The website's logos: the home page's own logos, as names from the site root.
const rootName=(src,page)=>{try{return new URL(src,new URL(page,'https://website.invalid/')).pathname.slice(1);}catch{return null;}};
export function homeLogos(html){
 return markers(html).own.map(logo=>({name:rootName(logo.src,'index.html'),alt:logo.alt})).filter(logo=>logo.name?.startsWith('pictures/'));
}
// Reads the saved home page once; given pages are used as they will be published.
export async function websiteLogoPlan(store,manifest,entries,{signal}={}){
 const given=entries.find(entry=>entry.name==='index.html');
 if(given)return {home:homeLogos(given.html)};
 const file=manifest.files.find(row=>row.name==='index.html');
 return {home:file?homeLogos(await store.readText(file,{signal})):[]};
}

// Fills each Logos block, or adds the automatic one at the top of the page,
// keeping every authored byte around them.
export function applyPageLogos(html,file,{home=[]}={}){
 const {document,nodes,templates,own}=markers(html),prefix='../'.repeat(file.split('/').length-1);
 // The page's own pictures are already written relative to the page.
 const ownMarkup=own.map(logo=>'<img src="'+esc(logo.src)+'" alt="'+esc(logo.alt)+'">').join('');
 const homeMarkup=home.map(logo=>'<img src="'+esc(prefix+logo.name)+'" alt="'+esc(logo.alt)+'">').join('');
 const automatic=()=>ownMarkup||homeMarkup;
 const edits=templates.flatMap(node=>node.sourceCodeLocation?[[node.sourceCodeLocation.startOffset,node.sourceCodeLocation.endOffset,'']]:[]);let shown=false;
 for(const node of nodes){
  const location=node.sourceCodeLocation,scope=attr(node,LOGOS_ATTRIBUTE);if(!location?.startTag||!location.endTag)continue;
  const markup=scope==='auto'?automatic():scope==='home'?homeMarkup:'';if(markup)shown=true;
  edits.push([location.startTag.endOffset,location.endTag.startOffset,markup]);
 }
 const body=[...descendants(document)].find(node=>node.tagName==='body');
 if(!nodes.length&&body?.sourceCodeLocation?.startTag){
  const markup=automatic();
  if(markup){
   const first=(body.childNodes??[]).find(node=>node.tagName),skip=first?.tagName==='a'&&(attr(first,'href')??'').startsWith('#');
   const at=skip?first.sourceCodeLocation.endOffset:body.sourceCodeLocation.startTag.endOffset;
   edits.push([at,at,'<div class="site-logos" '+LOGOS_ATTRIBUTE+'="auto">'+markup+'</div>']);shown=true;
  }
 }
 if(!shown)return {html:edits.length?splice(html,edits):html,shown};
 const head=[...descendants(document)].find(node=>node.tagName==='head')?.sourceCodeLocation?.endTag;
 if(head)edits.push([head.startOffset,head.startOffset,'<link rel="stylesheet" href="'+esc(prefix+LOGOS_STYLESHEET)+'">']);
 return {html:splice(html,edits),shown};
}
// Gives a set of output pages their logos and adds the logos stylesheet once.
export async function applyWebsiteLogos(store,manifest,files,descriptors,{signal}={}){
 const entries=[];
 for(const [name,content] of files){
  if(!name.endsWith('.html'))continue;signal?.throwIfAborted();
  entries.push({name,html:(await contentBuffer(content,{signal,maxBytes:websiteHTMLByteLimit})).toString('utf8')});
 }
 const plan=await websiteLogoPlan(store,manifest,entries,{signal});let shown=false;
 for(const entry of entries){
  const output=applyPageLogos(entry.html,entry.name,plan);if(output.html===entry.html)continue;
  files.set(entry.name,Buffer.from(output.html));shown||=output.shown;
 }
 if(!shown)return [];
 if(files.has(LOGOS_STYLESHEET)||descriptors.has(LOGOS_STYLESHEET))throw new AppError('CONFLICT');
 files.set(LOGOS_STYLESHEET,Buffer.from(LOGOS_CSS));
 return [LOGOS_STYLESHEET];
}
function splice(html,edits){
 let output=html;
 for(const [start,end,text] of edits.sort((a,b)=>b[0]-a[0]||b[1]-a[1]))output=output.slice(0,start)+text+output.slice(end);
 return output;
}
