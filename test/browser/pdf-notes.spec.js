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
import {proseText} from '../../src/web/prose-model.js';
import {navigate} from './preferences-helper.js';

test('authored section notes and endnotes survive navigation, reload and retained PDF export with numbered return links',async({page,browser})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-notes-ui-')),fixture=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),errors=[],rendered=[];
 const removeRenderer=installPdfRenderer(async input=>{
  const view=await browser.newPage();try{
   await view.route('**/*',route=>route.abort());await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);
   rendered.push(await view.evaluate(()=>{
    const refs=[...document.querySelectorAll('[role="doc-noteref"]')],backlinks=[...document.querySelectorAll('[role="doc-backlink"]')],endnotes=document.querySelector('.pdf-endnotes'),sections=[...document.querySelectorAll('.pdf-section')];
    return {numbers:refs.map(ref=>Number(ref.textContent)),linked:[...refs,...backlinks].every(link=>!!document.getElementById(link.hash.slice(1))),sectionNotes:[...document.querySelectorAll('.pdf-section-notes [role="doc-footnote"]')].map(note=>note.textContent),endnotes:[...document.querySelectorAll('.pdf-endnotes [role="doc-endnote"]')].map(note=>note.textContent),endnotesLast:!!endnotes&&sections.every(section=>!!(section.compareDocumentPosition(endnotes)&Node.DOCUMENT_POSITION_FOLLOWING)),sectionNotesAfterProse:[...document.querySelectorAll('.pdf-section-notes')].every(notes=>{const last=[...notes.parentElement.querySelectorAll(':scope > p')].at(-1);return !last||!!(last.compareDocumentPosition(notes)&Node.DOCUMENT_POSITION_FOLLOWING);})};
   }));
   const preflight=await view.evaluate(measurePdfPreflight),bytes=await view.pdf({preferCSSPageSize:true,printBackground:true});return {bytes,preflight,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};
  }finally{await view.close();}
 });
 const app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore}),workspaceId=(await fixture.workspace.outline()).metadata.id,documents=new PdfDocuments(fixture.workspace,workspaceId);page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name:'New document',exact:true}).click();await expect(page).toHaveURL(/#\/modules\/pdf-editor\/[a-f0-9-]{36}$/);const id=new URL(page.url()).hash.split('/').at(-1);
  await ui.getByLabel('Section title',{exact:true}).fill('Methods');const content=ui.getByRole('textbox',{name:'Content',exact:true});await content.fill('First prose block.');await content.press('End');await content.press('Enter');await content.pressSequentially('Last prose block.');await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');const firstId=(await documents.read('sections',{id})).items[0].id;
  const panel=ui.locator('[data-pdf-notes]');await panel.locator(':scope > summary').click();await expect(panel).toContainText('not at the bottom of each page');await panel.getByRole('button',{name:'Add note',exact:true}).click();await expect(page.locator('#notice')).toContainText('Enter note content before adding it.');
  const pending=panel.locator('[data-pdf-note-new-form]');await pending.getByRole('textbox',{name:'Note content',exact:true}).fill('Section observation.');await pending.locator('[data-pdf-note-field="block"]').fill('1');await pending.getByRole('button',{name:'Add note',exact:true}).click();
  const saved=panel.locator('[data-pdf-note]');await expect(saved).toHaveCount(1);await expect(ui).toHaveAttribute('aria-busy','false');await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');await saved.first().getByRole('textbox',{name:'Note content',exact:true}).fill('Revised section observation.');await expect.poll(async()=>proseText((await documents.read('section',{id,sectionId:firstId})).section.notes[0].content)).toBe('Revised section observation.');
  await pending.getByRole('textbox',{name:'Note content',exact:true}).fill('Document follow-up.');await pending.locator('[data-pdf-note-field="kind"]').selectOption('endnote');await pending.locator('[data-pdf-note-field="block"]').fill('12000');await pending.getByRole('button',{name:'Add note',exact:true}).click();await expect(saved).toHaveCount(2);await expect(ui).toHaveAttribute('aria-busy','false');await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');
  await pending.getByRole('textbox',{name:'Note content',exact:true}).fill('Retained on navigation.');await ui.getByRole('button',{name:'Add section',exact:true}).click();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue('');
  const first=(await documents.read('section',{id,sectionId:firstId})).section;expect(first.notes).toHaveLength(3);expect(first.notes.map(note=>proseText(note.content))).toEqual(['Revised section observation.','Document follow-up.','Retained on navigation.']);expect(first.notes[1].block).toBe(12000);const firstNoteIds=first.notes.map(note=>note.id);
  await ui.getByLabel('Section title',{exact:true}).fill('Discussion');await ui.getByRole('textbox',{name:'Content',exact:true}).fill('Second section prose.');await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');const secondId=(await documents.read('sections',{id})).items[1].id;
  await panel.locator(':scope > summary').click();await pending.getByRole('textbox',{name:'Note content',exact:true}).fill('Retained on export.');await pending.locator('[data-pdf-note-field="kind"]').selectOption('endnote');
  const downloadEvent=page.waitForEvent('download',{timeout:45000});await ui.getByRole('button',{name:'Download PDF',exact:true}).click();const download=await downloadEvent;expect((await readFile(await download.path())).subarray(0,5).toString()).toBe('%PDF-');await download.saveAs(test.info().outputPath('authored-notes.pdf'));
  const second=(await documents.read('section',{id,sectionId:secondId})).section;expect(second.notes).toHaveLength(1);expect(proseText(second.notes[0].content)).toBe('Retained on export.');
  expect(rendered.at(-1)).toMatchObject({numbers:[1,2,3,4],linked:true,endnotesLast:true,sectionNotesAfterProse:true});expect(rendered.at(-1).sectionNotes).toHaveLength(2);expect(rendered.at(-1).endnotes).toHaveLength(2);expect(rendered.at(-1).sectionNotes.join(' ')).toContain('Revised section observation.');expect(rendered.at(-1).endnotes.join(' ')).toContain('Retained on export.');
  await page.reload();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue('Methods');await expect(panel.locator('[data-pdf-note]')).toHaveCount(3);expect((await documents.read('section',{id,sectionId:firstId})).section.notes.map(note=>note.id)).toEqual(firstNoteIds);
  await panel.locator('[data-pdf-note]').first().getByRole('button',{name:'Remove note',exact:true}).click();await expect(panel.locator('[data-pdf-note]')).toHaveCount(2);await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');expect((await documents.read('section',{id,sectionId:firstId})).section.notes.map(note=>note.id)).toEqual(firstNoteIds.slice(1));expect(errors).toEqual([]);
 }finally{await app.close();removeRenderer();clearVault(fixture.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-notes-ui-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
