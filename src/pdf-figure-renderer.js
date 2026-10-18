import {renderFigure,figureTable} from './web/figure-renderer.js';
import {fontStack} from './web/font-catalogue.js';
import {PdfLayoutError} from './web/pdf-layout-model.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Render retained values, not a source resolver. Provenance stays encrypted in
// the edition and never becomes an exported path or hidden document payload.
export function pdfFigureRenderer(section,settings,textGlyphs){
 const figures=new Map((section.figures??[]).map(figure=>[figure.id,figure]));let position=0;
 return node=>{
  if(node.type!=='book_figure')return undefined;
  const a=node.attrs,figure=figures.get(a.figureId);if(!figure)throw new PdfLayoutError('PDF_UNRESOLVED_FIGURE',[section.id,a.figureId]);
  const prefix='pdf-figure-'+section.id+'-'+position++;
  const svg=renderFigure(figure,{idPrefix:prefix}).replace(/font-family="[^"]*"/g,'font-family="'+esc(fontStack(settings.font))+'"');
  const table=figureTable(figure),text=(svg+table).replace(/<[^>]+>/g,' ').replace(/&(?:amp|lt|gt|quot|#39);/g,c=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[c]));
  textGlyphs(settings.font,text+' '+a.alternative+' '+figure.title);
  return '<figure class="pdf-data-figure" data-pdf-block-id="'+a.id+'">'+svg+'<figcaption>'+esc(figure.title)+'</figcaption><p>'+esc(a.alternative)+'</p></figure><section class="pdf-figure-data">'+table+'</section>';
 };
}
// IDs inside SVG (clip paths and markers) must change together with their uses.
export function scopePdfIds(html,prefix){const ids=new Map([...html.matchAll(/ id="([^"]+)"/g)].map(match=>[match[1],prefix+match[1]]));return html.replace(/ id="([^"]+)"/g,(_,id)=>' id="'+ids.get(id)+'"').replace(/url\(#([^)]+)\)/g,(all,id)=>ids.has(id)?'url(#'+ids.get(id)+')':all).replace(/((?:href|xlink:href)="#)([^"]+)(")/g,(all,start,id,end)=>ids.has(id)?start+ids.get(id)+end:all);}
