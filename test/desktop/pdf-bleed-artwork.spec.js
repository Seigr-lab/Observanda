import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {PDFDocument} from '@cantoo/pdf-lib';
import {createCanvas} from '@napi-rs/canvas';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
import {preparePdfBleedImage} from '../../src/pdf-bleed-artwork.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {bleedPicture} from '../fixtures/pdf-bleed-image.js';
const mm=n=>n*72/25.4;
function semanticTree(tree,items){
 const text=new Map(),stack=[];for(const item of items){if(item.type==='beginMarkedContent'||item.type==='beginMarkedContentProps')stack.push(item.id??null);else if(item.type==='endMarkedContent')stack.pop();else if(typeof item.str==='string')for(const id of stack)if(id)text.set(id,(text.get(id)??'')+item.str);}
 const visit=node=>{if(node.type==='content'){const value=text.get(node.id);return value?{text:value}:null;}if(node.type==='annotation')return {type:'annotation'};return {...(node.role?{role:node.role}:{}),...(node.alt?{alt:node.alt}:{}),children:(node.children??[]).map(visit).filter(Boolean)};};return visit(tree);
}
async function inspect(bytes,info,label){
 const parsed=await PDFDocument.load(bytes,{updateMetadata:false}),task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false}),rows=[];
 try{const document=await task.promise;expect(document.numPages).toBe(2);for(let index=0;index<2;index++){
  const page=await document.getPage(index+1),viewport=page.getViewport({scale:1}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height)),context=canvas.getContext('2d');await page.render({canvasContext:context,viewport}).promise;
  const sample=(x,y)=>{const [px,py]=viewport.convertToViewportPoint(x,y);return [...context.getImageData(Math.floor(px),Math.floor(py),1,1).data].slice(0,3);},box=parsed.getPage(index).getTrimBox();
  rows.push({inside:sample(mm(1),box.height/2),bleed:sample(-mm(1),box.height/2),outside:sample(-mm(4),box.height/2),right:sample(box.width+mm(1),box.height/2),text:(await page.getTextContent()).items.filter(item=>item.str).map(item=>({str:item.str,transform:item.transform})),tags:semanticTree(await page.getStructTree(),(await page.getTextContent({includeMarkedContent:true})).items),links:(await page.getAnnotations()).filter(item=>item.subtype==='Link').map(({url,dest,rect})=>({url,dest,rect})),trim:box});
  await writeFile(info.outputPath(label+'-'+(index+1)+'.png'),canvas.toBuffer('image/png'));
 }return rows;}finally{await task.destroy();}
}
test('actual bleed artwork crosses trim with exact crop and physical page scope while preserving tagged mixed-size content',async({},info)=>{
 const parent=path.resolve(os.tmpdir()),profile=await mkdtemp(path.join(parent,'observanda-pdf-bleed-')),env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;let app;
 try{
  const layout=pdfLayoutPreset(),header={version:1,id:randomUUID(),name:'Decorative print background',language:'en',direction:'ltr',layout},sections=[{id:randomUUID(),title:'Portrait original',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Exact linked text',marks:[{type:'link',attrs:{href:'https://example.org/retained',title:'',target:'_self',nofollow:false}}]}]}]},layout:null,start:null},{id:randomUUID(),title:'Landscape original',content:'Second retained page.',layout:{...structuredClone(layout),widthMm:297,heightMm:210},start:'page'}],picture=bleedPicture();
  app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});await app.evaluate(({app})=>{globalThis.bleedShown=0;app.on('browser-window-created',(_event,win)=>win.on('show',()=>globalThis.bleedShown++));});
  const render=async(press,label)=>{const input=await embedPdfFonts(await compilePdfDocument({...header,press},sections));const image=await preparePdfBleedImage(press,async()=>picture);if(image)input.bleedImage=image;const output=await app.evaluate(async({BrowserWindow},input)=>{const {renderPdfDocument}=await globalThis.pdfService,result=await renderPdfDocument(input);return {pdf:result.bytes?.toString('base64'),preflight:result.preflight,shown:globalThis.bleedShown,windows:BrowserWindow.getAllWindows().length};},input);expect(output.preflight.status).not.toBe('fatal');expect(output.shown).toBe(0);expect(output.windows).toBe(0);const bytes=Buffer.from(output.pdf,'base64');await writeFile(info.outputPath(label+'.pdf'),bytes);return inspect(bytes,info,label);};
  const baseline=await render({version:1,bleedMm:3,cropMarks:true},'baseline');for(const page of baseline){expect(page.inside).toEqual([255,255,255]);expect(page.bleed).toEqual([255,255,255]);expect(page.tags).toBeTruthy();}
  const artwork={background:'#00ff00',image:{asset:picture.asset,crop:{x:0,y:50}},pages:'all'};
  const all=await render({version:2,bleedMm:3,cropMarks:true,artwork},'all-left');for(const page of all){expect(page.inside).toEqual([255,0,0]);expect(page.bleed).toEqual([255,0,0]);expect(page.outside).toEqual([255,255,255]);}
  const first=await render({version:2,bleedMm:3,cropMarks:true,artwork:{...artwork,pages:'first',image:{asset:picture.asset,crop:{x:100,y:50}}}},'first-right');expect(first[0].inside).toEqual([0,0,255]);expect(first[0].bleed).toEqual([0,0,255]);expect(first[1].inside).toEqual([255,255,255]);expect(first[1].bleed).toEqual([255,255,255]);
  const after=await render({version:2,bleedMm:3,cropMarks:true,artwork:{...artwork,pages:'except-first',image:null}},'except-first');expect(after[0].inside).toEqual([255,255,255]);expect(after[0].bleed).toEqual([255,255,255]);expect(after[1].inside).toEqual([0,255,0]);expect(after[1].bleed).toEqual([0,255,0]);
  for(const result of [all,first,after])for(let index=0;index<2;index++){expect(result[index].text).toEqual(baseline[index].text);expect(result[index].tags).toEqual(baseline[index].tags);expect(result[index].links).toEqual(baseline[index].links);expect(result[index].trim).toEqual(baseline[index].trim);}expect(all[0].links.some(link=>link.url==='https://example.org/retained')).toBe(true);
 }finally{await app?.close();if(path.dirname(profile)!==parent||!path.basename(profile).startsWith('observanda-pdf-bleed-'))throw Error('Unexpected profile');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
