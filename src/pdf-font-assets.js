import {pdfEquationAssets} from './pdf-content-blocks.js';
import {create} from 'fontkit';
import {readFile} from 'node:fs/promises';
import {BUNDLED_FONTS,faceCSS} from './web/font-catalogue.js';
import {PdfLayoutError} from './web/pdf-layout-model.js';
// Only pinned, distributed fonts are read. Document names and source links
// never become filesystem paths or remote font requests.
export async function embedPdfFonts(compiled,{signal,maxFontBytes=32*1024*1024}={}){
 if(compiled?.version!==1||typeof compiled.html!=='string'||!Array.isArray(compiled.fonts)||!Number.isSafeInteger(maxFontBytes)||maxFontBytes<1||maxFontBytes>32*1024*1024)throw new PdfLayoutError('PDF_FONT');
 const styles=[];let total=0;
 for(const id of new Set(compiled.fonts)){
  const font=BUNDLED_FONTS.find(font=>font.id===id);if(!font)throw new PdfLayoutError('PDF_FONT',[id]);
  const available=new Set();
  for(const face of font.faces){
   signal?.throwIfAborted();const bytes=await readFile(new URL('./fonts/'+face.file,import.meta.url),{signal});total+=bytes.length;
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
