import path from 'node:path';
import {createHash} from 'node:crypto';
import {parse,parseFragment,serialize} from 'parse5';
import {AppError} from './errors.js';
import {escapeWebsiteText as esc} from './website-file-html.js';
import {attr,descendants} from './website-migration-views.js';
import {compileWebsiteFeedTemplate,feedContentAtPage} from './website-feed-template.js';
import {readFeedSource,feedTemplateMetadata} from './website-feed-source.js';
import {websiteHTMLByteLimit} from './website-file-policy.js';
import {retainedArticleCSS} from './website-entry-styles.js';
import {mapImageCandidates} from './web/website-image-candidates.js';
import {figureVariantKey,mapFigureVariants} from './website-figure-variants.js';
import en from './web/locales/en/websiteFeeds.json' with {type:'json'};
import ca from './web/locales/ca/websiteFeeds.json' with {type:'json'};
import es from './web/locales/es/websiteFeeds.json' with {type:'json'};
import nb from './web/locales/nb/websiteFeeds.json' with {type:'json'};
import nn from './web/locales/nn/websiteFeeds.json' with {type:'json'};
import enErrors from './web/locales/en/errors.json' with {type:'json'};
import caErrors from './web/locales/ca/errors.json' with {type:'json'};
import esErrors from './web/locales/es/errors.json' with {type:'json'};
import nbErrors from './web/locales/nb/errors.json' with {type:'json'};
import nnErrors from './web/locales/nn/errors.json' with {type:'json'};

