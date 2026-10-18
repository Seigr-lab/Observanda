import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
const imageDimensions=bytes=>[...bytes.toString('latin1').matchAll(/\d+\s+\d+\s+obj([\s\S]*?)endobj/g)].map(match=>match[1].split('stream')[0]).filter(value=>/\/Subtype\s*\/Image\b/.test(value)).map(value=>({width:Number(/\/Width\s+(\d+)/.exec(value)?.[1]),height:Number(/\/Height\s+(\d+)/.exec(value)?.[1])}));

test('hidden desktop PDF renderer embeds selected lower-resolution pixels while original output remains available',async({page},info)=>{
 const data=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=800;const ctx=canvas.getContext('2d'),gradient=ctx.createLinearGradient(0,0,1600,800);gradient.addColorStop(0,'#155f9b');gradient.addColorStop(1,'#d89b21');ctx.fillStyle=gradient;ctx.fillRect(0,0,1600,800);for(let n=0;n<80;n++){ctx.fillStyle=n%2?'#ffffff':'#172332';ctx.fillRect(n*20,n*10,6,100);}return canvas.toDataURL('image/png').split(',')[1];}),content=Buffer.from(data,'base64'),asset=createHash('sha256').update(content).digest('hex'),parent=path.resolve(os.tmpdir()),profile=await mkdtemp(path.join(parent,'observanda-pdf-resolution-desktop-')),env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;let app;
 try{
  app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});await app.evaluate(({app})=>{globalThis.pdfShown=0;app.on('browser-window-created',(_event,win)=>win.on('show',()=>globalThis.pdfShown++));});
  const header={version:1,id:randomUUID(),name:'Selected pixel resolution',language:'en',direction:'ltr',layout:pdfLayoutPreset()},image={id:randomUUID(),asset,alt:'Synthetic resolution grid',caption:'',widthMm:50.8,heightMm:50.8,fit:'contain',crop:{x:50,y:50},position:{block:0,align:'left'},outputDpi:144},section={id:randomUUID(),title:'',content:'',layout:null,start:null,images:[image]},readImage=async()=>({asset,mime:'image/png',content,width:1600,height:800,size:content.length});
  const render=async()=>{const input=await compilePdfDocument(header,[section],{readImage}),output=await app.evaluate(async({BrowserWindow},input)=>{const {renderPdfDocument}=await globalThis.pdfService,result=await renderPdfDocument(input);return {pdf:result.bytes?.toString('base64'),preflight:result.preflight,shown:globalThis.pdfShown,windows:BrowserWindow.getAllWindows().length};},input);expect(output.preflight.status).not.toBe('fatal');expect(output.shown).toBe(0);expect(output.windows).toBe(0);expect(output.pdf).toBeTruthy();return Buffer.from(output.pdf,'base64');};
  const reduced=await render();expect(imageDimensions(reduced)).toContainEqual({width:288,height:144});await writeFile(info.outputPath('desktop-reduced-image.pdf'),reduced);delete image.outputDpi;const original=await render();expect(imageDimensions(original)).toContainEqual({width:1600,height:800});expect(createHash('sha256').update(content).digest('hex')).toBe(asset);await writeFile(info.outputPath('desktop-original-image.pdf'),original);
 }finally{await app?.close();if(path.dirname(profile)!==parent||!path.basename(profile).startsWith('observanda-pdf-resolution-desktop-'))throw Error('Unexpected profile');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
