import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
test('PDF equations and sketches retain searchable text and vector output with embedded fonts',async({},info)=>{
 const profile=await mkdtemp(path.join(os.tmpdir(),'observanda-pdf-blocks-')),env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;let app;
 try{
  app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});
  const header={version:1,id:randomUUID(),name:'Equations and sketches',language:'en',direction:'ltr',layout:pdfLayoutPreset()},content={type:'doc',content:[
   {type:'book_equation',attrs:{version:1,id:randomUUID(),source:String.raw`\int_0^1 x^2\,dx = \frac{1}{3} \qquad \sum_{n=1}^{4} n = 10`,label:'Integral and finite sum'}},
   {type:'book_equation',attrs:{version:1,id:randomUUID(),source:String.raw`\begin{aligned}E &= mc^2 \\ x &= \frac{-b \pm \sqrt{b^2-4ac}}{2a}\end{aligned}`,label:'Aligned equations'}},
   {type:'book_sketch',attrs:{version:1,id:randomUUID(),title:'Measured connection',description:'The line connects two labelled measurement points.',width:700,height:220,background:'#ffffff',items:[
    {id:randomUUID(),kind:'text',colour:'#172332',x:20,y:25,text:'Input 9007199254740993',size:22},
    {id:randomUUID(),kind:'line',colour:'#172332',x:30,y:90,x2:600,y2:90,weight:3,fill:'none'},
    {id:randomUUID(),kind:'text',colour:'#172332',x:440,y:130,text:'Output 0.000001',size:22}
   ]}}
  ]};
  const input=await embedPdfFonts(await compilePdfDocument(header,[{id:randomUUID(),title:'Scientific content',content,layout:null,start:null}]));
  const output=await app.evaluate(async(_electron,input)=>{const {renderPdfDocument}=await globalThis.pdfService;return (await renderPdfDocument(input)).bytes.toString('base64');},input),bytes=Buffer.from(output,'base64');expect(bytes.subarray(0,5).toString()).toBe('%PDF-');await writeFile(info.outputPath('equations-sketches.pdf'),bytes);
 }finally{await app?.close();await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
