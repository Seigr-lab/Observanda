import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {PDFDocument} from '@cantoo/pdf-lib';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {applyPdfPressGeometry} from '../../src/pdf-press-geometry.js';
import {navigate} from './preferences-helper.js';
const mm=n=>n*72/25.4;
test('press controls preserve selected settings, update physical sizes and export a retained PDF after reload',async({page,browser})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-press-ui-')),f=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),documents=new PdfDocuments(f.workspace,(await f.workspace.outline()).metadata.id),errors=[];
 const removeRenderer=installPdfRenderer(async(input,{signal})=>{const view=await browser.newPage();try{await view.route('**/*',route=>route.abort());await view.emulateMedia({media:'print'});await view.setContent(input.html);const preflight=await view.evaluate(measurePdfPreflight),printed=await view.pdf({preferCSSPageSize:true,printBackground:true,tagged:true,outline:true}),bytes=await applyPdfPressGeometry(printed,input.press,{signal});return {bytes,preflight,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};}finally{await view.close();}}),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name:'New document',exact:true}).click();await expect(page).toHaveURL(/#\/modules\/pdf-editor\/[a-f0-9-]{36}$/);const id=new URL(page.url()).hash.split('/').at(-1),saved=()=>expect(ui.locator('[data-pdf-status]')).toHaveText('Saved'),header=async()=>(await documents.read('open',{id})).header;
  await ui.getByRole('textbox',{name:'Content',exact:true}).fill('A retained press-geometry page.');await saved();const panel=ui.locator('[data-pdf-press-fields]'),enabled=panel.locator('[data-pdf-press="enabled"]'),bleed=panel.locator('[data-pdf-press="bleedMm"]'),marks=panel.locator('[data-pdf-press="cropMarks"]');await panel.locator(':scope > summary').click();await expect(bleed).toBeDisabled();await enabled.check();await saved();expect((await header()).press).toEqual({version:1,bleedMm:3,cropMarks:true});
  await bleed.evaluate(node=>{window.pressInput=node;});await bleed.fill('4.5');await saved();await expect(bleed).toBeFocused();expect(await bleed.evaluate(node=>window.pressInput===node)).toBe(true);await marks.uncheck();await saved();expect((await header()).press).toEqual({version:1,bleedMm:4.5,cropMarks:false});
  const width=ui.locator('[data-pdf-layout="document"][data-key="width"]'),height=ui.locator('[data-pdf-layout="document"][data-key="height"]');await width.evaluate(node=>{node.closest('details').open=true;});await width.fill('148');await height.fill('210');await saved();await expect(panel.locator('[data-pdf-press-size]')).toContainText('148');await expect(panel.locator('[data-pdf-press-size]')).toContainText('157');await expect(panel.locator('[data-pdf-press-size]')).toContainText('219');
  await bleed.fill('21');await expect(bleed).toHaveAttribute('aria-invalid','true');await saved();expect((await header()).press.bleedMm).toBe(4.5);await bleed.fill('4.5');await saved();await page.reload();await expect(bleed).toHaveValue('4.5');await expect(marks).not.toBeChecked();expect((await header()).layout.widthMm).toBe(148);
  await panel.locator(':scope > summary').click();await enabled.uncheck();await saved();expect(Object.hasOwn(await header(),'press')).toBe(false);await expect(bleed).toBeDisabled();await enabled.check();await saved();await expect(bleed).toHaveValue('3');await expect(marks).toBeChecked();await expect(panel.locator('[data-pdf-press-size]')).toContainText('164');await expect(panel.locator('[data-pdf-press-size]')).toContainText('226');
  const downloadEvent=page.waitForEvent('download');await ui.getByRole('button',{name:'Download PDF',exact:true}).click();const download=await downloadEvent,bytes=await readFile(await download.path()),pdf=await PDFDocument.load(bytes,{updateMetadata:false});expect(pdf.getPageCount()).toBe(1);const sheet=pdf.getPage(0);expect(sheet.getTrimBox().width).toBeCloseTo(mm(148),0);expect(sheet.getMediaBox().width-sheet.getTrimBox().width).toBeCloseTo(mm(16),7);await download.saveAs(test.info().outputPath('retained-press.pdf'));await documents.read('verify');expect(errors).toEqual([]);
 }finally{await app.close();removeRenderer();clearVault(f.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-press-ui-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
