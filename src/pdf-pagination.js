import {PdfLayoutError} from './web/pdf-layout-model.js';
import {validPdfPagination,pdfPaginationStatus} from './web/pdf-pagination-model.js';
// Only explicitly configured prose blocks get a wrapper. Native table/figure
// pagination and every unconfigured fragment retain their original markup.
export const PDF_PAGINATION_CSS='.pdf-pagination-block{break-after:var(--pdf-keep-next);break-inside:var(--pdf-keep-together)}.pdf-pagination-block>:first-child{break-after:inherit}.pdf-pagination-block :is(p,h1,h2,h3,h4,h5,h6,blockquote,li,pre){widows:var(--pdf-widows);orphans:var(--pdf-orphans)}';
export function applyPdfPagination(section,blocks,{signal}={}){
 signal?.throwIfAborted();const value=section.pagination;if(value&&!validPdfPagination(value))throw new PdfLayoutError('PDF_PAGINATION');
 if(!value?.rules.length||section.composition)return {blocks,css:'',active:false};const status=pdfPaginationStatus(section);
 if(status.stale||!Array.isArray(blocks)||blocks.length!==status.blockCount||!blocks.every(block=>typeof block==='string'))throw new PdfLayoutError('PDF_PAGINATION_STALE',[section.id]);
 const rules=new Map(value.rules.map(rule=>[rule.block,rule])),rendered=blocks.map((html,index)=>{signal?.throwIfAborted();const rule=rules.get(index);if(!rule)return html;return '<div class="pdf-pagination-block" data-pdf-pagination-block="'+index+'" style="--pdf-keep-next:'+(rule.keepWithNext?'avoid':'auto')+';--pdf-keep-together:'+(rule.keepTogether?'avoid':'auto')+';--pdf-widows:'+rule.widows+';--pdf-orphans:'+rule.orphans+'">'+html+'</div>';});
 return {blocks:rendered,css:PDF_PAGINATION_CSS,active:true};
}
