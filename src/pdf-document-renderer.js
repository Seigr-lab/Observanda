import {pdfAccessibilityLayout} from './pdf-accessibility-layout.js';
import {pdfCrossReferences} from './pdf-cross-references.js';
import {PDF_CROSS_REFERENCE_PREFIX} from './web/pdf-cross-reference-model.js';
import {applyPdfPagination} from './pdf-pagination.js';
import {pdfCaptionRenderer} from './pdf-caption-renderer.js';
import {renderPdfComposition} from './pdf-composition.js';
import {pdfAudienceSelection} from './pdf-audience.js';
import {pdfPageMasterCSS,pdfPageMasterText,pdfPageContentBox,pdfPageMasterHasSection} from './pdf-page-master.js';
import {renderPdfNotes,renderPdfEndnotes} from './pdf-note-renderer.js';
import {proseDocument} from './web/prose-model.js';
import {renderPdfImages} from './pdf-image-renderer.js';
import {pdfDocumentOutline} from './pdf-document-outline.js';
import {pdfFigureRenderer,scopePdfIds} from './pdf-figure-renderer.js';
import {pdfBlockRenderer} from './pdf-content-blocks.js';
import {renderRichText,richTextStyles,safeRichLink} from './web/rich-text-model.js';
import {fontStack,BUNDLED_FONTS} from './web/font-catalogue.js';
import {PdfLayoutError,validPdfDocumentHeader,validPdfSection,pdfSectionContent} from './web/pdf-layout-model.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cssText=value=>JSON.stringify(value).replace(/</g,'\\3c ').replace(/>/g,'\\3e ');
export const PDF_RENDERER_VERSION=1;
export const PDF_INPUT_BYTES=16*1024*1024;
function layoutCSS(layout,name){
 if(layout.pageMaster)layout={...layout,header:'',footer:'',pageNumbers:false};
 const {widthMm,heightMm,margins,font,fontSizePt,lineHeight,columns,columnGapMm,header,footer,pageNumbers,background,color}=layout;
 return `@page ${name}{size:${widthMm}mm ${heightMm}mm;margin:${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;background:${background};@top-center{content:${cssText(header)};font:9pt ${fontStack(font)};color:${color}}@bottom-left{content:${cssText(footer)};font:9pt ${fontStack(font)};color:${color}}@bottom-right{content:${pageNumbers?'counter(page)':'none'};font:9pt ${fontStack(font)};color:${color}}}
 .${name}{page:${name};font-family:${fontStack(font)};font-size:${fontSizePt}pt;line-height:${lineHeight};color:${color};column-count:${columns};column-gap:${columnGapMm}mm}`;
}
const sheet=`.rt-align-start{text-align:start}.rt-align-end{text-align:end}.rt-align-left{text-align:left}.rt-align-right{text-align:right}.rt-align-center{text-align:center}.rt-align-justify{text-align:justify}*{box-sizing:border-box}html,body{margin:0;padding:0}body{overflow-wrap:anywhere;print-color-adjust:exact;-webkit-print-color-adjust:exact}p{margin:0 0 .8em;orphans:3;widows:3}h1,h2,h3,h4,h5,h6{break-after:avoid;margin:0 0 .6em;line-height:1.2}h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.2em}blockquote{margin:1em 0;padding-inline-start:1em;border-inline-start:2pt solid #ccd2dc}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:inherit}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{text-align:start;vertical-align:top;padding:2mm;border:.25mm solid #ccd2dc;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}caption{text-align:start;font-weight:bold;margin-block:2mm}figure{margin:1em 0;break-inside:avoid}svg,img{max-width:100%;height:auto}details,.book-table-linear{display:none}.book-table-scroll{overflow:visible}svg text{font-family:inherit}.book-equation{overflow:visible}.book-sketch svg{display:block;width:100%;height:auto}.pdf-note-reference{margin-inline:.1em}.pdf-section-notes{margin-top:1em;border-top:.2mm solid #ccd2dc;padding-top:3mm}.pdf-endnotes{break-before:page}.pdf-contents,.pdf-caption-list{break-after:page}.pdf-caption-list li{margin-block:2mm}.pdf-page-reference{display:inline-block;width:16ch;white-space:nowrap;text-align:end;flex-shrink:0;font-variant-numeric:tabular-nums}.pdf-caption-list li:has(.pdf-page-reference),.pdf-contents li:has(.pdf-page-reference){display:flex;justify-content:space-between;gap:2mm}.pdf-caption-list li:has(.pdf-page-reference)>a,.pdf-contents li:has(.pdf-page-reference)>a{min-width:0;flex:1}.pdf-caption-list a{text-decoration:none}.pdf-contents ol{padding:0;list-style:none}.pdf-contents li{margin-block:2mm}.pdf-contents a{text-decoration:none}.pdf-section+.pdf-section{margin-top:1em}.pdf-section[data-start=page]{break-before:page}.pdf-section[data-start=recto]{break-before:recto}.pdf-section[data-start=verso]{break-before:verso}`;
// Consume selected sections in order. Source authorization and revision pinning
// belong to the document owner; this compiler never resolves current research.
export async function compilePdfDocument(header,sections,{signal,maxBytes=PDF_INPUT_BYTES,readImage}={}){
 if(!validPdfDocumentHeader(header)||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>PDF_INPUT_BYTES)throw new PdfLayoutError('PDF_LAYOUT');
 const pageReferences=[],audience=pdfAudienceSelection(header),outline=pdfDocumentOutline(header,{pageReference}),ids=new Set(),fonts=new Set(),styles=new Set(),body=[],layouts=new Map(),glyphs=new Map();let size=0,count=0,equations=false,noteNumber=1,pageFootnoteCount=0;const endnotes=[];
 const retain=text=>{size+=Buffer.byteLength(text);if(size>maxBytes)throw new PdfLayoutError('PDF_CAPACITY');return text;};
 function layout(value,sectionTitle=''){const key=JSON.stringify([value,pdfPageMasterHasSection(value)?sectionTitle:'']);if(!layouts.has(key)){const name='pdf-layout-'+layouts.size;layouts.set(key,{name,value,sectionTitle});styles.add(retain(layoutCSS(value,name)+pdfPageMasterCSS(value,name,{sectionTitle})));}fonts.add(value.font);return layouts.get(key).name;}
 function textGlyphs(font,text){let points=glyphs.get(font);if(!points){points=new Set();glyphs.set(font,points);}for(const char of text)if(!/[\s\p{Default_Ignorable_Code_Point}]/u.test(char))points.add(char.codePointAt(0));}
 function pageReference(target,settings){
  if(!header.structure?.pageReferences)return '';if(pageReferences.length>=12000)throw new PdfLayoutError('PDF_CAPACITY');
  const id='pdf-reference-field-'+pageReferences.length;pageReferences.push({id,target,style:settings.pageMaster?.numberStyle??'decimal',start:header.layout.pageMaster?.numberStart??1});textGlyphs(header.layout.font,'0123456789IVXLCDMivxlcdm');
  return '<span class="pdf-page-reference" id="'+id+'">0000000000</span>';
 }
 const crossReferences=pdfCrossReferences(header,{textGlyphs,maxBytes,signal});
 const captions=pdfCaptionRenderer(header,{maxBytes,textGlyphs,pageReference,signal});
 const defaultLayout=layout(header.layout);textGlyphs(header.layout.font,header.layout.pageMaster?pdfPageMasterText(header.layout,''):[header.layout.header,header.layout.footer,...(header.layout.pageNumbers?['0123456789']:[])].join(' '));
 styles.add(layoutCSS(header.layout,'').split('\n .')[0]+pdfPageMasterCSS(header.layout,''));
 for await(const section of audience.sections(sections,{signal})){
  signal?.throwIfAborted();if(!validPdfSection(section)||ids.has(section.id))throw new PdfLayoutError('PDF_SECTION');ids.add(section.id);count++;
  const heading=outline.section(section),content=pdfSectionContent(section),settings=section.layout??header.layout,name=section.layout||pdfPageMasterHasSection(settings)?layout(settings,heading.title):defaultLayout,contentBox=pdfPageContentBox(settings);
  function project(node){
   const result={...node};

   if(node.type==='book_citation'&&(settings.links==='disabled'||!outline.settings.externalLinks))result.attrs={...node.attrs,url:''};
   if(node.type==='text'&&!node.marks?.some(mark=>mark.type==='link'&&mark.attrs.href.startsWith(PDF_CROSS_REFERENCE_PREFIX)))textGlyphs(node.marks?.find(mark=>mark.type==='font_family')?.attrs.font??settings.font,node.text);
   if(node.type==='book_table')textGlyphs(settings.font,[node.attrs.title,...node.attrs.headers,...node.attrs.rows.flat()].join(' '));
   if(node.type==='book_citation')textGlyphs(settings.font,[node.attrs.title,node.attrs.authors,node.attrs.issued,node.attrs.locator].join(' '));
   if(node.type==='book_preserved')textGlyphs(settings.font,[node.attrs.source,node.attrs.reason,node.attrs.format].join(' '));
   if(node.content)result.content=node.content.flatMap(child=>{const projected=project(child),href=child.marks?.find(mark=>mark.type==='link')?.attrs.href;if(outline.settings.printUrls&&href&&/^(?:https?:|mailto:|tel:)/.test(href)){textGlyphs(settings.font,href);return [projected,{type:'text',text:' ('+href+')'}];}return [projected];});

   return result;
  }
  textGlyphs(settings.font,pdfPageMasterText(settings,heading.title));
  textGlyphs(settings.font,[heading.title,...(settings.pageMaster?[]:[settings.header,settings.footer,...(settings.pageNumbers?['0123456789']:[])])].join(' '));
  const projected=crossReferences.project(project(content),{sectionId:section.id,layout:settings}),rich=richTextStyles([projected]);for(const font of rich.fonts)fonts.add(font);styles.add(retain(rich.css));
  const blocks=pdfBlockRenderer(settings,{textGlyphs,sectionId:section.id}),figure=pdfFigureRenderer(section,settings,textGlyphs);
  const images=await renderPdfImages(section,readImage,{signal,textGlyphs,font:settings.font}),parts=projected.content??[],chunks=[],render=nodes=>renderRichText({type:'doc',content:nodes},{block:node=>figure(node)??blocks.render(node),resolveLink:href=>safeRichLink(href)?outline.link(href,section.id,settings):null});
  const notes=await renderPdfNotes(section,{startNumber:noteNumber,signal,textGlyphs,font:settings.font,fontSizePt:settings.fontSizePt,lineHeight:settings.lineHeight,links:settings.links!=='disabled'&&outline.settings.internalLinks,renderContent:content=>{const note=crossReferences.project(project(proseDocument(content)),{sectionId:section.id,layout:settings}),rich=richTextStyles([note]);for(const font of rich.fonts)fonts.add(font);styles.add(retain(rich.css));return render(note.content??[]);}});noteNumber=notes.nextNumber;pageFootnoteCount+=notes.pageFootnotes.length;for(const entry of notes.endnotes)endnotes.push(retain(entry));
  const pagination=applyPdfPagination(section,parts.map(part=>render([part])),{signal}),blockHTML=pagination.blocks.map((html,index)=>html.replace(/^<([a-z][a-z0-9:-]*)(?=[\s>])/i,(_,tag)=>'<'+tag+' data-pdf-source-block-index="'+index+'"'));if(pagination.active)styles.add(retain(pagination.css));
  for(let at=0;at<=parts.length;at++){for(const reference of notes.references)if(Math.min(reference.block,parts.length)===at)chunks.push(reference.html);for(const image of images)if(Math.min(image.block,parts.length)===at)chunks.push(image.html);if(at<parts.length)chunks.push(blockHTML[at]);}
  const titleHTML=section.title?'<h'+heading.level+'>'+esc(heading.title)+'</h'+heading.level+'>':'',composition=section.composition?renderPdfComposition(section,settings,{blocks:blockHTML,images:images.map((image,index)=>({id:section.images[index].id,html:image.html})),titleHTML,notesHTML:notes.sectionNotes,references:notes.references,signal}):null;
  if(composition)styles.add(retain(composition.css));
  const captioned=captions.section(scopePdfIds((composition?composition.html:chunks.join('')+notes.sectionNotes)+notes.pageFootnotes.join(''),'pdf-section-'+section.id+'-'),{sectionId:section.id,font:settings.font,links:settings.links,layout:settings});crossReferences.section(section,heading,captioned.targets);const html=captioned.html;
  equations ||= blocks.equations;
  body.push(retain(`<section id="pdf-section-${section.id}" class="pdf-section ${name}${composition?' pdf-composed-section':''}" data-pdf-width-mm="${contentBox.widthMm}" data-pdf-height-mm="${contentBox.heightMm}"${section.start?` data-start="${section.start}"`:''}>${composition?'':titleHTML}${html}</section>`));
 }
 const endnoteHTML=renderPdfEndnotes(endnotes,{textGlyphs,font:header.layout.font,layoutClass:defaultLayout});
 signal?.throwIfAborted();if(!count)throw new PdfLayoutError('PDF_EMPTY');
 // System/custom fallbacks are not reproducible. An asset adapter must qualify
// those fonts before the compiler will accept them.
 for(const font of fonts)if(!BUNDLED_FONTS.some(item=>item.id===font)&&!header.fonts?.some(pin=>pin.id===font))throw new PdfLayoutError('PDF_FONT',[font]);
 const contents=outline.contents().replace('class="pdf-contents"','class="pdf-contents '+defaultLayout+'"');if(contents)textGlyphs(header.layout.font,outline.text());
 const lists=captions.lists().replaceAll('class="pdf-caption-list ','class="pdf-caption-list '+defaultLayout+' ');
 const html=`<!doctype html><html lang="${esc(header.language)}" dir="${header.direction}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'"><title>${esc(header.name)}</title><style>${sheet}\n${[...styles].join('\n')}</style></head><body>${contents}${lists}${outline.finish(crossReferences.finish(body.join('')+endnoteHTML))}</body></html>`;
 if(Buffer.byteLength(html)>maxBytes)throw new PdfLayoutError('PDF_CAPACITY');
 return {version:PDF_RENDERER_VERSION,accessibilityLayout:pdfAccessibilityLayout(layouts.values(),{numberStart:header.layout.pageMaster?.numberStart??1}),...(header.outputProfile?{outputProfile:header.outputProfile}:{}),...(header.press?{press:{...header.press}}:{}),...(pageFootnoteCount?{footnoteFlow:{version:1,defaultLayout,layouts:[...layouts.values()].map(({name,value})=>({name,...pdfPageContentBox(value),columns:value.columns,columnGapMm:value.columnGapMm})).map(({columnWidthMm,...layout})=>layout)}}:{}),pageReferences,bookmarks:header.structure?.bookmarks??true,html,fonts:[...fonts],fontPins:header.fonts??[],equations,glyphs:Object.fromEntries([...glyphs].map(([font,points])=>[font,[...points]])),sections:count};
}
