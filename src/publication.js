import {websiteRootStyle} from './web/website-root-style.js';
import {pngSize} from './canonical-png.js';
import {hasRetainedFigure} from './record-retained-figures.js';
import {actionFonts} from './web/website-action-style.js';
import {websiteLinkPath} from './web/website-links.js';
import {publicationText} from './web/publication-messages.js';
import {placedFigures} from './web/book-selectors.js';
import {readableCaptions} from './website-recordings.js';
import {figureDrawingLanguages,figureLanguageKey} from './website-figure-variants.js';
import {attemptView} from './web/attempt-view.js';
import {resultStatementsView,figureResultView} from './web/result-statements.js';
import {publicationPage} from './publication-page.js';
import {publicationPageTarget} from './publication-context.js';
import {recordReferences} from './publication-references.js';
import {recordDateHTML} from './web/record-date.js';
import {sectionAnchor} from './web/record-workflow.js';
import {proseText,renderProse} from './web/prose-model.js';
import {renderFigure,renderFigureView,figureTable} from './web/figure-renderer.js';
import {figureReadingView} from './web/figure-reading-view.js';
import {figureCSV} from './web/figure-model.js';
import {mediaStyle} from './web/media-presentation.js';
import {richTextStyles} from './web/rich-text-model.js';
import {linkAvailable} from './web/website-model.js';
import {FileContent} from './file-content.js';
import { readFile } from 'node:fs/promises';
import { fontCSS } from './fonts.js';
import { assertPublicFields, assertPublicFiles } from './privacy.js';
import { AppError } from './errors.js';

const bookCSS = await readFile(new URL('./web/book.css', import.meta.url), 'utf8')+'\n'+await readFile(new URL('./web/public-feeds.css', import.meta.url), 'utf8')+'\n'+await readFile(new URL('./web/public-index.css', import.meta.url), 'utf8');
const actionsCSS=await readFile(new URL('./web/website-actions.css',import.meta.url),'utf8');
const popupsCSS=await readFile(new URL('./web/public-popups.css',import.meta.url),'utf8');
const galleryCSS=await readFile(new URL('./web/public-gallery.css',import.meta.url),'utf8');
const baseCSS = popupsCSS+'\n'+galleryCSS+'\n'+bookCSS+'\n'+await readFile(new URL('./web/site.css', import.meta.url), 'utf8')+'\n'+await readFile(new URL('./web/attempts.css', import.meta.url), 'utf8')+'\n'+actionsCSS;
export const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const esc = escapeHTML;

