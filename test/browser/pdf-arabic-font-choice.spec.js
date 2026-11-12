import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {pdfArchivalAvailable} from '../../src/pdf-archival.js';
import {AppError} from '../../src/errors.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {navigate} from './preferences-helper.js';

test('the author can resolve an Arabic font validation error and download exact Arabic under both checked output profiles',async({page})=>{
 test.skip(!await pdfArchivalAvailable(),'The pinned offline validator is required.');test.setTimeout(180000);page.setDefaultTimeout(25000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-arabic-choice-')),fixture=await encryptedFixture(directory,sampleNotebook());
 const env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:path.join(directory,'renderer')};delete env.ELECTRON_RUN_AS_NODE;
 const desktop=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env}),receipts=[];
 const renderer=installPdfRenderer(async input=>{
  const result=await desktop.evaluate(async(_,input)=>{
   try{const r=await(await globalThis.pdfService).renderPdfDocument(input);return {...r,bytes:r.bytes?.toString('base64')??null};}
   catch(error){return {error:error.code};}
  },input);
  if(result.error)throw new AppError(result.error);
  if(result.validation)receipts.push(result.validation);
  return {...result,bytes:result.bytes&&Buffer.from(result.bytes,'base64')};
 },{capabilities:async()=>({archival:true})});
 const documents=new PdfDocuments(fixture.workspace,(await fixture.workspace.outline()).metadata.id);
 const app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore}),sample='القياس';
 try{
  const assetFailures=[];
  page.on('response',response=>{if(response.status()>=400&&['script','stylesheet'].includes(response.request().resourceType()))assetFailures.push(new URL(response.url()).pathname+' '+response.status());});
  page.on('pageerror',error=>assetFailures.push(error.message));
  const id=randomUUID(),name='Field calibration',section={id:randomUUID(),title:'Instrument reading',layout:null,start:null,content:sample};
  await documents.change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header:{id,version:1,name,language:'ar',direction:'rtl',layout:{...pdfLayoutPreset(),font:'aref-ruqaa'},outputProfile:'pdfua-1'},section}});
  await page.goto(app.url);await navigate(page,'PDF editor');
  const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name,exact:true}).click();
  const download=ui.getByRole('button',{name:'Download PDF',exact:true});
  await download.click();await expect(ui.getByText(/For Arabic, select Scheherazade New/).first()).toBeVisible({timeout:60000});
  const settings=ui.locator('details[data-disclosure="pdf-production"]');await settings.locator(':scope > summary').click();
  const font=settings.locator('select[data-pdf-layout="document"][data-key="font"]');
  const element=font.locator('xpath=ancestor::details[1]');await element.locator(':scope > summary').click();
  await font.selectOption('scheherazade-new');await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');
  for(const profile of ['pdfua-1','pdfa-2u']){
   if(profile==='pdfa-2u'){await settings.locator('select[data-pdf-output-profile]').selectOption(profile);await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');}
   const event=page.waitForEvent('download',{timeout:60000});await download.click();const file=await event;
   const reader=getDocument({data:Uint8Array.from(await readFile(await file.path())),isEvalSupported:false,useSystemFonts:false});
   try{const out=await reader.promise,items=(await(await out.getPage(1)).getTextContent()).items;expect(items.some(x=>x.dir==='rtl'&&x.str===sample)).toBe(true);}
   finally{await reader.destroy();}
   expect(receipts.some(r=>r.profile===profile)).toBe(true);
  }
  await page.reload();await expect.poll(async()=>await ui.getByRole('heading',{name}).count()?'ready':assetFailures.join(', ')||'loading',{timeout:45000}).toBe('ready');expect((await documents.read('open',{id})).header.layout.font).toBe('scheherazade-new');
 }finally{
  await app.close();renderer();await desktop.close();await clearVault(fixture.vault);
  if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-arabic-choice-'))throw Error('Unexpected test directory');
  await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100});
 }
});
