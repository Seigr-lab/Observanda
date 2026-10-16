import {downloadPath,validDownloadInfo} from './web/website-file.js';
import {actionClasses,actionArrow,actionFonts,actionStyleRules,sectionActionRules} from './web/website-action-style.js';
import {PUBLIC_POPUPS_SCRIPT,popupMarkup,copyTextMarkup} from './publication-popups.js';
import {PUBLIC_GALLERY_SCRIPT,galleryAttributes} from './publication-gallery.js';
import {websiteLinkPath} from './web/website-links.js';
import {publicationSidebars} from './publication-regions.js';
import {publicProjection} from './publication-projection.js';
import {OBSERVANDA_REPOSITORY} from './web/product-links.js';
import {PUBLIC_BOOK_SCRIPT,publicationBrowse,bookPageNavigation} from './publication-browse.js';
import {publicationIndexPages} from './publication-browse-pages.js';
import {PUBLIC_INDEX_ROWS} from './web/public-browse-pages.js';
import {publicationCollectionWindows,staticCollectionNavigation} from './publication-collection-pages.js';
import {collectionPagePath} from './web/public-collection-pages.js';
import {publicationCollectionNavigation} from './publication-collections.js';
import {publicationNotebooks,pagedNotebookList} from './publication-notebooks.js';
import {publicationReferenceWindows} from './publication-references.js';
import {PublicationFeeds,PUBLIC_FEEDS_SCRIPT} from './publication-feeds.js';
import {publicationCollectionKey,publicationCollectionRecords,publicationCollection} from './web/publication-collections.js';
import {bookText} from './web/book-messages.js';
import {publicationText} from './web/publication-messages.js';
import {placedFigures} from './web/book-selectors.js';
import {attemptView} from './web/attempt-view.js';
import {resultStatementsView,figureResultView} from './web/result-statements.js';
export {publicProjection} from './publication-projection.js';
import {publicationPage} from './publication-page.js';
import {publicationPageTarget} from './publication-context.js';
import {recordDateHTML,compareRecordDates} from './web/record-date.js';
import {sectionAnchor} from './web/record-workflow.js';
import {proseText,renderProse} from './web/prose-model.js';
import {renderFigure,renderFigureView,figureTable} from './web/figure-renderer.js';
import {figureReadingView} from './web/figure-reading-view.js';
import {upgradeFigure,figureCSV} from './web/figure-model.js';
import {childrenOf} from './web/composition-tree.js';
import {pageContents} from './web/website-contents.js';
import {footerTextAlignment} from './web/website-footer.js';
import {mediaStyle} from './web/media-presentation.js';
import {renderRichText,richTextStyles} from './web/rich-text-model.js';
import {formattedText} from './web/formatted-text.js';
import {sectionItems,sectionStyle,linkAvailable} from './web/website-model.js';
import {FileContent,contentSize,contentHash,writePublicFile} from './file-content.js';
import { readFile, mkdir, writeFile, rename, lstat, unlink, rmdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fontStack, fontCSS } from './fonts.js';
import {variationCSS} from './web/font-catalogue.js';
import { assertPublicFields, assertPublicFiles } from './privacy.js';
import { AppError } from './errors.js';
import { digest, serialize } from './storage.js';

const bookCSS = await readFile(new URL('./web/book.css', import.meta.url), 'utf8')+'\n'+await readFile(new URL('./web/public-feeds.css', import.meta.url), 'utf8')+'\n'+await readFile(new URL('./web/public-index.css', import.meta.url), 'utf8');
const actionsCSS=await readFile(new URL('./web/website-actions.css',import.meta.url),'utf8');
const popupsCSS=await readFile(new URL('./web/public-popups.css',import.meta.url),'utf8');
const galleryCSS=await readFile(new URL('./web/public-gallery.css',import.meta.url),'utf8');
const baseCSS = popupsCSS+'\n'+galleryCSS+'\n'+bookCSS+'\n'+await readFile(new URL('./web/site.css', import.meta.url), 'utf8')+'\n'+await readFile(new URL('./web/attempts.css', import.meta.url), 'utf8')+'\n'+actionsCSS;
export const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const esc = escapeHTML;
const numeric = value => Number(value.toFixed(3));
import {publicationExcerpt as excerpt} from './web/publication-card.js';
// Compatibility entry point for older callers; all drawing is shared.
export function renderChart(chart,accent='#3b5bbd'){
 const figure=chart.series||chart.kind==='panels'?chart:upgradeFigure(chart,'00000000-0000-4000-8000-000000000001');
 if(!chart.series&&chart.kind!=='panels')figure.series[0].color=accent;
 return renderFigure(figure);
}


export function buildPublication(book, options = {}) {
  return renderPublication(publicProjection(book,options),options);
}

