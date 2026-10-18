import {pdfBlockRenderer} from './pdf-content-blocks.js';
import {renderRichText,richTextStyles,safeRichLink} from './web/rich-text-model.js';
import {fontStack,BUNDLED_FONTS} from './web/font-catalogue.js';
import {parseResearchReference} from './web/research-reference.js';
import {PdfLayoutError,validPdfDocumentHeader,validPdfSection,pdfSectionContent} from './web/pdf-layout-model.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cssText=value=>JSON.stringify(value).replace(/</g,'\\3c ').replace(/>/g,'\\3e ');
export const PDF_RENDERER_VERSION=1;
export const PDF_INPUT_BYTES=16*1024*1024;
function layoutCSS(layout,name){
 const {widthMm,heightMm,margins,font,fontSizePt,lineHeight,columns,columnGapMm,header,footer,pageNumbers,background,color}=layout;
 return `@page ${name}{size:${widthMm}mm ${heightMm}mm;margin:${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;background:${background};@top-center{content:${cssText(header)};font:9pt ${fontStack(font)};color:${color}}@bottom-left{content:${cssText(footer)};font:9pt ${fontStack(font)};color:${color}}@bottom-right{content:${pageNumbers?'counter(page)':'none'};font:9pt ${fontStack(font)};color:${color}}}
 .${name}{page:${name};font-family:${fontStack(font)};font-size:${fontSizePt}pt;line-height:${lineHeight};color:${color};column-count:${columns};column-gap:${columnGapMm}mm}`;
}
const sheet=`*{box-sizing:border-box}html,body{margin:0;padding:0}body{overflow-wrap:anywhere;print-color-adjust:exact;-webkit-print-color-adjust:exact}p{margin:0 0 .8em;orphans:3;widows:3}h1,h2,h3,h4,h5,h6{break-after:avoid;margin:0 0 .6em;line-height:1.2}h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.2em}blockquote{margin:1em 0;padding-inline-start:1em;border-inline-start:2pt solid #ccd2dc}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:inherit}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{text-align:start;vertical-align:top;padding:2mm;border:.25mm solid #ccd2dc;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}caption{text-align:start;font-weight:bold;margin-block:2mm}figure{margin:1em 0;break-inside:avoid}svg,img{max-width:100%;height:auto}details,.book-table-linear{display:none}.book-table-scroll{overflow:visible}svg text{font-family:inherit}.book-equation{overflow:visible}.book-sketch svg{display:block;width:100%;height:auto}.pdf-section+.pdf-section{margin-top:1em}.pdf-section[data-start=page]{break-before:page}.pdf-section[data-start=recto]{break-before:recto}.pdf-section[data-start=verso]{break-before:verso}`;
// Consume selected sections in order. Source authorization and revision pinning
// belong to the document owner; this compiler never resolves current research.
export async function compilePdfDocument(header,sections,{signal,maxBytes=PDF_INPUT_BYTES}={}){
 if(!validPdfDocumentHeader(header)||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>PDF_INPUT_BYTES)throw new PdfLayoutError('PDF_LAYOUT');
 const ids=new Set(),fonts=new Set(),styles=new Set(),body=[],layouts=new Map(),glyphs=new Map();let size=0,count=0,equations=false;
 const retain=text=>{size+=Buffer.byteLength(text);if(size>maxBytes)throw new PdfLayoutError('PDF_CAPACITY');return text;};
 function layout(value){const key=JSON.stringify(value);if(!layouts.has(key)){const name='pdf-layout-'+layouts.size;layouts.set(key,{name,value});styles.add(retain(layoutCSS(value,name)));}fonts.add(value.font);return layouts.get(key).name;}
 function textGlyphs(font,text){let points=glyphs.get(font);if(!points){points=new Set();glyphs.set(font,points);}for(const char of text)if(!/[\s\p{Default_Ignorable_Code_Point}]/u.test(char))points.add(char.codePointAt(0));}
 const defaultLayout=layout(header.layout);
 styles.add(layoutCSS(header.layout,'').split('\n .')[0]);
 for await(const section of sections){
  signal?.throwIfAborted();if(!validPdfSection(section)||ids.has(section.id))throw new PdfLayoutError('PDF_SECTION');ids.add(section.id);count++;
  const content=pdfSectionContent(section),settings=section.layout??header.layout,name=section.layout?layout(settings):defaultLayout;
  function project(node){
   const result={...node};
   if(node.type==='book_figure')throw new PdfLayoutError('PDF_UNRESOLVED_FIGURE',[section.id,node.attrs.figureId]);
   if(node.type==='book_citation'&&settings.links==='disabled')result.attrs={...node.attrs,url:''};
   if(node.type==='text')textGlyphs(node.marks?.find(mark=>mark.type==='font_family')?.attrs.font??settings.font,node.text);
   if(node.type==='book_table')textGlyphs(settings.font,[node.attrs.title,...node.attrs.headers,...node.attrs.rows.flat()].join(' '));
   if(node.type==='book_citation')textGlyphs(settings.font,[node.attrs.title,node.attrs.authors,node.attrs.issued,node.attrs.locator].join(' '));
   if(node.type==='book_preserved')textGlyphs(settings.font,[node.attrs.source,node.attrs.reason,node.attrs.format].join(' '));
   if(node.content)result.content=node.content.map(project);
   for(const mark of node.marks??[])if(mark.type==='link'&&(parseResearchReference(mark.attrs.href)||! /^(?:https?:|mailto:|tel:)/.test(mark.attrs.href)))throw new PdfLayoutError('PDF_UNRESOLVED_REFERENCE',[section.id]);
   return result;
  }
  textGlyphs(settings.font,[section.title,settings.header,settings.footer,...(settings.pageNumbers?['0123456789']:[])].join(' '));
  const projected=project(content),rich=richTextStyles([projected]);for(const font of rich.fonts)fonts.add(font);styles.add(retain(rich.css));
  const blocks=pdfBlockRenderer(settings,{textGlyphs,sectionId:section.id});
  const html=renderRichText(projected,{block:node=>blocks.render(node),resolveLink:href=>settings.links==='disabled'?null:safeRichLink(href)&&/^(?:https?:|mailto:|tel:)/.test(href)?href:null}).replace(/ id="/g,' id="pdf-section-'+section.id+'-');
  equations ||= blocks.equations;
  body.push(retain(`<section id="pdf-section-${section.id}" class="pdf-section ${name}"${section.start?` data-start="${section.start}"`:''}>${section.title?`<h1>${esc(section.title)}</h1>`:''}${html}</section>`));
 }
 signal?.throwIfAborted();if(!count)throw new PdfLayoutError('PDF_EMPTY');
 // System/custom fallbacks are not reproducible. An asset adapter must qualify
// those fonts before the compiler will accept them.
 for(const font of fonts)if(!BUNDLED_FONTS.some(item=>item.id===font))throw new PdfLayoutError('PDF_FONT',[font]);
 const html=`<!doctype html><html lang="${esc(header.language)}" dir="${header.direction}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'"><title>${esc(header.name)}</title><style>${sheet}\n${[...styles].join('\n')}</style></head><body>${body.join('')}</body></html>`;
 if(Buffer.byteLength(html)>maxBytes)throw new PdfLayoutError('PDF_CAPACITY');
 return {version:PDF_RENDERER_VERSION,html,fonts:[...fonts],equations,glyphs:Object.fromEntries([...glyphs].map(([font,points])=>[font,[...points]])),sections:count};
}
