import katex from 'katex';
import {readFile} from 'node:fs/promises';
import {renderSketch} from './web/sketch-renderer.js';
import {PdfLayoutError} from './web/pdf-layout-model.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function pdfBlockRenderer(settings,{textGlyphs,sectionId}){
 let equations=false;
 return {get equations(){return equations;},render(node){
  const a=node.attrs;
  if(node.type==='book_equation'){
   let html;
   try{html=katex.renderToString(a.source,{output:'htmlAndMathml',displayMode:true,trust:()=>{throw new Error('External equation content');},strict:'error',throwOnError:true,maxExpand:100,maxSize:20,macros:{}});}catch{throw new PdfLayoutError('PDF_EQUATION',[sectionId,a.id]);}
   equations=true;textGlyphs(settings.font,a.label);
   return '<figure class="book-equation" id="record-equation-'+a.id+'"><div role="math" aria-label="'+esc(a.label)+'">'+html+'</div><figcaption>'+esc(a.label)+'</figcaption></figure>';
  }
  if(node.type==='book_sketch'){
   textGlyphs(settings.font,[a.title,a.description,...a.items.filter(item=>item.kind==='text').map(item=>item.text)].join(' '));
   return '<figure class="book-sketch" id="record-block-'+a.id+'">'+renderSketch(a)+'<figcaption>'+esc(a.title)+'</figcaption><p>'+esc(a.description)+'</p></figure>';
  }
  return undefined;
 }};
}
// CSS and font paths come only from the pinned KaTeX distribution. The
// document cannot select a path, request a font, or trigger a network load.
let mathAssets;
export async function pdfEquationAssets({signal,maxBytes}={}){
 signal?.throwIfAborted();
 const result=await (mathAssets??=(async()=>{
  const base=new URL('./',import.meta.resolve('katex'));let css=await readFile(new URL('katex.min.css',base),'utf8'),bytes=0;
  for(const file of new Set([...css.matchAll(/url\(([^)]+)\)/g)].map(match=>match[1]))){
   if(!/^fonts\/KaTeX_[A-Za-z0-9-]+\.(?:woff2?|ttf)$/.test(file))throw new PdfLayoutError('PDF_FONT');
   const font=await readFile(new URL(file,base)),type=file.endsWith('.woff2')?'woff2':file.endsWith('.woff')?'woff':'ttf';bytes+=font.length;
   css=css.split('url('+file+')').join('url(data:font/'+type+';base64,'+font.toString('base64')+')');
  }
  return {css,bytes};
 })().catch(error=>{mathAssets=null;throw error;}));
 signal?.throwIfAborted();if(maxBytes!==undefined&&result.bytes>maxBytes)throw new PdfLayoutError('PDF_CAPACITY');return result;
}