// Callers must supply the admitted projection, never raw workspace records.
// A single-page candidate is design-only and cannot be exported or deployed.
export function renderPublication(context, { blockedValues = [], mediaFiles = new Map(), fontFiles = new Map(), designTarget=null, workspaceContent=false, singlePage=false,emitBrowse=true } = {}) {
  const editionTarget=publicationPageTarget(context);
  if(context.publicationCounts&&!editionTarget)throw new AppError('INVALID');
  if(context.collectionPages&&!editionTarget&&!(context.designOnly&&workspaceContent&&singlePage&&designTarget))throw new AppError('INVALID');
  if(context.browsePage&&editionTarget!=='browse')throw new AppError('INVALID');
  if(context.referencePage&&!editionTarget?.startsWith('entry:')&&!(context.designOnly&&workspaceContent&&singlePage&&designTarget?.startsWith('entry:')))throw new AppError('INVALID');
  const recordCounts=context.publicationCounts??context.previewCounts;
  if(context.previewCounts&&(!context.designOnly||!workspaceContent||!singlePage))throw new AppError('INVALID');
  if((context.designOnly||context.recordCards&&!editionTarget)&&(!workspaceContent||!singlePage))throw new AppError('INVALID');
  if(singlePage&&!designTarget)throw new AppError('INVALID');
  const renderTarget=editionTarget??designTarget;
  const plan=singlePage||editionTarget?publicationPage(context,renderTarget):null;
  const wanted=target=>!plan||target===renderTarget;
  const original=target=>context.website.layouts.find(layout=>layout.target===target)?.placement!=='replace';
  const recordProse=(value,figure)=>renderProse(value,{figure,resolveLink:href=>{
   if(href.startsWith('#')||/^(https?:|mailto:|tel:)/.test(href))return href;
   return linkAvailable(href,context)?websiteLinkPath(href,'../'):null;
  }});

  if(!workspaceContent){
  const fields = [
    { field: 'website branding and menu', value: context.website },
    ...(context.browsePage?context.browseRecords.map(record=>({field:'record index',recordId:record.id,value:record})):[]),
    ...(editionTarget?[...(context.recordCards??[]),...(context.recordJourneys??[]),...(context.entryDestinations??[])].map(record=>({field:'record cards and links',recordId:record.id,value:record})):[]),
    ...context.pages.map(p => ({ field: 'page', recordId: p.id, value: p })),
    { field: 'website title', value: context.title }, { field: 'description', value: context.description },
    ...context.projects.flatMap(p => ['title', 'description', 'logos'].map(field => ({ field: `project ${field}`, recordId: p.id, value: p[field] }))),
    ...context.notebooks.map(n => ({ field: 'notebook title', recordId: n.id, value: n })),
    ...(context.legacyPages??[]).map(p=>({field:'legacy page',value:p})),
    ...context.entries.flatMap(e => ['title', 'body', 'outcome', 'contributors', 'relations', 'tags', 'figures', 'sections', 'attachments', 'logos', 'availability', ...(e.attempt?['attempt']:[]),...(e.results?['results']:[])].map(field => ({ field, recordId: e.id, value: e[field] })))
  ];
  assertPublicFields(fields, blockedValues);
  }
  const files = new Map(), a = context.appearance,feeds=new PublicationFeeds(files,esc);
  const hasPopups=[...context.website.home.sections,...context.pages.flatMap(p=>p.sections),...context.website.layouts.flatMap(l=>l.sections),...context.website.regions.flatMap(r=>r.sections)].some(s=>['popup','copy-text'].includes(s.kind));
  const hasGalleries=[...context.website.home.sections,...context.pages.flatMap(p=>p.sections),...context.website.layouts.flatMap(l=>l.sections),...context.website.regions.flatMap(r=>r.sections)].some(s=>s.kind==='gallery'&&s.viewer!==false);
  const hasFeeds=[...context.website.home.sections,...context.pages.flatMap(p=>p.sections),...context.website.layouts.flatMap(l=>l.sections),...context.website.regions.flatMap(r=>r.sections)].some(section=>section.feed)||context.projects.some(project=>wanted('project:'+project.id)&&original('project:'+project.id)&&pagedNotebookList(context.notebooks.filter(n=>n.projectId===project.id)));
  const richStyles=richTextStyles(plan?plan.fonts:[...context.website.regions.flatMap(r=>r.sections),...context.website.home.sections,...context.pages.flatMap(p=>p.sections),...context.website.layouts.flatMap(l=>l.sections)].map(s=>s.richText).concat(context.entries.flatMap(e=>[e.body,...e.sections.map(s=>s.body)]).filter(v=>typeof v==='object')));
  const fonts = fontCSS([a.font, a.headingFont,...richStyles.fonts,...actionFonts(context.website.design,plan?plan.sections:[...context.website.regions.flatMap(r=>r.sections),...context.website.home.sections,...context.pages.flatMap(p=>p.sections),...context.website.layouts.flatMap(l=>l.sections)])], files, fontFiles);
  const commonStyles = `:root{${actionStyleRules(context.website.design.buttons,'button')};${actionStyleRules(context.website.design.links,'link')};--reading-axes:${variationCSS(a.fontAxes)};--heading-axes:${variationCSS(a.headingFontAxes)};--reading-weight:${a.fontAxes?.wght??400};--heading-weight:${a.headingFontAxes?.wght??600};--heading-scale:${a.headingScale};--letter-spacing:${a.letterSpacing}px;--paragraph-spacing:${a.paragraphSpacing}em;--site-width:${context.website.design.width}px;--accent:${a.accent};--reading-width:${a.width}px;--reading-font:${fontStack(a.font)};--heading-font:${fontStack(a.headingFont)};--page-background:${a.background};--page-surface:${a.surface};--page-text:${a.text};--page-muted:${a.muted};--page-border:${a.border};--body-size:${a.fontSize}px;--line-height:${a.lineHeight};--corner-radius:${a.radius}px;--section-space:${a.density === 'compact' ? '28px' : '44px'};--card-padding:${a.density === 'compact' ? '20px' : '28px'};--card-gap:${a.density === 'compact' ? '16px' : '24px'};--entry-space:${a.density === 'compact' ? '2.5rem' : '4rem'}}\n` + baseCSS+'\nbody{font-variation-settings:var(--reading-axes);font-weight:var(--reading-weight)}h1,h2,h3,h4,.site-name{font-variation-settings:var(--heading-axes);font-weight:var(--heading-weight)}\n';
  files.set('styles.css',commonStyles+'\n'+fonts+'\n'+richStyles.css);
  const entries = [...context.entries].sort((a, b) => compareRecordDates(a,b,{descending:true}) || a.id.localeCompare(b.id, 'en'));
  const displayedCards=context.recordCards?[...context.recordCards].sort((a,b)=>compareRecordDates(a,b,{descending:true})||a.id.localeCompare(b.id,'en')):entries;
  const entryPath = e => `entries/${e.id}.html`;
  const projectPath = p => `projects/${p.id}.html`;
  const notebookPath = n => `notebooks/${n.id}.html`;
  const startPath=context.homeEnabled?'index.html':context.projects[0]?projectPath(context.projects[0]):context.pages[0]?'pages/'+context.pages[0].id+'.html':null;
  const pages = [], blockRules=[];
  for (const id of [context.website, ...context.projects, ...context.notebooks, ...context.pages, ...entries].flatMap(item => item.logos.map(logo => logo.id)).filter(id=>!plan||plan.media.has(id))) {
    const asset = mediaFiles.get(id);
    if (!asset || asset.kind !== 'image' || !(Buffer.isBuffer(asset.bytes)||asset.bytes instanceof FileContent)) throw new AppError('MEDIA_INVALID');
    files.set(`media/${id}.png`, asset.bytes);
  }
  const logo = (logos, prefix) => logos.length ? `<div class="logo-group">${logos.map(item => `<img class="custom-logo" src="${prefix}media/${item.id}.png" alt="${esc(item.alt)}">`).join('')}</div>` : '';

  function page(name, title, description, content, crumbs = [], targetOverride=null) {
    const prefix = '../'.repeat(name.split('/').length-1);
    const target=targetOverride??(name==='browse.html'?'browse':name==='index.html'?'home':({projects:'project',notebooks:'notebook',entries:'entry',pages:'page'}[name.split('/')[0]]+':'+name.split('/')[1].slice(0,-5)));
    const menu=(parent=null)=>`<ul class="site-menu">${context.website.navigation.filter(item=>item.parent===parent).map(item=>`<li><a href="${prefix}${item.path}"${item.target===target?' aria-current="page"':''}>${esc(item.title)}</a>${context.website.navigation.some(child=>child.parent===item.target)?`<details class="site-submenu"><summary aria-label="Pages under ${esc(item.title)}">&#9662;</summary>${menu(item.target)}</details>`:''}</li>`).join('')}</ul>`;
    const links=context.website.design.navigation==='none'?'':(context.website.navigation.length?menu():'')+((context.website.design.browseLink!==false&&(recordCounts?.total??context.browseRecords?.length))?'<a data-book-index href="'+prefix+'browse.html">'+esc(bookText('browse'))+'</a>':'');
    crumbs=crumbs.filter(c=>context.homeEnabled||c.path!=='index.html');
    const breadcrumb = crumbs.length ? `<div class="breadcrumbs">${crumbs.map(c => `<a href="${prefix}${c.path}">${esc(c.title)}</a>`).join('<span aria-hidden="true"> / </span>')}</div>` : '';
    const layout=context.website.layouts.find(l=>l.target===target),feedPage=target==='browse'||target.startsWith('project:')||target.startsWith('notebook:')?name:'';
    const regions=context.website.regions.filter(r=>r.target===target||((target==='browse'||target.startsWith('legacy:'))&&r.kind==='footer'&&r.target===(renderTarget??(context.homeEnabled?'home':'project:'+context.projects[0]?.id)))),footer=regions.find(r=>r.kind==='footer'),masthead=regions.find(r=>r.kind==='header');
    const pageSections=[...regions.flatMap(r=>r.sections),...(layout?.sections??[]),...(name==='index.html'?context.website.home.sections:context.pages.find(p=>'pages/'+p.id+'.html'===name)?.sections??[])];
    for(const section of pageSections)blockRules.push(...sectionActionRules(section,'[data-page="'+target+'"] [data-section-id="'+section.id+'"]'));
    for(const section of pageSections){const style=section.style??{},rules=[];for(const [key,property] of [['fontSize','--body-size'],['padding','padding'],['radius','border-radius'],['background','background'],['color','color'],['fit','--media-fit']])if(style[key]!==undefined)rules.push(property+':'+style[key]+(['fontSize','padding','radius'].includes(key)?'px':''));for(const [key,variable] of [['headingAlign','heading'],['bodyAlign','body'],['itemHeadingAlign','item-heading'],['detailsAlign','details'],['captionAlign','caption'],['buttonAlign','button']])rules.push('--section-'+variable+'-align:'+(style[key]??style.align??'start'));if(section.kind==='popup'){rules.push('--popup-width:'+section.dialogWidth+'px');if(style.background)rules.push('--popup-background:'+style.background);if(style.padding!==undefined)rules.push('--popup-padding:'+style.padding+'px');if(style.radius!==undefined)rules.push('--popup-radius:'+style.radius+'px');}if(section.kind==='container')rules.push('--container-gap:'+section.gap+'px');if(style.color)rules.push('--page-text:'+style.color,'--page-muted:'+style.color);if(rules.length)blockRules.push('[data-page="'+target+'"] [data-section-id="'+section.id+'"]{'+rules.join(';')+'}');}
    if(layout){title=layout.heading||title;description=layout.description||description;const additions='<div class="page-composition" data-composition="layout">'+childrenOf(layout.sections).map(s=>homeSection(s,prefix,target,layout.sections,'','layout',feedPage)).join('')+'</div>';content=layout.placement==='replace'?additions:layout.placement==='after'?content+additions:additions+content;}
    const showTitle=layout?layout.showHeading:name!=='index.html'||context.website.home.showTitle;
    const header=layout?.showHeading===false?'':showTitle||description||breadcrumb?`<header class="site-header">${breadcrumb}${showTitle?`<h1>${esc(title)}</h1>`:''}${description?`<p>${esc(description)}</p>`:''}</header>`:'';
    const documentTitle=[title,context.title].filter((part,index,all)=>part?.trim()&&all.indexOf(part)===index).join(' | ')||'Home',mainId=target.startsWith('legacy:')?'observanda-content-'+target.slice(7):'content';
    for(const region of regions){const rules=['padding:'+region.padding+'px',...(region.background?['background:'+region.background]:[]),...(region.color?['color:'+region.color,'--page-text:'+region.color,'--page-muted:'+region.color]:[])];blockRules.push('[data-page="'+target+'"] '+(region.kind==='footer'?'.site-footer':'[data-region-kind="'+region.kind+'"]')+'{'+rules.join(';')+'}');}
    blockRules.push('[data-page="'+target+'"] .site-footer{--footer-text-align:'+footerTextAlignment(footer,context.website.footer)+'}');

    const regionHTML=region=>'<div class="page-composition" data-composition="'+region.kind+'">'+childrenOf(region.sections).map(s=>homeSection(s,prefix,target,region.sections,region.kind,region.kind,feedPage)).join('')+'</div>';
    const sidebars=publicationSidebars(regions,{esc,render:regionHTML,editing:workspaceContent&&singlePage});
    if(sidebars.rules)blockRules.push('[data-page="'+target+'"] .page-frame{'+sidebars.rules+'}');
    const branding=logo(context.website.logos,prefix)+(context.title.trim()?`<span>${esc(context.title)}</span>`:''),top=masthead?'<header class="site-masthead" data-region-kind="header">'+regionHTML(masthead)+'</header>':branding||links?`<div class="site-top">${branding?`<a class="site-name" href="${prefix}${startPath??name}">${branding}</a>`:''}${links?`<nav aria-label="Website">${links}</nav>`:''}</div>`:'';
    files.set(name, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; connect-src 'self'"><title>${esc(documentTitle)}</title>${!workspaceContent&&!singlePage&&(context.browseRecords?.length||context.browsePage)?`<script src="${prefix}public-book.js" defer></script>`:''}${hasFeeds?`<script src="${prefix}public-feeds.js" defer></script>`:''}${hasPopups&&!workspaceContent?`<script src="${prefix}public-popups.js" defer></script>`:''}${hasGalleries&&!workspaceContent?`<script src="${prefix}public-gallery.js" defer></script>`:''}<meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(prefix+name)}"><link rel="stylesheet" href="${prefix}styles.css"></head><body data-page="${target}" class="${a.theme} cards-${a.layout} header-${a.header} navigation-${masthead?'none':context.website.design.navigation} heading-${context.website.design.heading}"><a class="skip" href="#${mainId}">Skip to content</a>${top}${header}<div class="page-frame${sidebars.classes}">${sidebars.left}<main id="${mainId}" class="page-content">${!showTitle?`<h1 class="visually-hidden">${esc(title)}</h1>`:''}${content}</main>${sidebars.right}</div><footer class="site-footer">${footer?regionHTML(footer):context.website.footer?`<p>${esc(context.website.footer)}</p>`:''}<p class="powered-by"><a href="${OBSERVANDA_REPOSITORY}" target="_blank" rel="noopener noreferrer">Powered by Observanda</a></p></footer></body></html>\n`);
    feeds.finishPage(target,name,files.get(name));
    pages.push({ title: name==='index.html'?'Home':title, path: name });
  }
  const cardItems = (records, prefix = '../') => records.map(e=>{
    const choice=context.website.presentation.covers.find(c=>c.entryId===e.id),image=choice?e.attachments.find(a=>a.id===choice.attachmentId&&a.kind==='image'):e.attachments.find(a=>a.kind==='image');
    return `<article class="publication-card" data-record-id="${e.id}">${image?mediaMarkup(image,null,prefix,'cover:'+e.id):''}<div class="entry-meta"><span>${esc(e.type)}</span>${recordDateHTML(e.occurredOn,esc)}</div><h2><a href="${prefix}${entryPath(e)}">${esc(e.title)}</a></h2>${(e.hasBody??Boolean(e.body))?`<p class="prose">${esc(e.excerpt??excerpt(e.body))}</p>`:''}<span class="record-status">${esc(e.status)}</span></article>`;
  }).join('');
  const cards=(records,prefix='../')=>'<div class="publication-cards">'+cardItems(records,prefix)+'</div>';
  function* bodyPages(target,records,fragment){
    const retained=publicationCollection(context,'body');
    if(retained||workspaceContent||singlePage||!original(target)){
      const state=retained?.staticPage;
      yield {name:collectionPagePath(target,state?.page??0),records:publicationCollectionRecords(context,'body',records),navigation:publicationCollectionNavigation(context,'body',fragment,esc),continued:!!state?.page};
      return;
    }
    const byId=new Map(records.map(r=>[r.id,r]));
    for(const window of publicationCollectionWindows(records,target))yield {name:collectionPagePath(target,window.staticPage.page),records:window.recordIds.map(id=>byId.get(id)),navigation:staticCollectionNavigation(window.staticPage,fragment,esc),continued:window.staticPage.page>0};
  }
  function resolveMediaLink(value,prefix){return value&&linkAvailable(value,context)?websiteLinkPath(value,prefix):'';}
  function mediaMarkup(attachment,e,prefix,scope=e?'entry:'+e.id:'',{viewer=false}={}){
      const display=mediaStyle(context.website,scope,attachment.id),cover=scope.startsWith('cover:');
      attachment={...attachment,...(display.caption!==undefined?{caption:display.caption}:{}),...(display.alt!==undefined?{alt:display.alt}:{})};
      const asset = mediaFiles.get(attachment.id);
      const extension = { image: 'png', audio: 'wav', video: 'mp4' }[attachment.kind];
      if (!asset || asset.kind !== attachment.kind || asset.extension !== extension || !(Buffer.isBuffer(asset.bytes)||asset.bytes instanceof FileContent)) throw new AppError('MEDIA_INVALID');
      const name = `media/${attachment.id}.${extension}`;
      files.set(name, asset.bytes);
      const src = `${prefix}${name}`;
      let player = attachment.kind === 'image' ? `<img src="${src}" alt="${esc(attachment.alt || attachment.caption)}" loading="lazy">` : `<${attachment.kind} controls preload="metadata" src="${src}" aria-label="${esc(attachment.alt || attachment.caption || attachment.kind)}">Your browser does not support this media. <a href="${src}">Download recording</a></${attachment.kind}>`;
      const href=resolveMediaLink(display.link,prefix);
      if(href&&attachment.kind==='image')player=`<a href="${esc(href)}" target="${display.target}" rel="noopener noreferrer">${player}</a>`;
      if(viewer&&!href&&attachment.kind==='image')player='<a href="'+esc(src)+'" data-gallery-image aria-haspopup="dialog">'+player+'</a>';
      const selector=`[data-media-scope="${scope}"][data-media-id="${attachment.id}"]`;
      if(scope){blockRules.push(`${selector}{width:${display.width}%;margin-inline:auto}`);if(display.ratio!=='original')blockRules.push(`${selector} img,${selector} video{aspect-ratio:${{square:'1',landscape:'4/3',portrait:'3/4',wide:'16/9'}[display.ratio]};object-fit:${display.fit};width:100%}`);else blockRules.push(`${selector} img,${selector} video{aspect-ratio:auto;object-fit:${display.fit}}`);}
      return `<figure class="media-figure${cover?' card-cover':''}" data-media-id="${attachment.id}" data-media-scope="${scope}">${player}${!cover&&attachment.caption?`<figcaption>${esc(attachment.caption)}</figcaption>`:''}${!cover&&attachment.transcript?`<details><summary>Transcript / description</summary><div class="prose">${esc(attachment.transcript)}</div></details>`:''}</figure>`;

  }
  function homeSection(section,prefix='',target='home',source=context.website.home.sections,region='',collectionScope=region,feedPage=''){
    const selected=sectionItems(section,context,{region:collectionScope});const style=sectionStyle(section);
    const body=section.format==='rich'?renderRichText(section.richText,{resolveLink:href=>{if(href.startsWith('#')||/^(https?:|mailto:|tel:)/.test(href))return href;const [destination,fragment]=href.split('#');if(!linkAvailable(destination,context))return null;if(destination==='home')return prefix+'index.html'+(fragment?'#'+fragment:'');const [kind,id]=destination.split(':');return prefix+({project:'projects',notebook:'notebooks',entry:'entries',page:'pages'}[kind])+'/'+id+'.html'+(fragment?'#'+fragment:'');}}):formattedText(section.body,section.format);
    const linkAttrs=` target="${section.linkTarget??'_self'}"${section.linkTitle?` title="${esc(section.linkTitle)}"`:''} rel="${[...(section.linkTarget==='_blank'?['noopener','noreferrer']:[]),...(section.linkNoFollow?['nofollow']:[])].join(' ')}"`;
    let content='';
    if(section.kind==='container')content='<div class="container-content container-'+section.layout+' container-columns-'+section.columns+'">'+childrenOf(source,section.id).map(s=>homeSection(s,prefix,target,source,region,collectionScope,feedPage)).join('')+'</div>';
    if(section.kind==='popup')content=popupMarkup(section,{esc,id:(region?region+'-':'')+'section-'+section.id,editing:workspaceContent&&singlePage,children:childrenOf(source,section.id).map(s=>homeSection(s,prefix,target,source,region,collectionScope,feedPage)).join('')});
    if(section.kind==='copy-text')content=copyTextMarkup(section,esc,{editing:workspaceContent&&singlePage});
    if(section.kind==='disclosure')content='<details class="section-disclosure-content"'+(section.open||workspaceContent&&singlePage?' open':'')+'><summary>'+esc(section.title||publicationText('disclosure'))+'</summary><div class="container-content container-column">'+childrenOf(source,section.id).map(s=>homeSection(s,prefix,target,source,region,collectionScope,feedPage)).join('')+'</div></details>';
    if(section.kind==='heading')content='<h'+section.level+'>'+esc(section.title)+'</h'+section.level+'>';
    if(['text','callout'].includes(section.kind))content=`<div class="prose">${body}</div>`;
    const projectCard=p=>{
      const ids=new Set(context.notebooks.filter(n=>n.projectId===p.id).map(n=>n.id)),count=recordCounts?[...ids].reduce((sum,id)=>sum+(recordCounts.notebooks[id]??0),0):(context.entryDestinations??entries).filter(e=>ids.has(e.notebookId)).length;
      return `<article class="publication-card">${logo(p.logos,prefix)}<h2><a href="${prefix}${projectPath(p)}">${esc(p.title)}</a></h2>${p.description?`<p class="prose">${esc(p.description)}</p>`:''}<span class="count">${count} ${count===1?'record':'records'}</span></article>`;
    };
    if(section.kind==='projects')content='<div class="publication-cards">'+selected.map(projectCard).join('')+'</div>';
    if(section.kind==='records')content=cards(selected,prefix)+publicationCollectionNavigation(context,publicationCollectionKey(section,collectionScope),(region?region+'-':'')+'section-'+section.id,esc);
    if(section.kind==='records'&&section.feed)content=feeds.render({section,target,pageKey:feedPage,key:publicationCollectionKey(section,collectionScope),items:selected,card:item=>cardItems([item],prefix),continuation:publicationCollection(context,publicationCollectionKey(section,collectionScope))});
    const pageCard=p=>`<article class="publication-card"><h2><a href="${prefix}pages/${p.id}.html">${esc(p.title)}</a></h2>${p.body?`<p class="prose">${esc(excerpt(p.body))}</p>`:''}</article>`;
    if(section.kind==='pages')content='<div class="publication-cards">'+selected.map(pageCard).join('')+'</div>';
    if(['projects','pages'].includes(section.kind)&&section.feed)content=feeds.render({section,target,pageKey:feedPage,key:publicationCollectionKey(section,collectionScope),items:selected,card:section.kind==='projects'?projectCard:pageCard});
    if(section.kind==='media'){const e=entries.find(e=>e.id===section.entryId);content=mediaMarkup(e.attachments.find(a=>a.id===section.attachmentId),e,prefix,target+'#'+section.id);}
    if(section.kind==='download'){
      const ref=context.website.assets.find(a=>a.id===section.assetId);
      if(ref){
        const asset=mediaFiles.get(ref.id),bytes=asset?.bytes;
        if(ref.kind!=='file'||!validDownloadInfo(ref)||asset?.kind!=='file'||asset.extension!=='bin'||asset.mime!=='application/octet-stream'||!(Buffer.isBuffer(bytes)||bytes instanceof FileContent)||ref.size!==contentSize(bytes)||ref.sha256!==contentHash(bytes)||asset.name!==ref.name)throw new AppError('MEDIA_INVALID');
        const name=downloadPath(ref.id);files.set(name,bytes);
        content=(section.body?'<div class="prose">'+esc(section.body)+'</div>':'')+'<a class="'+actionClasses(section)+'" href="'+esc(prefix+name)+'" download="'+esc(ref.name)+'">'+esc(section.label||ref.name)+(actionArrow(section)?' <span aria-hidden="true">&darr;</span>':'')+'</a>';
      }
    }
    if(section.kind==='asset'){const asset=context.website.assets.find(a=>a.id===section.assetId);if(asset)content=mediaMarkup(asset,null,prefix,target+'#'+section.id);}
    if(section.kind==='gallery')content='<div class="site-gallery gallery-columns-'+section.columns+'"'+(section.viewer!==false?galleryAttributes(esc):'')+'>'+section.assetIds.map(id=>context.website.assets.find(a=>a.id===id)).filter(Boolean).map(a=>mediaMarkup(a,null,prefix,target+'#'+section.id,{viewer:section.viewer!==false})).join('')+'</div>';
    if(section.kind==='hero'){
      const asset=context.website.assets.find(a=>a.id===section.assetId);
      const destination=websiteLinkPath(section.href,prefix);
      content='<div class="hero-copy">'+(section.title?'<h2>'+esc(section.title)+'</h2>':'')+'<div class="prose '+(['markdown','rich'].includes(section.format)?'formatted':'')+'">'+body+'</div>'+(section.label&&linkAvailable(section.href,context)?'<a class="'+actionClasses(section)+'" href="'+esc(destination)+'"'+linkAttrs+'>'+esc(section.label)+(actionArrow(section)?' <span aria-hidden="true">&rarr;</span>':'')+'</a>':'')+'</div>'+(asset?mediaMarkup(asset,null,prefix,target+'#'+section.id):'');
    }
    if(section.kind==='link'){
      const href=websiteLinkPath(section.href,prefix);
      content=`${section.body?`<div class="prose">${esc(section.body)}</div>`:''}<a class="${actionClasses(section)}" href="${esc(href)}"${linkAttrs}>${esc(section.label||'Read more')}${actionArrow(section)?' <span aria-hidden="true">&rarr;</span>':''}</a>`;
    }
    if(section.kind==='contents'){const links=pageContents(context,target);content=links.length?'<nav class="section-index" aria-label="'+esc(section.title||'On this page')+'"><ol>'+links.map(link=>'<li class="index-depth-'+link.depth+'"><a href="#'+esc(link.id)+'">'+esc(link.title)+'</a></li>').join('')+'</ol></nav>':(designTarget===target?'<p class="muted">Add headings to the page to build its contents index.</p>':'');}
    if(section.kind==='divider')content='<hr>';
    return `<section id="${region?region+'-':''}section-${section.id}" class="home-section block-width-${style.width} block-surface-${style.surface} block-align-${style.align} block-space-${style.space} section-${section.kind} ${['markdown','rich'].includes(section.format)?'formatted':''} section-layout-${section.layout??'inherit'}" data-section-id="${section.id}" data-element-kind="${section.kind}"${section.style?.fontSize!==undefined?' data-custom-text-size="true"':''}>${section.title&&!['hero','heading','container','disclosure','popup'].includes(section.kind)?`<h2>${esc(section.title)}</h2>`:''}${content}</section>`;
  }
  if(context.homeEnabled&&wanted('home'))page('index.html', context.website.home.title||context.title, context.website.home.introduction,original('home')?`<div class="page-composition" data-composition="home">${childrenOf(context.website.home.sections).map(section=>homeSection(section)).join('')}</div>`:'');
  for (const p of context.projects.filter(p=>wanted('project:'+p.id))) {
    const notebooks = context.notebooks.filter(n => n.projectId === p.id), ids = new Set(notebooks.map(n => n.id));
    const target='project:'+p.id;
    for(const part of bodyPages(target,displayedCards.filter(e=>ids.has(e.notebookId)),'page-records')){
      page(part.name,p.title,p.description,
        original(target)?`${logo(p.logos, "../")}${notebooks.length ? `<section id="page-notebooks"><h2>${esc(bookText('labBooks'))}</h2>${publicationNotebooks(notebooks,{target,pageKey:part.name,feeds,esc})}</section>` : ''}<section id="page-records"><h2>Entries</h2>${part.records.length ? cards(part.records) : '<p>No public entries yet.</p>'}${part.navigation}</section>`:'', [{ title: 'Home', path: 'index.html' }],target);
      if(part.continued)pages.pop();
    }
  }
  for (const custom of context.pages.filter(p=>wanted('page:'+p.id))) page(`pages/${custom.id}.html`, custom.title, '', original('page:'+custom.id)?`${logo(custom.logos, "../")}<div class="prose custom-page">${esc(custom.body)}</div><div class="page-composition" data-composition="page">${childrenOf(custom.sections).map(section=>homeSection(section,'../','page:'+custom.id,custom.sections)).join('')}</div>`:'', [{ title: 'Home', path: 'index.html' }]);
  for (const n of context.notebooks.filter(n=>wanted('notebook:'+n.id))) {
    const p = context.projects.find(p => p.id === n.projectId);
    const target='notebook:'+n.id;
    for(const part of bodyPages(target,displayedCards.filter(e=>e.notebookId===n.id),'content')){
      page(part.name,n.title,p.title,original(target)?logo(n.logos,'../')+cards(part.records)+part.navigation:'',[{title:'Home',path:'index.html'},{title:p.title,path:projectPath(p)}],target);
      if(part.continued)pages.pop();
    }
  }
  for (const e of entries.filter(e=>wanted('entry:'+e.id))) {
    const n = context.notebooks.find(n => n.id === e.notebookId), p = context.projects.find(p => p.id === n.projectId);
    let figure = '';const inline=placedFigures(e),renderedFigures=new Map();
    for(const plot of e.figures){
      const stem=e.id+'-'+plot.id;
      files.set(`figures/${stem}.svg`,renderFigure(plot));
      const data=e.figureDownloads?.includes(plot.id);
      if(data)files.set(`figures/${stem}.csv`,figureCSV(plot));
      const visual=figureReadingView(plot.kind==='panels'?renderFigureView(plot):`<img src="../figures/${stem}.svg" alt="${esc(plot.title)}">`,plot.title);
      const markup=`<figure id="record-figure-${plot.id}" tabindex="-1">${visual}<figcaption>${esc(plot.title)}${figureResultView(plot,e.results,esc)}</figcaption>${data?`<details><summary>${esc(publicationText('viewData'))}</summary>${figureTable(plot)}</details>`:''}<a href="../figures/${stem}.svg" download>${esc(publicationText('downloadSvg'))}</a>${data?` &middot; <a href="../figures/${stem}.csv" download>${esc(publicationText('downloadCsv'))}</a>`:''}</figure>`;renderedFigures.set(plot.id,markup);if(!inline.has(plot.id))figure+=markup;
    }
    const media = e.attachments.map(attachment=>{const markup='<div id="record-figure-'+attachment.id+'" tabindex="-1">'+mediaMarkup(attachment,e,'../')+'</div>';renderedFigures.set(attachment.id,markup);return inline.has(attachment.id)?'':markup;}).join('');
    const shownFigures=new Set(),renderInline=id=>{let markup=renderedFigures.get(id)??'';if(shownFigures.has(id))markup=markup.replace(' id="record-figure-'+id+'"','');shownFigures.add(id);return markup;};
    const sectionLinks=e.sections.filter(s=>proseText(s.body).trim());
    const contents=context.website.design.contents&&!context.website.regions.some(r=>r.target==='entry:'+e.id&&['sidebar','secondary-sidebar'].includes(r.kind)&&r.sections.some(s=>s.kind==='contents'))&&sectionLinks.length>1?`<nav class="page-contents" aria-label="On this page">${sectionLinks.map((s,i)=>`<a href="#${esc(sectionAnchor(s))}">${esc(s.title)}</a>`).join('')}</nav>`:'';
    for(const references of publicationReferenceWindows(context,e,esc)){
    const journeys=references.content;shownFigures.clear();
    const content = `${bookPageNavigation(context.browseRecords??entries,e,esc)}${contents}${logo(e.logos, "../")}<article class="record-page">${journeys}${e.revisionEdition?'<p class="revision-edition">'+esc(publicationText('historicalRevision',{revision:e.revisionEdition.revision}))+ (e.revisionEdition.current?' &middot; <a href="../entries/'+e.revisionEdition.current+'.html">'+esc(publicationText('currentEdition'))+'</a>':'')+'</p>':''}<div class="entry-meta"><span>${esc(e.type)}</span>${recordDateHTML(e.occurredOn,esc)}<span>${esc(e.status)}</span></div>${e.outcome?'<p><strong>Outcome:</strong> '+esc(e.outcome)+'</p>':''}${e.contributors.length?`<ul class="record-contributors" aria-label="Contributors">${e.contributors.map(person=>`<li>${esc(person.name)}${person.role?` <span>(${esc(person.role)})</span>`:''}</li>`).join('')}</ul>`:''}<div class="prose rich-document">${recordProse(e.body,renderInline)}</div>${e.sections.filter(s => proseText(s.body).trim()).map((s,i) => `<section id="${esc(sectionAnchor(s))}"><h2>${esc(s.title)}</h2><div class="prose rich-document">${recordProse(s.body,renderInline)}</div></section>`).join('')}${figure}${media}${e.relations.length?`<section class="record-related"><h2>Related research</h2><ul>${e.relations.map(link=>`<li>${esc(link.type)}: <a href="${link.kind==='workspace'?'../index.html':'../'+({record:'entries',project:'projects',notebook:'notebooks'}[link.kind])+'/'+link.id+'.html'+(link.fragment?'#'+link.fragment:'')}">${esc(link.label)}</a></li>`).join('')}</ul></section>`:''}${e.tags.length ? `<ul class="tags" aria-label="Tags">${e.tags.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}${e.availability?.length?'<section class="evidence-availability"><h2>'+esc(publicationText('availabilityTitle'))+'</h2>'+e.availability.map(v=>'<p>'+esc(v)+'</p>').join('')+'</section>':''}${attemptView(e.attempt,esc)}${resultStatementsView(e.results,esc)}</article>`;
    page(references.path, e.title, '', content, [{ title: 'Home', path: 'index.html' }, { title: p.title, path: projectPath(p) }, { title: n.title, path: notebookPath(n) }],'entry:'+e.id);
    if(references.path!==entryPath(e))pages.pop();
    }
  }
  for(const legacy of context.legacyPages??[]){
    const prefix='../'.repeat(legacy.path.split('/').length-1);
    const content='<nav aria-label="'+esc(publicationText('legacyContents'))+'">'+legacy.anchors.map(a=>{
      const [destination,fragment]=a.href.split('#'),id=destination.slice('entry:'.length),href=prefix+'entries/'+id+'.html'+(fragment?'#'+fragment:'');
      return '<section'+(a.fragment?' id="'+esc(a.fragment)+'"':'')+'><h2>'+esc(a.label)+'</h2><a rel="bookmark" href="'+esc(href)+'">'+esc(publicationText('legacyOpenRecord'))+'</a></section>';
    }).join('')+'</nav>';
    if(files.has(legacy.path))throw new AppError('PUBLICATION_LINKS');
    page(legacy.path,legacy.title,'',content,[],'legacy:'+legacy.id);
    const ids=new Set();for(const match of files.get(legacy.path).matchAll(/\sid="([^"]*)"/g)){
      if(ids.has(match[1]))throw new AppError('PUBLICATION_LINKS',[{path:legacy.path,fragment:legacy.anchors.find(a=>esc(a.fragment)===match[1])?.fragment??match[1],reason:'ambiguousFragment'}]);
      ids.add(match[1]);
    }
  }
  if(!workspaceContent&&!singlePage&&(context.browseRecords?.length||context.browsePage)){
    files.set('public-book.js',PUBLIC_BOOK_SCRIPT);
    if(emitBrowse||editionTarget==='browse'){
      if(!context.browsePage&&context.browseRecords.length>PUBLIC_INDEX_ROWS){
        for(const index of publicationIndexPages(context.browseRecords,esc)){
          page(index.path,bookText('browse'),'',index.content,[],'browse');
          // Continuation files are destinations, not additional authored pages.
          if(index.path!=='browse.html')pages.pop();
        }
      }else page('browse.html',bookText('browse'),'',publicationBrowse(context.browseRecords,esc,{page:context.browsePage}));
    }
  }
  files.set('styles.css',files.get('styles.css')+'\n'+blockRules.join('\n'));
  if(hasFeeds)files.set('public-feeds.js',PUBLIC_FEEDS_SCRIPT);
  if(hasPopups&&!workspaceContent)files.set('public-popups.js',PUBLIC_POPUPS_SCRIPT);
  if(hasGalleries&&!workspaceContent)files.set('public-gallery.js',PUBLIC_GALLERY_SCRIPT);
  files.set('.nojekyll', '');
  const generator = 'Observanda 0.3.0-dev';
  const payload = [...files].map(([name, content]) => ({ path: name, bytes: contentSize(content), sha256: contentHash(content) }));
  const releaseId = digest(JSON.stringify({ generator, files: payload }));
  const includedProjects=context.projects.filter(p=>!plan||renderTarget==='project:'+p.id),includedEntries=entries.filter(e=>!plan||renderTarget==='entry:'+e.id);
  const manifest = { formatVersion: 2, generator, releaseId, projects: includedProjects.map(p => p.id), entries: includedEntries.map(e => e.id), files: payload };
  files.set('publication.json', serialize(manifest));
  if(!workspaceContent)assertPublicFiles(files, blockedValues);
  return { id: releaseId, designOnly:workspaceContent||singlePage, ...(editionTarget?{partial:true,styles:{common:commonStyles,fonts,rich:richStyles.css,blocks:blockRules}}:{}), files, pages, defaultPage:pages[0]?.path??null, projects: includedProjects.map(p => ({ id: p.id, title: p.title })), entries: includedEntries.map(e => ({ id: e.id, title: e.title })), blockedValues };
}

