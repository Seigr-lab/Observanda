import {readFile} from 'node:fs/promises';
// A fixed, locally packaged PDF.js build parses only retained preview bytes.
// No document can choose an asset path or load a remote viewer dependency.
export async function pdfPreviewAssets({deferred=false}={}){
 const base=new URL('./',import.meta.resolve('pdfjs-dist/package.json'));
 return Promise.all([['pdf.js','build/pdf.min.mjs'],['pdf.worker.js','build/pdf.worker.min.mjs'],['LICENSE.txt','LICENSE']].map(async([name,file])=>['vendor/pdfjs/'+name,deferred?new URL(file,base):await readFile(new URL(file,base))]));
}
