import {test,expect} from '@playwright/test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {PdfDocumentStore} from '../../src/pdf-document-store.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {navigate} from './preferences-helper.js';

test('collects editions across result pages, reviews a tagged batch and reads both finished PDFs',async({page,browser})=>{
 test.setTimeout(180000);page.setDefaultTimeout(20000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-batch-'));
 const f=await encryptedFixture(directory,{...sampleNotebook(),title:'Survey documentation'}),workspaceId=(await f.workspace.outline()).metadata.id;
 const domain=new PdfDocuments(f.workspace,workspaceId),observations=[],errors=[];
 const release=installPdfRenderer(async input=>{
  const view=await browser.newPage();
  try{
   await view.route('**/*',route=>route.abort());await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);
   const preflight=await view.evaluate(measurePdfPreflight),bytes=await view.pdf({preferCSSPageSize:true,printBackground:true});
   return {bytes,preflight,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:'source-test',chromium:browser.version(),recipeVersion:1}};
  }finally{await view.close();}
 });
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await domain.domains.initialize(['pdf']);await domain.domains.run(['pdf'],async get=>{
   const docs=new PdfDocumentStore(get('pdf'));await docs.prepareLibrary();
   for(let i=0;i<22;i++){
    const id=randomUUID(),name='Station '+String(i).padStart(2,'0'),header={version:1,id,name,language:'en',direction:'ltr',layout:pdfLayoutPreset()};
    const section={id:randomUUID(),title:'Measurement',content:'Observation from '+name,layout:null,start:null};
    const {revision}=await docs.change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header,section}});
    observations.push({id,name,revision});
   }
  },{write:['pdf']});
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');
  const b=name=>ui.getByRole('button',{name,exact:true}),batch=ui.getByRole('combobox',{name:'Action for selected documents'});
  const select=async item=>ui.getByRole('checkbox',{name:'Select '+item.name+' ('+item.id.slice(0,8)+')',exact:true}).check();
  await select(observations[0]);await ui.locator('[data-command="library-next"]').click();await select(observations[21]);await expect(ui).toContainText('2 selected');
  await b('Collections and tags').click();await b('Tags').click();
  await ui.getByRole('textbox',{name:'Tag name',exact:true}).fill('Field review');await b('Create').click();await expect(b('Field review')).toBeVisible();
  await batch.selectOption('assign');await b('Review selection').click();await expect(ui.getByRole('table')).toContainText('Station 21');await b('Apply reviewed changes').click();
  await expect(ui).toContainText('Updated 2 documents.');await b('Show documents in group').click();await expect(ui.locator('[data-library-item]')).toHaveCount(2);
  await page.reload();await b('Collections and tags').click();await b('Tags').click();await b('Field review').click();await b('Show documents in group').click();
  await expect(ui.locator('[data-library-item]')).toHaveCount(2);await b('Select this page').click();await batch.selectOption('export');
  await b('Review selection').click();const table=ui.getByRole('table');await expect(table).toContainText('Standard PDF');await expect(table).toContainText('Edition 1');
  await b('Queue reviewed exports').click();await expect(ui).toContainText('2 exports queued.');
  await ui.locator('[data-command="exports-open"]').click();
  for(const item of [observations[0],observations[21]]){
   const exportRow=ui.locator('[data-pdf-export]').filter({has:page.getByText(item.name,{exact:true})});
   await expect(exportRow.locator('[data-export-state]')).toHaveText('Ready to download',{timeout:60000});
   await expect(exportRow).toContainText(item.revision.slice(0,12));
   const download=page.waitForEvent('download');await exportRow.locator('[data-command="export-download"]').click();
   const file=await download,bytes=await readFile(await file.path()),task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true});
   try{const pdf=await task.promise,text=(await (await pdf.getPage(1)).getTextContent()).items.map(row=>row.str).join(' ');expect(text).toContain('Observation from '+item.name);}finally{await task.destroy();}
  }
  expect(errors).toEqual([]);
 }finally{
  await app.close();release();await clearVault(f.vault);
  if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-batch-'))throw Error('Unexpected test directory');
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
