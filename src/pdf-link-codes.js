import {setImmediate} from 'node:timers/promises';
import QRCode from 'qrcode';
import {safeRichLink} from './web/rich-text-model.js';
import {PdfLayoutError} from './web/pdf-layout-model.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const PDF_LINK_CODE_URL_BYTES=1024;
export const PDF_LINK_CODE_MODULE_MM=.4;
export const PDF_LINK_CODE_CSS='.pdf-link-codes{margin-top:4mm}.pdf-link-code{break-inside:avoid;margin:0 0 4mm}.pdf-link-code svg{display:block;max-width:none}.pdf-link-code figcaption{margin-top:2mm;overflow-wrap:anywhere;text-align:start}';
// One collector belongs to one already audience-selected section. Observe the
// original nodes before link policy removes interactive destinations. Generated
// codes are decorative link alternatives, never caption-numbered source figures.
export function pdfLinkCodes({enabled=false,sectionId,columnWidthMm,heightMm,maxBytes=16*1024*1024,signal,textGlyphs=()=>{},font}={}){
 const urls=new Set();let sourceBytes=0;
 function add(url){
  signal?.throwIfAborted();
  if(!enabled||typeof url!=='string'||!/^(?:https?:|mailto:|tel:)/i.test(url)||!safeRichLink(url)||urls.has(url))return;
  const bytes=Buffer.byteLength(url);if(bytes>PDF_LINK_CODE_URL_BYTES||(sourceBytes+=bytes)>maxBytes)throw new PdfLayoutError('PDF_CAPACITY',[sectionId]);
  urls.add(url);
 }
 function observe(node){
  if(!enabled)return;
  if(node.type==='text')for(const mark of node.marks??[])if(mark.type==='link')add(mark.attrs?.href);
  if(node.type==='book_citation')add(node.attrs?.url);
 }
 async function render(){
  signal?.throwIfAborted();if(!urls.size)return '';
  const pieces=['<div class="pdf-link-codes">'];let bytes=Buffer.byteLength(pieces[0])+6;
  for(const url of urls){
   if(pieces.length>1)await setImmediate(undefined,{signal});
   signal?.throwIfAborted();
   const {modules}=QRCode.create(url,{errorCorrectionLevel:'M'}),edge=modules.size+8,sizeMm=Math.max(24,edge*PDF_LINK_CODE_MODULE_MM);
   if(!Number.isFinite(columnWidthMm)||sizeMm>columnWidthMm+1e-7||!Number.isFinite(heightMm)||sizeMm>heightMm+1e-7)throw new PdfLayoutError('PDF_LINK_CODE_LAYOUT',[sectionId]);
   // Consecutive black modules form integer-grid rectangles. Four white modules
   // surround every edge; physical dimensions cannot shrink to fit a narrow box.
   const runs=[];
   for(let y=0;y<modules.size;y++){
    signal?.throwIfAborted();
    for(let x=0;x<modules.size;){if(!modules.get(y,x)){x++;continue;}const start=x;while(x<modules.size&&modules.get(y,x))x++;const length=x-start;runs.push('M'+(start+4)+' '+(y+4)+'h'+length+'v1h-'+length+'z');}
   }
   const label='QR code for '+url,html='<figure class="pdf-link-code"><svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="'+esc(label)+'" width="'+sizeMm+'mm" height="'+sizeMm+'mm" viewBox="0 0 '+edge+' '+edge+'" style="width:'+sizeMm+'mm;min-width:'+sizeMm+'mm;height:'+sizeMm+'mm;max-width:none" shape-rendering="crispEdges"><title>'+esc(label)+'</title><rect width="'+edge+'" height="'+edge+'" fill="#ffffff"/><path fill="#000000" d="'+runs.join('')+'"/></svg><figcaption dir="ltr">'+esc(url)+'</figcaption></figure>';
   bytes+=Buffer.byteLength(html);if(bytes>maxBytes)throw new PdfLayoutError('PDF_CAPACITY',[sectionId]);
   textGlyphs(font,url);pieces.push(html);
  }
  return pieces.join('')+'</div>';
 }
 return {observe,render};
}
