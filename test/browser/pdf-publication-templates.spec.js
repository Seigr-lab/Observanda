import {test,expect} from './document-editor-fixture.js';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {AppError} from '../../src/errors.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {navigate} from './preferences-helper.js';

test('a laboratory author previews a scientific template, publishes a custom edition and reviews its effect on a saved report',async({page,browser})=>{
 test.setTimeout(180000);page.setDefaultTimeout(20000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-template-ui-'));
 const fixture=await encryptedFixture(directory,{...sampleNotebook(),title:'Survey lab'});
 const renderer=installPdfRenderer(async input=>{
  const view=await browser.newPage();
  try{
   await view.route('**/*',route=>route.abort());await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);
   const preflight=await view.evaluate(measurePdfPreflight),bytes=await view.pdf({preferCSSPageSize:true,printBackground:true,tagged:true});
   return {bytes,preflight,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:'source-fixture',chromium:browser.version(),recipeVersion:4}};
  }finally{await view.close();}
 });
 const app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore}),errors=[];
 const originalTemplate=PdfDocuments.prototype.template;
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await navigate(page,'PDF editor');
  const ui=page.locator('[data-pdf-editor]'),panel=ui.locator('[data-pdf-templates]');
  const control=(key)=>ui.locator('[data-command="'+key+'"]'),preview=async(name)=>{await panel.getByRole('listitem').filter({has:panel.page().getByText(name,{exact:true})}).getByRole('button').click();};
  await control('template-list').click();await preview('Scientific report');
  await control('template-copy').click();await panel.locator('[data-template-name]').fill('Instrument report template');
  await panel.locator('[data-template-slot-guide="0"]').fill('Record the instrument checks in this private writing prompt.');
  await panel.getByLabel('Text size (pt)',{exact:true}).fill('13');
  let committed;
  // The authenticated service worker owns API fetches. Lose the confirmation
  // after the native owner has committed to the disposable workspace.
  PdfDocuments.prototype.template=async function(action,...args){
   const result=await originalTemplate.call(this,action,...args);
   if(action==='template-publish'&&!committed){committed=result;throw new AppError('IO');}
   return result;
  };
  await control('template-publish').click();await expect(panel.getByText(/Confirmation is pending/)).toBeVisible();
  await expect.poll(()=>committed?.revision).toMatch(/^[a-f\d]{64}$/);
  await expect(panel.locator('[data-template-name]')).toHaveCount(0);
  await control('template-publish').click();await expect(panel.getByRole('heading',{name:'Instrument report template'})).toBeVisible();
  const packageFile=page.waitForEvent('download');await control('template-export').click();
  const downloaded=await packageFile,portable=JSON.parse(await readFile(await downloaded.path(),'utf8'));
  expect(portable.name).toBe('Instrument report template');expect(portable.layout.fontSizePt).toBe(13);expect(portable.fontFiles[0].sha256).toMatch(/^[a-f\d]{64}$/);
  await panel.locator('[data-template-name]').fill('Spectral response report');
  await control('template-create').click();await expect(ui.getByRole('heading',{name:'Spectral response report'})).toBeVisible();
  const documentUrl=page.url();const editor=ui.getByRole('textbox',{name:'Content',exact:true});
  await expect(ui.getByText('Record the instrument checks in this private writing prompt.',{exact:true})).toBeVisible();
  await editor.fill('Observed response 9007199254740993.001 units.');
  await ui.getByLabel('Section title',{exact:true}).fill('Instrument summary');
  await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');
  await page.reload();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue('Instrument summary');
  await expect(editor).toContainText('9007199254740993.001');
  const down=page.waitForEvent('download');await control('download').click();
  const pdf=await down,task=getDocument({data:Uint8Array.from(await readFile(await pdf.path())),isEvalSupported:false,useSystemFonts:false});
  try{
   const output=await task.promise,pages=[];
   for(let i=1;i<=output.numPages;i++)pages.push((await(await output.getPage(i)).getTextContent()).items.map(row=>row.str).join(' '));
   const text=pages.join('\n');expect(text).toContain('9007199254740993.001');expect(text).toContain('Instrument summary');expect(text).not.toContain('private writing prompt');
  }finally{await task.destroy();}
  await control('list').click();await control('template-list').click();await preview('Instrument report template');await control('template-edit').click();
  await panel.locator('[data-template-slot-title="0"]').fill('New template title');
  await panel.locator('[data-template-slot-guide="0"]').fill('Include the calibration date.');
  await panel.locator('[data-template-slot-title="1"]').fill('Survey question');
  await control('template-publish').click();await expect(panel.getByRole('heading',{name:'Instrument report template'})).toBeVisible();
  await page.goto(documentUrl);await expect(ui.getByText('Record the instrument checks in this private writing prompt.',{exact:true})).toBeVisible();
  await control('template-check').click();await panel.getByText('Changes in this template edition').click();await expect(panel.getByText('Research question → Survey question',{exact:false})).toBeVisible();
  const previouslyOmitted=portable.sections.find(slot=>slot.optional);
  await panel.locator('[data-template-slot="'+previouslyOmitted.id+'"]').check();
  await panel.locator('[data-template-titles]').check();await control('template-update').click();
  await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue('Instrument summary');
  await expect(ui.getByText('Include the calibration date.',{exact:true})).toBeVisible();
  await expect(ui.getByRole('button',{name:'Survey question',exact:true})).toBeVisible();
  await expect(ui.getByRole('button',{name:previouslyOmitted.title,exact:true})).toBeVisible();
  await control('list').click();await control('template-list').click();
  const unsupported={...portable,floatingMedia:{caption:'Unpublished source'}};
  await panel.locator('[data-template-file]').setInputFiles({name:'unknown.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(unsupported))});
  await control('template-import').click();await expect(panel.getByRole('alert')).toContainText('floatingMedia');await expect(panel).not.toContainText('Unpublished source');
  await expect(control('template-import-draft')).toHaveCount(0);
  await panel.locator('[data-template-file]').setInputFiles({name:'report-template.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(portable))});
  await control('template-import').click();await expect(control('template-import-draft')).toBeVisible();
  expect(errors).toEqual([]);
 }finally{
  PdfDocuments.prototype.template=originalTemplate;
  await page.close();await app.close();renderer();await clearVault(fixture.vault);
  if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-template-ui-'))throw Error('Unexpected test directory');
  await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});
