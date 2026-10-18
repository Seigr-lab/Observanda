import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {navigate} from './preferences-helper.js';

test('public PDF review omits unselected content, survives exact export, and invalidates later edits without losing controls or retained downloads',async({page,browser})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-audience-ui-')),fixture=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),errors=[],rendered=[];
 let releaseSave;
 const removeRenderer=installPdfRenderer(async input=>{
  const view=await browser.newPage();try{
   await view.route('**/*',route=>route.abort());await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);
   rendered.push(await view.locator('body').innerText());const preflight=await view.evaluate(measurePdfPreflight),bytes=await view.pdf({preferCSSPageSize:true,printBackground:true});
   return {bytes,preflight,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};
  }finally{await view.close();}
 });
 const app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore}),documents=new PdfDocuments(fixture.workspace,(await fixture.workspace.outline()).metadata.id);
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name:'New document',exact:true}).click();await expect(page).toHaveURL(/#\/modules\/pdf-editor\/[a-f0-9-]{36}$/);const id=new URL(page.url()).hash.split('/').at(-1);
  const publication=ui.locator('[data-pdf-publication]'),saved=ui.locator('[data-pdf-status]'),content=ui.getByRole('textbox',{name:'Content',exact:true});
  await expect(ui.getByRole('combobox',{name:'Edition audience',exact:true})).toHaveValue('private');await expect(publication).toContainText('Included in this edition');await expect(publication.getByText('Public review required',{exact:true})).toHaveCount(0);await expect(publication.getByRole('button',{name:'Mark reviewed for public use',exact:true})).toHaveCount(0);
  await ui.getByLabel('Section title',{exact:true}).fill('Selected result');await content.fill('APPROVED PUBLIC OBSERVATION 9007199254740993.');await expect(saved).toHaveText('Saved');
  await ui.getByRole('button',{name:'Add section',exact:true}).click();await ui.getByLabel('Section title',{exact:true}).fill('Omitted working notes');await content.fill('SYNTHETIC PRIVATE NOTE MUST NOT APPEAR.');await expect(saved).toHaveText('Saved');
  await ui.getByRole('combobox',{name:'Edition audience',exact:true}).selectOption('public');await expect(saved).toHaveText('Saved');await expect(publication).toContainText('Public review required');await publication.getByRole('button',{name:'Omit',exact:true}).click();await expect(publication).toContainText('Omitted from this edition');await expect(ui).toHaveAttribute('aria-busy','false');
  await ui.getByRole('navigation',{name:'Sections',exact:true}).getByRole('button',{name:'Selected result',exact:true}).click();await publication.getByRole('button',{name:'Mark reviewed for public use',exact:true}).click();await expect(publication).toContainText('Reviewed for public use');await expect(saved).toHaveText('Saved');
  await ui.getByRole('button',{name:'Review content selection',exact:true}).click();await expect(ui.locator('[data-pdf-audience-summary]')).toHaveText('1 included, 1 omitted, 0 awaiting public review (2 sections)');const retainedRevision=(await documents.read('open',{id})).revision;
  await ui.getByRole('button',{name:'Preview PDF',exact:true}).click();const frame=ui.getByTitle('PDF preview',{exact:true});await expect(frame).toBeVisible();await expect.poll(()=>rendered.length).toBeGreaterThan(0);const originalPreview=await frame.getAttribute('src');
  const downloadEvent=page.waitForEvent('download',{timeout:45000});await ui.getByRole('button',{name:'Download PDF',exact:true}).click();const firstDownload=await downloadEvent,retainedBytes=await readFile(await firstDownload.path());expect(retainedBytes.subarray(0,5).toString()).toBe('%PDF-');await firstDownload.saveAs(test.info().outputPath('reviewed-public-edition.pdf'));
  const completedRows=ui.locator('[data-pdf-export]').filter({has:page.locator('[data-command="export-download"]:visible')});await expect(completedRows).toHaveCount(1);const retainedJob=await completedRows.first().getAttribute('data-pdf-export');
  expect(rendered.length).toBeGreaterThanOrEqual(2);for(const text of rendered){expect(text).toContain('APPROVED PUBLIC OBSERVATION 9007199254740993.');expect(text).not.toContain('SYNTHETIC PRIVATE NOTE');expect(text).not.toContain('Omitted working notes');}
  const renderCount=rendered.length;let held=false;const gate=new Promise(resolve=>{releaseSave=resolve;});
  await page.route('**/api/pdf/change',async route=>{const response=await route.fetch();held=true;await gate;await route.fulfill({response});},{times:1});
  await content.fill('APPROVED PUBLIC OBSERVATION 9007199254740993. LATER UNREVIEWED CHANGE.');await expect.poll(()=>held).toBe(true);await expect(publication).toContainText('Content or document settings changed. Review again.');
  const omit=publication.getByRole('button',{name:'Omit',exact:true});await omit.evaluate(node=>{window.audienceOmitNode=node;node.focus();});await expect(omit).toBeFocused();releaseSave();await expect(saved).toHaveText('Saved');await expect(omit).toBeFocused();expect(await omit.evaluate(node=>node===window.audienceOmitNode)).toBe(true);
  await expect(ui.locator('[data-pdf-preview-status]')).toContainText('Review or omit each section before preparing a public PDF.');expect(await frame.getAttribute('src')).toBe(originalPreview);expect(rendered.length).toBe(renderCount);expect((await documents.read('open',{id})).revision).not.toBe(retainedRevision);
  await ui.getByRole('button',{name:'Download PDF',exact:true}).click();const failed=ui.locator('[data-pdf-export]').filter({has:page.locator('[data-export-state]',{hasText:'Could not finish'})});await expect(failed).toHaveCount(1);await expect(failed.locator('[data-export-error]')).toContainText('Review or omit each section');await expect(failed.getByRole('button',{name:'Download retained PDF',exact:true})).toBeHidden();expect(rendered.length).toBe(renderCount);
  await page.reload();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue('Selected result');await expect(publication).toContainText('Content or document settings changed. Review again.');await ui.getByRole('button',{name:'PDF exports',exact:true}).click();
  const retainedDownload=page.waitForEvent('download');await ui.locator('[data-pdf-export="'+retainedJob+'"]').getByRole('button',{name:'Download retained PDF',exact:true}).click();expect(await readFile(await (await retainedDownload).path())).toEqual(retainedBytes);expect(rendered.length).toBe(renderCount);expect(errors).toEqual([]);
 }finally{releaseSave?.();await app.close();removeRenderer();clearVault(fixture.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-audience-ui-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