export const feedMarker='data-website-feed';
export const maxPageBytes=websiteHTMLByteLimit;
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const feedCSS=`:where(.website-feed){margin-block:var(--section-space,2rem);color:inherit}
:where(.website-feed-items){display:grid;gap:var(--card-gap,1rem);align-items:start}
:where(.website-feed[data-layout="grid"]>.website-feed-items){grid-template-columns:repeat(auto-fit,minmax(min(18rem,100%),1fr))}
:where(.website-feed-item){min-inline-size:0;overflow-wrap:anywhere}
:where(.website-feed-item img,.website-feed-item video){max-inline-size:100%;height:auto}
:where(.website-feed-figure-grid){display:grid;grid-template-columns:repeat(auto-fit,minmax(min(20rem,100%),1fr));gap:var(--card-gap,1rem);align-items:start}
:where(.website-feed-figure-grid > *){min-inline-size:0;max-inline-size:100%}
:where(.website-feed[data-template="card"] .website-feed-item){padding:var(--card-padding,1rem);border:1px solid var(--page-border,currentColor);border-radius:var(--corner-radius,.4rem);background:var(--page-surface,transparent)}
:where(.website-feed-item>:first-child){margin-block-start:0}
:where(.website-feed-nav){display:flex;gap:1rem;flex-wrap:wrap;justify-content:space-between;margin-block:1rem}
:where(.website-feed-nav a:focus-visible){outline:2px solid var(--accent,currentColor);outline-offset:2px}
`;
export const feedStyle='feed-assets/layout-'+digest(feedCSS).slice(0,20)+'.css';
export const pageName=(feed,key)=>key==='host'?feed.path:'feeds/'+feed.id+'/'+key+'.html';
const relative=(page,name)=>path.posix.relative(path.posix.dirname(page),name);
const isolated=name=>'feed-assets/'+name;
const canonicalAsset=/^assets\/[a-f0-9]{64}\.[a-z0-9]+$/;
function memberAssets(markup,page,source){
 const root=parseFragment(markup),allowed=new Map(source.assets.map(a=>[a.name,a])),used=new Map();
 function rewrite(url){
  if(!url||url.startsWith('#')||/^[a-z][a-z\d+.-]*:/i.test(url))return url;
  const name=path.posix.normalize(path.posix.join(path.posix.dirname(page),url));
  if(!canonicalAsset.test(name))return url;
  const asset=allowed.get(name);if(!asset)throw new AppError('CONFLICT');
  const alias=isolated(name);used.set(alias,{...asset,name:alias,sourceId:source.id,feedAsset:true});return relative(page,alias);
 }
 for(const node of descendants(root))for(const a of node.attrs??[]){
  if(a.name==='srcset')a.value=mapImageCandidates(a.value,rewrite);
  else if(a.name===figureVariantKey)a.value=mapFigureVariants(a.value,rewrite);
  else if(['src','href','poster'].includes(a.name))a.value=rewrite(a.value);
 }
 return {markup:serialize(root),used};
}
export function makeFeedRenderer(feed,pending,siteId,draft,shared){
 const custom=feed.template==='custom'?compileWebsiteFeedTemplate(feed.itemHTML):null;
 const withContent=feed.template==='full'||custom?.needsContent,admittedRows=new WeakMap(),styles=new Map();
 async function render(store,member,page,signal){
  let admission=admittedRows.get(member);
  if(admission&&admission.writer!==store.writerToken())admission=null;
  let row=admission?.verified,source;
  if(!row){
   source=shared?.source;
   if(!source||source.id!==member.id||source.revision!==member.revision){
    source=await readFeedSource(store,member.id,member.revision,{signal,pending:pending||Boolean(admission),indexedRow:admission?.base});
    if(shared){shared.source=source;shared.html=null;shared.css=null;}
   }
   if(!source?.visible||source.target!=='website'||source.revision!==member.revision)throw new AppError('CONFLICT');
   row=source.feedRow;
  }
  if(row?.id!==member.id||row.revision!==member.revision)throw new AppError('CONFLICT');
  if(admission&&!withContent&&!admission.verified){admission.verified=feedTemplateMetadata(row);delete admission.base;}
  const instance=feed.id+'-'+member.id;
  const html=withContent?shared?.html??await store.readText(source.html,{signal}):'';
  if(withContent&&shared)shared.html=html;
  let markup=custom?custom.render({row,html,page,instance,maxBytes:maxPageBytes}):feed.template==='full'?feedContentAtPage(html,page,instance):'<h3>'+esc(row.title)+'</h3>';
  if(Buffer.byteLength(markup)>maxPageBytes)throw new AppError('WEBSITE_FEED_CAPACITY');
  let used=new Map(),style=null,styleKey='';
  if(withContent){
   ({markup,used}=memberAssets(markup,page,source));
   if(source.css.size){
    styleKey=source.css.sha256;let sheet=styles.get(styleKey);
    if(!sheet){
     const saved=shared?.css??await store.readText(source.css,{signal});
     if(shared)shared.css=saved;
     const css=retainedArticleCSS(saved,source.provenance?.recordId,markup);
     if(css!==saved){styleKey=digest(css);sheet=styles.get(styleKey);}
     if(!sheet){
      const scope='[data-website-feed-style="'+styleKey+'"]';
      const scoped=css.includes('@scope ([data-observanda-source])')?css.replaceAll('[data-observanda-source]',scope):'@scope ('+scope+') {\n'+css+'\n}';
      const name=isolated('styles-'+(draft?'draft-':'')+styleKey+'.css'),file=await store.siteFile(siteId,name,scoped,{signal,draft});
      const references=new Set(css.match(/assets\/[a-f0-9]{64}\.[a-z0-9]+/g)??[]);
      sheet={file,references};styles.set(styleKey,sheet);
     }
    }
    style=sheet.file.name;used.set(style,{...sheet.file,sourceId:source.id,feedAsset:true});
    for(const asset of source.assets)if(sheet.references.has(asset.name))used.set(isolated(asset.name),{...asset,name:isolated(asset.name),sourceId:source.id,feedAsset:true});
   }
  }
  return {assets:used,style,html:'<article class="website-feed-item" role="listitem" data-website-feed-source="'+member.id+'"'+(styleKey?' data-website-feed-style="'+styleKey+'"':'')+'>'+markup+'</article>'};
 }
 return {render,admittedRows};
}
// Reuse an unchanged member's sealed row when its neighbours or page change.
// In particular, a second pending source may already have a newer head while
// its own site refresh is still outstanding. Its last committed row and assets
// remain valid in the fenced intermediate revision until its writer finishes.
export function priorFeedRows(store,manifest,old,feed,hostHTML,signal){
 if(!old||old.unavailable||feed.template!==old.template||feed.itemHTML!==old.itemHTML)return async()=>null;
 const revisions=new Map(old.members.map(row=>[row.id,row.revision])),locations=new Map(),cache=new Map();
 for(const group of old.groups)for(const id of group.ids)locations.set(id,group);
 const files=new Map(manifest.files.map(f=>[f.name,f]));
 return async(member,page)=>{
  if(revisions.get(member.id)!==member.revision)return null;
  const group=locations.get(member.id);if(!group)throw new AppError('FORMAT');
  const from=pageName(old,group.key);let rows=cache.get(from);
  if(!rows){
   const html=group.key==='host'?hostHTML:await store.readText(files.get(from),{signal});
   const wrapper=[...descendants(parse(html,{sourceCodeLocationInfo:true}))].find(n=>attr(n,feedMarker)===feed.id);
   const items=wrapper?.childNodes.find(n=>attr(n,'class')==='website-feed-items');if(!items)throw new AppError('FORMAT');
   rows=new Map();
   for(const item of items.childNodes.filter(n=>n.tagName)){
    const id=attr(item,'data-website-feed-source'),loc=item.sourceCodeLocation;
    if(!id||!loc?.endTag||rows.has(id))throw new AppError('FORMAT');
    rows.set(id,html.slice(loc.startOffset,loc.endOffset));
   }
   cache.set(from,rows);if(cache.size>2)cache.delete(cache.keys().next().value);
  }
  let html=rows.get(member.id);if(!html)throw new AppError('FORMAT');
  const assets=new Map(group.assets.filter(a=>a.sourceId===member.id).map(a=>[a.name,a]));
  if(path.posix.dirname(from)!==path.posix.dirname(page)){
   const root=parseFragment(html);
   const rewrite=url=>{
    const target=path.posix.normalize(path.posix.join(path.posix.dirname(from),url));return assets.has(target)?relative(page,target):url;
   };
   for(const node of descendants(root))for(const a of node.attrs??[]){
    if(a.name==='srcset')a.value=mapImageCandidates(a.value,rewrite);
    else if(a.name===figureVariantKey)a.value=mapFigureVariants(a.value,rewrite);
    else if(['src','href','poster'].includes(a.name))a.value=rewrite(a.value);
   }
   html=serialize(root);
  }
  const style=[...assets.keys()].find(name=>name.startsWith('feed-assets/styles-'))??null;
  return {html,assets,style};
 };
}
export function feedSection(feed,rows,page,previous,next,language){
 const locale=language.toLowerCase().split('-')[0],messages=({en,ca,es,nb,nn})[locale]??en;
 if(feed.unavailable==='capacity'){
  const message=({en:enErrors,ca:caErrors,es:esErrors,nb:nbErrors,nn:nnErrors}[locale]??enErrors).WEBSITE_FEED_CAPACITY;
  return {markup:'<section class="website-feed" id="website-feed-'+feed.id+'" '+feedMarker+'="'+feed.id+'"><h2>'+esc(feed.heading)+'</h2><p role="status">'+esc(message)+'</p></section>',assets:[]};
 }
 const links=new Set([feedStyle]),assets=[];
 for(const row of rows){if(row.style)links.add(row.style);for(const descriptor of row.assets.values())assets.push(descriptor);}
 const css=[...links].map(name=>'<link rel="stylesheet" href="'+esc(relative(page,name))+'">').join('');
 const go=(key,rel,label)=>key===null?'':'<a rel="'+rel+'" href="'+esc(relative(page,pageName(feed,key))+'#website-feed-'+feed.id)+'">'+esc(label)+'</a>';
 const nav=go(previous,'prev',messages.previous)+go(next,'next',messages.next);
 const empty=!feed.members.length?'<p>'+esc(messages.empty)+'</p>':'';
 const markup='<section class="website-feed" id="website-feed-'+feed.id+'" '+feedMarker+'="'+feed.id+'" data-layout="'+feed.layout+'" data-template="'+feed.template+'">'+css+'<h2>'+esc(feed.heading)+'</h2>'+empty+'<div class="website-feed-items" role="list">'+rows.map(row=>row.html).join('')+'</div>'+(nav?'<nav class="website-feed-nav" aria-label="'+esc(messages.pages)+'">'+nav+'</nav>':'')+'</section>';
 return {markup,assets};
}
