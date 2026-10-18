import {pdfEquationAssets} from './pdf-content-blocks.js';
import {create} from 'fontkit';
import {readFile} from 'node:fs/promises';
import {BUNDLED_FONTS,faceCSS,customFontId,validCustomFont} from './web/font-catalogue.js';
import {validPdfFontPins} from './web/pdf-font-model.js';
import {inspectFont} from './font-inspector.js';
import {PdfLayoutError} from './web/pdf-layout-model.js';
// Bundled fonts and exact retained custom-font pins are embedded. Document
// names and source links never become paths or remote font requests.
export async function embedPdfFonts(compiled,{signal,maxFontBytes=32*1024*1024,customFonts=new Map()}={}){
 if(compiled?.version!==1||typeof compiled.html!=='string'||!Array.isArray(compiled.fonts)||!Number.isSafeInteger(maxFontBytes)||maxFontBytes<1||maxFontBytes>32*1024*1024)throw new PdfLayoutError('PDF_FONT');
 if(!(customFonts instanceof Map)||!validPdfFontPins(compiled.fontPins??[]))throw new PdfLayoutError('PDF_FONT');
 const styles=[];let total=0;
 for(const id of new Set(compiled.fonts)){
  const custom=customFontId(id),font=custom?customFonts.get(id):BUNDLED_FONTS.find(font=>font.id===id);if(!font)throw new PdfLayoutError('PDF_FONT',[id]);
  if(custom){
   const pin=compiled.fontPins?.find(pin=>pin.id===id);if(!pin||font.revision!==pin.revision||!validCustomFont(font)||font.id!==id||!font.embed||font.restricted||!Buffer.isBuffer(font.bytes))throw new PdfLayoutError('PDF_FONT',[id]);
   let info;try{info=inspectFont(font.bytes);}catch{throw new PdfLayoutError('PDF_FONT',[id]);}
   if(info.sha256!==id.slice(7)||info.restricted||font.faces[0].file!==id+'.'+info.extension||font.faces[0].style!==info.style||JSON.stringify(font.faces[0].weight)!==JSON.stringify(info.weight)||JSON.stringify(font.faces[0].axes)!==JSON.stringify(info.axes))throw new PdfLayoutError('PDF_FONT',[id]);
  }
  const available=new Set();
  for(const face of font.faces){
   signal?.throwIfAborted();const bytes=custom?font.bytes:await readFile(new URL('./fonts/'+face.file,import.meta.url),{signal});total+=bytes.length;
   if(total>maxFontBytes)throw new PdfLayoutError('PDF_CAPACITY');
   for(const point of create(bytes).characterSet)available.add(point);
   const type={ttf:'font/ttf',otf:'font/otf',woff:'font/woff',woff2:'font/woff2'}[face.file.split('.').at(-1)];
   styles.push(faceCSS(id,face,'data:'+type+';base64,'+bytes.toString('base64')));
  }
  const missing=(compiled.glyphs?.[id]??[]).filter(point=>!available.has(point));if(missing.length)throw new PdfLayoutError('PDF_GLYPH',[id,...missing.map(point=>'U+'+point.toString(16).toUpperCase())]);
 }
 if(compiled.equations){const math=await pdfEquationAssets({signal,maxBytes:maxFontBytes-total});styles.push(math.css);total+=math.bytes;}
 signal?.throwIfAborted();return {...compiled,html:compiled.html.replace('</head>','<style>'+styles.join('\n')+'</style></head>'),fontBytes:total};
}