export function verifyPublication(candidate, {allowDesign=false}={}) {
  // Design documents can contain private research. All release writers reject
  // them; only the authenticated design-preview route may serve their files.
  if(candidate.partial||candidate.designOnly&&!allowDesign)throw new AppError('INVALID');
  if(!candidate.designOnly)assertPublicFiles(candidate.files, candidate.blockedValues);
  verifyPublicationManifest(candidate);
}

// The same file contract applies to publication and private restore audits.
// Restoring an old edition checks its saved bytes, not today's privacy rules
// or a newly rendered interpretation of its source records.
export function verifyPublicationManifest(candidate) {
  const manifest = JSON.parse(candidate.files.get('publication.json'));
  if (!manifest || !Array.isArray(manifest.files) || manifest.releaseId !== candidate.id || candidate.files.size !== manifest.files.length + 1) throw new AppError('STALE');
  const names = new Set(['publication.json']);
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || names.has(file.path)) throw new AppError('STALE');
    names.add(file.path);
    const content = candidate.files.get(file.path);
    if (content === undefined || contentHash(content) !== file.sha256 || contentSize(content) !== file.bytes) throw new AppError('STALE');
  }
}

// This first slice writes only to a new destination. Existing output is never deleted.
export async function writePublication(candidate, destination) {
  verifyPublication(candidate);
  const target = path.resolve(destination);
  await mkdir(path.dirname(target), { recursive: true });
  const parent = await realpath(path.dirname(target));
  const final = path.join(parent, path.basename(target));
  try { await lstat(final); throw new AppError('EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const staging = path.join(parent, `.observanda-build-${randomUUID()}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    for (const [name, content] of candidate.files) {
      const file = path.join(staging, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writePublicFile(file,content);
    }
    verifyPublication(candidate);
    // Recheck after staging: refuse any destination created in the meantime.
    try { await lstat(final); throw new AppError('EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(staging, final);
  } finally {
    // Only known staging members are removed. No recursive removal of user paths.
    for (const name of candidate.files.keys()) await unlink(path.join(staging, name)).catch(() => {});
    const directories = new Set([...candidate.files.keys()].map(name => path.dirname(name)).filter(name => name !== '.'));
    for (const name of directories) await rmdir(path.join(staging, name)).catch(() => {});
    await rmdir(staging).catch(() => {});
  }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Bounded, uncompressed ZIP writer for validated output files and prepared media. No ZIP import.
export function publicationZip(candidate) {
  verifyPublication(candidate);
  const local = [], central = [];
  let offset = 0;
  for (const [name, content] of candidate.files) {
    const filename = Buffer.from(name), data = Buffer.from(content), crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(0x21, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(0x21, 14); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, filename, data); central.push(directory, filename); offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(candidate.files.size, 8); end.writeUInt16LE(candidate.files.size, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
