import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {PDFDocument,PDFName,PDFDict} from '@cantoo/pdf-lib';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {applyPdfPressGeometry} from '../../src/pdf-press-geometry.js';
import {navigate} from './preferences-helper.js';
import {bleedPicture} from '../fixtures/pdf-bleed-image.js';
test('decorative bleed image uploads, saves crop and page scope, reloads and exports the pinned asset',async({page,browser})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-bleed-ui-')),f=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),documents=new PdfDocuments(f.workspace,(await f.workspace.outline()).metadata.id),errors=[];let captured;
 const removeRenderer=installPdfRenderer(async(input,{signal})=>{captured={press:input.press,bleedImage:input.bleedImage};const view=await browser.newPage();try{await view.route('**/*',route=>route.abort());await view.emulateMedia({media:'print'});await view.setContent(input.html);const preflight=await view.evaluate(measurePdfPreflight),printed=await view.pdf({preferCSSPageSize:true,printBackground:true,tagged:true,outline:true}),bytes=await applyPdfPressGeometry(printed,input.press,{signal,bleedImage:input.bleedImage});return {bytes,preflight,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};}finally{await view.close();}}),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name:'New document',exact:true}).click();await expect(page).toHaveURL(/#\/modules\/pdf-editor\/[a-f0-9-]{36}$/);const id=new URL(page.url()).hash.split('/').at(-1),saved=()=>expect(ui.locator('[data-pdf-status]')).toHaveText('Saved'),current=()=>documents.read('open',{id});
  await ui.getByRole('textbox',{name:'Content',exact:true}).fill('Original text remains above decorative artwork.');await saved();const panel=ui.locator('[data-pdf-press-fields]');await panel.locator(':scope > summary').click();await panel.locator('[data-pdf-press="enabled"]').check();await saved();await panel.locator('[data-pdf-press="artworkEnabled"]').check();await saved();
  await panel.locator('[data-pdf-press-image]').setInputFiles({name:'synthetic-background.png',mimeType:'image/png',buffer:bleedPicture().content});await expect.poll(async()=>!!(await current()).header.press?.artwork?.image).toBe(true);await saved();
  // The upload redraws only after success; reopen its details explicitly.
  await panel.evaluate(node=>{node.open=true;});await panel.locator('[data-pdf-press="pages"]').selectOption('first');await panel.locator('[data-pdf-press="cropX"]').fill('100');await panel.locator('[data-pdf-press="cropY"]').fill('25');await saved();await expect.poll(async()=>(await current()).header.press.artwork.image.crop).toEqual({x:100,y:25});const retained=await current();expect(retained.header.press.version).toBe(2);
  await page.reload();await expect(panel.locator('[data-pdf-press="pages"]')).toHaveValue('first');await expect(panel.locator('[data-pdf-press="cropX"]')).toHaveValue('100');await expect(panel.locator('[data-pdf-press="cropY"]')).toHaveValue('25');expect((await current()).revision).toBe(retained.revision);
  const event=page.waitForEvent('download');await ui.getByRole('button',{name:'Download PDF',exact:true}).click();const download=await event,bytes=await readFile(await download.path()),pdf=await PDFDocument.load(bytes,{updateMetadata:false});expect(pdf.getPageCount()).toBe(1);expect(pdf.getPage(0).getBleedBox().width).toBeGreaterThan(pdf.getPage(0).getTrimBox().width);const resources=pdf.getPage(0).node.Resources().lookup(PDFName.of('XObject'),PDFDict);expect(resources.keys().some(name=>name.toString().startsWith('/ObservandaBleedArtwork'))).toBe(true);
  expect(captured.press).toEqual(retained.header.press);expect(captured.bleedImage.asset).toBe(retained.header.press.artwork.image.asset);expect(createHash('sha256').update(Buffer.from(captured.bleedImage.data,'base64')).digest('hex')).toBe(captured.bleedImage.asset);await download.saveAs(test.info().outputPath('retained-bleed.pdf'));await documents.read('verify');expect(errors).toEqual([]);
 }finally{await app.close();removeRenderer();clearVault(f.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-bleed-ui-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
