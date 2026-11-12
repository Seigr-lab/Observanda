import {test,expect,_electron as electron} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {pdfCompositionProof,renderPdfCompositionProof} from '../../src/pdf-composition-proof.js';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
import {pdfCompositionDefaults} from '../../src/web/pdf-composition-model.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {pdfStructureDefaults} from '../../src/web/pdf-structure-model.js';
import {pdfPageMasterDefaults} from '../../src/web/pdf-page-master-model.js';

test('desktop press proof selects the saved section in a validated archival edition with measured contents and facing margins',async()=>{
 test.setTimeout(180000);
 const parent=path.resolve(os.tmpdir()),profile=await mkdtemp(path.join(parent,'observanda-layout-proof-'));
 const env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;let app;
 try{
  app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});
  const layout=pdfLayoutPreset();layout.pageMaster={...pdfPageMasterDefaults(layout),facingPages:true,gutterMm:6};
  const header={version:1,id:randomUUID(),name:'Facing pages',language:'en',direction:'ltr',layout,outputProfile:'pdfa-2u',press:{version:1,bleedMm:3,cropMarks:true},structure:{...pdfStructureDefaults(),contents:true,pageReferences:true}};
  const section=text=>({id:randomUUID(),title:'Repeated title',content:text,layout:null,start:'page'});
  const first=section('Earlier page only'),selected=section('Selected layout only'),last=section('Later page only');
  selected.composition=pdfCompositionDefaults(selected,layout);
  const proof=pdfCompositionProof(selected.id),{proofArea,...input}=await embedPdfFonts(await compilePdfDocument(header,[first,selected,last],{compositionProof:proof}));
  const receipts=[];
  const render=async payload=>{
   const output=await app.evaluate(async(_,input)=>{
    const result=await(await globalThis.pdfService).renderPdfDocument(input);
    return {encoded:result.bytes?.toString('base64'),preflight:result.preflight,profile:result.validation?.profile};
   },payload);
   receipts.push(output.profile);return {bytes:output.encoded?Buffer.from(output.encoded,'base64'):null,preflight:output.preflight};
  };
  const result=await renderPdfCompositionProof(input,proof,proofArea,{render});
  expect(receipts).toEqual([undefined,'pdfa-2u']);expect(result.preflight.status).not.toBe('fatal');
  expect(result.preflight.findings.filter(item=>item.code==='PDF_FONT_SUBSTITUTED')).toEqual([]);
  const task=getDocument({data:new Uint8Array(result.bytes),isEvalSupported:false,useSystemFonts:false});
  try{
   const doc=await task.promise,page=await doc.getPage(1);expect(doc.numPages).toBe(1);
   const text=(await page.getTextContent()).items.map(item=>item.str).join(' ');
   expect(text).toContain('Selected layout only');expect(text).not.toMatch(/Earlier page only|Later page only/);
   expect(Math.abs(page.getViewport({scale:1}).width*25.4/72-proofArea.widthMm)).toBeLessThan(.5);
   expect(await page.getAnnotations()).toHaveLength(0);
  }finally{await task.destroy();}
  // Use an actual embedded face limited to the letter S. Chromium must
  // substitute the remaining letters in this box alone.
  const face=input.html.match(/@font-face\{[^}]+\}/)[0]
   .replace(/font-family:"[^"]+";/,'font-family:"Subset test";').replace(/\}$/,';unicode-range:U+0053}');
  const rule='#pdf-section-'+selected.id+' [data-pdf-composition-key="block:0"] p{font-family:"Subset test",sans-serif}';
  const patch=input.html.replace('</head>','<style>'+face+rule+'</style></head>');
  const substituted=await render({...input,html:patch,preflightOnly:true});
  expect(substituted.preflight.findings.filter(item=>item.code==='PDF_FONT_SUBSTITUTED')).toEqual([
   {code:'PDF_FONT_SUBSTITUTED',severity:'warning',sectionId:selected.id,blockId:'composition-block:0',blockIndex:0,details:{}}
  ]);
 }finally{
  await app?.close();
  if(path.dirname(profile)!==parent||!path.basename(profile).startsWith('observanda-layout-proof-'))throw Error('Unexpected profile');
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});