// The record copy is this renderer's only output: one admitted record's
// article, the media, figure and font files it uses, and the styles the copy
// scopes to itself. Callers supply the admitted projection, never raw records.
export function renderRecordPage(context,{mediaFiles=new Map(),fontFiles=new Map(),editionParts,figureLanguages=null}={}){
  const target=publicationPageTarget(context);
  if(!target?.startsWith('entry:')||!editionParts)throw new AppError('INVALID');
  const plan=publicationPage(context,target),e=context.entries.find(item=>'entry:'+item.id===target);
  const recordProse=(value,figure,headingBase=1)=>renderProse(value,{figure,surface:'website',headingBase,resolveLink:href=>{
   if(href.startsWith('#')||/^(https?:|mailto:|tel:)/.test(href))return href;
   return linkAvailable(href,context)?websiteLinkPath(href,'../'):null;
  }});
  assertPublicFields([
    { field: 'website branding and menu', value: context.website },
    ...[...(context.recordJourneys??[]),...(context.entryDestinations??[])].map(record=>({field:'record cards and links',recordId:record.id,value:record})),
    ...['title', 'body', 'outcome', 'contributors', 'relations', 'tags', 'figures', 'sections', 'attachments', ...(e.attempt?['attempt']:[]),...(e.results?['results']:[])].map(field => ({ field, recordId: e.id, value: e[field] }))
  ]);
  const files=new Map(),a=context.appearance,blockRules=[];
  const richStyles=richTextStyles(plan.fonts,{surface:'website'});
  const fonts=fontCSS([a.font,a.headingFont,...richStyles.fonts,...actionFonts(context.website.design,plan.sections)],files,fontFiles);
  const commonStyles = websiteRootStyle(a,context.website.design)+`\n` + baseCSS+'\nbody{font-variation-settings:var(--reading-axes);font-weight:var(--reading-weight)}h1,h2,h3,h4,.site-name{font-variation-settings:var(--heading-axes);font-weight:var(--heading-weight)}\n';
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
      // Caption tracks travel as plain WebVTT files beside the video.
      // Cues that cannot be read are left out; a track without any is not published.
      const readable=(attachment.kind==='video'?attachment.captions??[]:[]).flatMap(track=>{const vtt=readableCaptions(track.vtt);return vtt.includes('-->')?[{...track,vtt}]:[];});
      const tracks=readable.map((track,i)=>{const name=`media/${attachment.id}.${track.language}.vtt`;files.set(name,track.vtt);return `<track kind="captions" src="${prefix}${name}" srclang="${esc(track.language)}" label="${esc(track.label)}"${i===0?' default':''}>`;}).join('');
      const size = attachment.kind === 'image' ? pngSize(Buffer.isBuffer(asset.bytes) ? asset.bytes : asset.bytes.header) : null;
      // Intrinsic size lets browsers reserve the picture's space before it loads.
      let player = attachment.kind === 'image' ? `<img src="${src}"${size ? ` width="${size.width}" height="${size.height}"` : ''} alt="${esc(attachment.alt || attachment.caption)}" loading="lazy">` : `<${attachment.kind} controls preload="metadata" src="${src}" aria-label="${esc(attachment.alt || attachment.caption || 'Recording')}"${attachment.alt || attachment.caption ? '' : ' data-observanda-aria="websiteRecordText:recording"'}>${tracks}<span data-observanda-label="websiteRecordText:mediaUnsupported">This browser cannot play this recording.</span> <a href="${src}" data-observanda-label="websiteRecordText:downloadRecording">Download the recording</a></${attachment.kind}>`;
      const href=resolveMediaLink(display.link,prefix);
      if(href&&attachment.kind==='image')player=`<a href="${esc(href)}" target="${display.target}" rel="noopener noreferrer">${player}</a>`;
      if(viewer&&!href&&attachment.kind==='image')player='<a href="'+esc(src)+'" data-gallery-image aria-haspopup="dialog">'+player+'</a>';
      const selector=`[data-media-scope="${scope}"][data-media-id="${attachment.id}"]`;
      if(scope){blockRules.push(`${selector}{width:${display.width}%;margin-inline:auto}`);if(display.ratio!=='original')blockRules.push(`${selector} img,${selector} video{aspect-ratio:${{square:'1',landscape:'4/3',portrait:'3/4',wide:'16/9'}[display.ratio]};object-fit:${display.fit};width:100%}`);else blockRules.push(`${selector} img,${selector} video{aspect-ratio:auto;object-fit:${display.fit}}`);}
      return `<figure class="media-figure${cover?' card-cover':''}" data-media-id="${attachment.id}" data-media-scope="${scope}">${player}${!cover&&(attachment.caption||attachment.attribution)?`<figcaption>${esc(attachment.caption??'')}${attachment.caption&&attachment.attribution?'<br>':''}${attachment.attribution?mediaCredit(attachment.attribution):''}</figcaption>`:''}${!cover&&attachment.transcript?`<details><summary data-observanda-label="websiteRecordText:transcript">Transcript and description</summary><div class="prose">${esc(attachment.transcript)}</div></details>`:''}</figure>`;

  }
  // A template value keeps its type: yes/no and choices are words the page
  // language can relabel, dates stay machine-readable, numbers keep their exact
  // spelling as the machine value.
  function fieldValueHTML({type,value}){
    if(type==='boolean')return '<span data-observanda-label="websiteRecordText:'+(value?'yes':'no')+'">'+(value?'Yes':'No')+'</span>';
    if(type==='date')return '<time datetime="'+esc(value)+'" data-observanda-term="date">'+esc(value)+'</time>';
    if(type==='number')return '<data value="'+esc(value)+'">'+esc(value)+'</data>';
    if(type==='select')return '<span data-observanda-term="profile">'+esc(value)+'</span>';
    return esc(value);
  }
  // Creator, credit and licence travel with a photograph or recording; the
  // page localizer gives the two labels the page language.
  function mediaCredit({creator='',credit='',licence=''}){
    const parts=[creator&&'<span data-observanda-label="websiteRecordText:mediaCreator">Creator</span>: '+esc(creator),credit&&esc(credit),licence&&'<span data-observanda-label="websiteRecordText:mediaLicence">Licence</span>: '+esc(licence)].filter(Boolean);
    return '<small class="media-provenance">'+parts.join(' &middot; ')+'</small>';
  }
  let figure = '';const inline=placedFigures(e),renderedFigures=new Map();
  for(const plot of e.figures){
    if(hasRetainedFigure(plot)){
      if(!editionParts?.retainedFigure)throw new AppError('INVALID');
      const markup='<figure id="record-figure-'+plot.id+'" tabindex="-1">'+editionParts.retainedFigure(e.id,plot.id,{data:e.figureDownloads?.includes(plot.id)??false,results:e.results})+'</figure>';
      renderedFigures.set(plot.id,markup);if(!inline.has(plot.id))figure+=markup;continue;
    }
    const stem=e.id+'-'+plot.id;
    files.set(`figures/${stem}.svg`,renderFigure(plot));
    // A website copy also carries the plot drawn for each other language.
    const drawings=figureDrawingLanguages(figureLanguages??[]),drawn=new Set();
    const variants=plot.kind==='panels'?[]:[...drawings].filter(([language])=>language!=='en').map(([language,drawing])=>{
      const name=drawing==='en'?`figures/${stem}.svg`:`figures/${stem}.${drawing}.svg`;
      if(drawing!=='en'&&!drawn.has(drawing)){files.set(name,renderFigure(plot,{locale:drawing}));drawn.add(drawing);}
      return language+' ../'+name;
    });
    const variantAttribute=variants.length?` data-observanda-figure-variants="${esc(['en ../figures/'+stem+'.svg',...variants].join(' '))}"`:'';
    const data=e.figureDownloads?.includes(plot.id);
    if(data)files.set(`figures/${stem}.csv`,figureCSV(plot));
    // Panels stay inline; a website copy carries one hidden drawing per other
    // number style, and the page shows the one for its language.
    const panelView=()=>{
      if(new Set(drawings.values()).size<2)return renderFigureView(plot);
      const groups=new Map();for(const [language,drawing] of drawings)groups.set(drawing,[...(groups.get(drawing)??[]),language]);
      return [...groups].map(([drawing,languages])=>'<div '+figureLanguageKey+'="'+esc(languages.join(' '))+'"'+(drawing==='en'?'':' hidden')+'>'+renderFigureView(plot,drawing==='en'?{}:{idPrefix:'reading-'+drawing,locale:drawing})+'</div>').join('');
    };
    const visual=figureReadingView(plot.kind==='panels'?panelView():`<img src="../figures/${stem}.svg"${variantAttribute} alt="${esc(plot.title)}">`,plot.title);
    const markup=`<figure id="record-figure-${plot.id}" tabindex="-1">${visual}<figcaption>${esc(plot.title)}${figureResultView(plot,e.results,esc,{publicView:true})}</figcaption>${data?`<details><summary data-observanda-label="publication:viewData">${esc(publicationText('viewData'))}</summary>${figureTable(plot)}</details>`:''}<a href="../figures/${stem}.svg" download data-observanda-label="publication:downloadSvg">${esc(publicationText('downloadSvg'))}</a>${data?` &middot; <a href="../figures/${stem}.csv" download data-observanda-label="publication:downloadCsv">${esc(publicationText('downloadCsv'))}</a>`:''}</figure>`;renderedFigures.set(plot.id,markup);if(!inline.has(plot.id))figure+=markup;
  }
  const media = e.attachments.map(attachment=>{const markup='<div id="record-figure-'+attachment.id+'" tabindex="-1">'+mediaMarkup(attachment,e,'../')+'</div>';renderedFigures.set(attachment.id,markup);return inline.has(attachment.id)?'':markup;}).join('');
  const shownFigures=new Set(),renderInline=id=>{let markup=renderedFigures.get(id)??'';if(shownFigures.has(id))markup=markup.replace(' id="record-figure-'+id+'"','');shownFigures.add(id);return markup;};
  const journeys=recordReferences(context,e,esc);
  const html = `<article class="record-page">${journeys}<div class="entry-meta"><span>${esc(e.type)}</span>${recordDateHTML(e.occurredOn,esc)}<span>${esc(e.status)}</span></div>${e.outcome?'<p><strong data-observanda-label="websiteRecordText:outcome">Outcome</strong>: '+esc(e.outcome)+'</p>':''}${e.contributors.length?`<ul class="record-contributors" aria-label="Contributors">${e.contributors.map(person=>`<li>${esc(person.name)}${person.role?` <span>(${esc(person.role)})</span>`:''}</li>`).join('')}</ul>`:''}<div class="prose rich-document">${recordProse(e.body,renderInline)}</div>${e.sections.filter(s => proseText(s.body).trim()).map((s,i) => `<section id="${esc(sectionAnchor(s))}"><h2 data-observanda-term="profile">${esc(s.title)}</h2>${s.field&&s.field.type!=='text'?'<p class="record-field-value">'+fieldValueHTML(s.field)+'</p>':`<div class="prose rich-document">${recordProse(s.body,renderInline,2)}</div>`}</section>`).join('')}${figure}${media}${e.relations.length?`<section class="record-related"><h2 data-observanda-label="websiteRecordText:relatedResearch">Related research</h2><ul>${e.relations.map(link=>`<li><span data-observanda-term="relation">${esc(link.type)}</span>: <a href="${link.kind==='workspace'?'../index.html':'../'+({record:'entries',project:'projects',notebook:'notebooks'}[link.kind])+'/'+link.id+'.html'+(link.fragment?'#'+link.fragment:'')}">${esc(link.label)}</a></li>`).join('')}</ul></section>`:''}${e.tags.length ? `<ul class="tags" aria-label="Tags">${e.tags.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}${attemptView(e.attempt,esc)}${resultStatementsView(e.results,esc,{tableView:editionParts?statement=>editionParts.retainedTable(e.id,statement.id):null})}</article>`;
  assertPublicFiles(new Map([...files,['entries/'+e.id+'.html',html]]));
  return {html,files,styles:{common:commonStyles,fonts,rich:richStyles.css,blocks:blockRules}};
}
