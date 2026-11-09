import {test,expect} from './document-editor-fixture.js';
import {createHash,randomUUID} from 'node:crypto';
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
import {pdfFootnoteFlowScript} from '../../src/pdf-footnote-flow.js';
import {pdfNoteCall,pdfNoteLocations} from '../../src/web/pdf-notes-model.js';
import {proseText} from '../../src/web/prose-model.js';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {navigate} from './preferences-helper.js';

test('authored section notes and endnotes survive navigation, reload and retained PDF export with numbered return links',async({page,browser})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-notes-ui-')),fixture=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),errors=[],rendered=[];
 const removeRenderer=installPdfRenderer(async input=>{
  const view=await browser.newPage();try{
   await view.route('**/*',route=>route.abort());await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);if(input.footnoteFlow)await view.evaluate(pdfFootnoteFlowScript(input.footnoteFlow));
   rendered.push(await view.evaluate(()=>{
    const refs=[...document.querySelectorAll('[role="doc-noteref"]')],backlinks=[...document.querySelectorAll('[role="doc-backlink"]')],endnotes=document.querySelector('.pdf-endnotes'),sections=[...document.querySelectorAll('.pdf-section')];
    const anchors=[...document.querySelectorAll('[data-pdf-footnote-call]')].map(call=>({block:Number(call.dataset.pdfFootnoteBlock),paragraph:call.closest('p')?.textContent}));
    return {anchors,pageNotes:[...document.querySelectorAll('.pdf-page-footnotes [role="doc-footnote"]')].map(note=>note.textContent),numbers:refs.map(ref=>Number(ref.textContent)),linked:[...refs,...backlinks].every(link=>!!document.getElementById(link.hash.slice(1))),sectionNotes:[...document.querySelectorAll('.pdf-section-notes [role="doc-footnote"]')].map(note=>note.textContent),endnotes:[...document.querySelectorAll('.pdf-endnotes [role="doc-endnote"]')].map(note=>note.textContent),endnotesLast:!!endnotes&&sections.every(section=>!!(section.compareDocumentPosition(endnotes)&Node.DOCUMENT_POSITION_FOLLOWING)),sectionNotesAfterProse:[...document.querySelectorAll('.pdf-section-notes')].every(notes=>{const last=[...notes.parentElement.querySelectorAll(':scope > p')].at(-1);return !last||!!(last.compareDocumentPosition(notes)&Node.DOCUMENT_POSITION_FOLLOWING);})};
   }));
   const preflight=await view.evaluate(measurePdfPreflight),bytes=await view.pdf({preferCSSPageSize:true,printBackground:true});return {bytes,preflight,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};
  }finally{await view.close();}
 });
 const app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore}),workspaceId=(await fixture.workspace.outline()).metadata.id,documents=new PdfDocuments(fixture.workspace,workspaceId);page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name:'New document',exact:true}).click();await expect(page).toHaveURL(/#\/modules\/pdf-editor\/[a-f0-9-]{36}$/);const id=new URL(page.url()).hash.split('/').at(-1);
  await ui.getByLabel('Section title',{exact:true}).fill('Methods');const content=ui.getByRole('textbox',{name:'Content',exact:true});await content.fill('First prose block.');await content.press('End');await content.press('Enter');await content.pressSequentially('Last prose block.');await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');const firstId=(await documents.read('sections',{id})).items[0].id;
  const options=ui.locator('[data-disclosure="pdf-section-options"]');
  const openOptions=async()=>{if(!await options.evaluate(el=>el.open))await options.locator(':scope > summary').click();};
  await openOptions();const panel=ui.locator('[data-pdf-notes]');await panel.locator(':scope > summary').click();await expect(panel).toContainText('Page footnotes');await panel.getByRole('button',{name:'Add note',exact:true}).click();await expect(page.locator('#notice')).toContainText('Enter note content before adding it.');
  const pending=panel.locator('[data-pdf-note-new-form]');await content.press('Control+Home');await content.press('Control+ArrowRight');await pending.getByRole('textbox',{name:'Note content',exact:true}).fill('Section observation.');await pending.getByRole('button',{name:'Add note',exact:true}).click();
  const saved=panel.locator('[data-pdf-note]');await expect(saved).toHaveCount(1);await expect(ui).toHaveAttribute('aria-busy','false');await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');await saved.first().getByRole('textbox',{name:'Note content',exact:true}).fill('Revised section observation.');await expect.poll(async()=>proseText((await documents.read('section',{id,sectionId:firstId})).section.notes[0].content)).toBe('Revised section observation.');
  await saved.first().getByRole('button',{name:'Go to marker'}).press('Enter');await expect(content).toBeFocused();
  await ui.locator('[data-command="reference-go"]').press('Enter');await expect(saved.first().getByRole('textbox',{name:'Note content'})).toBeFocused();
  await content.press('Control+End');await pending.getByRole('textbox',{name:'Note content',exact:true}).fill('Document follow-up.');await pending.locator('[data-pdf-note-field="kind"]').selectOption('endnote');await pending.getByRole('button',{name:'Add note',exact:true}).click();await expect(saved).toHaveCount(2);await expect(ui).toHaveAttribute('aria-busy','false');await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');
  await pending.getByRole('textbox',{name:'Note content',exact:true}).fill('Explanation at the page bottom.');await pending.locator('[data-pdf-note-field="kind"]').selectOption('page-footnote');await pending.getByRole('button',{name:'Add note',exact:true}).click();await expect(saved).toHaveCount(3);await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');
  await pending.getByRole('textbox',{name:'Note content',exact:true}).fill('Retained on navigation.');await ui.getByRole('button',{name:'Add section',exact:true}).click();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue('');
  const first=(await documents.read('section',{id,sectionId:firstId})).section;expect(first.notes).toHaveLength(4);expect(first.notes[2].kind).toBe('page-footnote');expect(first.notes.map(note=>proseText(note.content))).toEqual(['Revised section observation.','Document follow-up.','Explanation at the page bottom.','Retained on navigation.']);expect(first.notes.every(note=>note.anchor==='inline')).toBe(true);expect(pdfNoteLocations(first.content).get(first.notes[0].id).block).toBe(0);
  expect(first.content.content[0].content.map(node=>node.marks?.some(mark=>mark.attrs?.href===pdfNoteCall(first.notes[0].id))?'[note]':node.text).join('')).toMatch(/First ?\[note\] ?prose block\./);const firstNoteIds=first.notes.map(note=>note.id);
  await ui.getByLabel('Section title',{exact:true}).fill('Discussion');await ui.getByRole('textbox',{name:'Content',exact:true}).fill('Second section prose.');await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');const secondId=(await documents.read('sections',{id})).items[1].id;
  await openOptions();await panel.locator(':scope > summary').click();await pending.getByRole('textbox',{name:'Note content',exact:true}).fill('Retained on export.');await pending.locator('[data-pdf-note-field="kind"]').selectOption('endnote');
  const downloadEvent=page.waitForEvent('download',{timeout:45000});await ui.getByRole('button',{name:'Download PDF',exact:true}).click();const download=await downloadEvent;expect((await readFile(await download.path())).subarray(0,5).toString()).toBe('%PDF-');await download.saveAs(test.info().outputPath('authored-notes.pdf'));
  const second=(await documents.read('section',{id,sectionId:secondId})).section;expect(second.notes).toHaveLength(1);expect(proseText(second.notes[0].content)).toBe('Retained on export.');
  expect(rendered.at(-1)).toMatchObject({numbers:[1,2,3,4,5],linked:true,endnotesLast:true,sectionNotesAfterProse:true});expect(rendered.at(-1).pageNotes).toHaveLength(1);expect(rendered.at(-1).pageNotes[0]).toContain('Explanation at the page bottom.');expect(rendered.at(-1).sectionNotes).toHaveLength(2);expect(rendered.at(-1).endnotes).toHaveLength(2);expect(rendered.at(-1).sectionNotes.join(' ')).toContain('Revised section observation.');expect(rendered.at(-1).endnotes.join(' ')).toContain('Retained on export.');
  await page.reload();await expect(ui.getByLabel('Section title',{exact:true})).toBeVisible({timeout:45000});await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue('Methods');await expect(panel.locator('[data-pdf-note]')).toHaveCount(4);await expect(panel.locator('[data-pdf-note]').nth(2).locator('[data-pdf-note-field="kind"]')).toHaveValue('page-footnote');expect((await documents.read('section',{id,sectionId:firstId})).section.notes.map(note=>note.id)).toEqual(firstNoteIds);
  await openOptions();await panel.locator('[data-pdf-note]').first().getByRole('button',{name:'Remove note',exact:true}).click();await expect(panel.locator('[data-pdf-note]')).toHaveCount(3);await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');expect((await documents.read('section',{id,sectionId:firstId})).section.notes.map(note=>note.id)).toEqual(firstNoteIds.slice(1));expect(errors).toEqual([]);
  // Reopen a retained edition authored with block-positioned notes.
  const retainedId=randomUUID(),retainedNote=randomUUID(),head=await documents.read('open',{id});
  const retained={id:retainedId,title:'Retained placements',layout:null,start:null,content:{type:'doc',content:['First retained block.','Last retained block.'].map(text=>({type:'paragraph',content:[{type:'text',text}]}))},notes:[{id:retainedNote,kind:'page-footnote',block:1,content:'Retained page note.'}]};
  await documents.change({id,commandId:randomUUID(),expectedRevision:head.revision,operation:{type:'append',section:retained}});
  await page.reload();await expect(ui.getByLabel('Section title',{exact:true})).toBeVisible({timeout:45000});await ui.getByRole('navigation',{name:'Sections',exact:true}).getByRole('button',{name:'Retained placements'}).click();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue('Retained placements');
  const review=ui.locator('[data-pdf-placement-review]');
  await content.fill('Last retained block.');
  await content.press('End');await content.press('Enter');await content.pressSequentially('First retained block.');
  await expect(review).toBeVisible();
  await expect(review).toContainText('Retained page note.');
  await expect(review).toContainText('First retained block.');
  await expect.poll(async()=>(await documents.read('section',{id,sectionId:retainedId})).section.placementReview).toBe(true);
  await page.reload();await expect(ui.getByLabel('Section title',{exact:true})).toBeVisible({timeout:45000});await ui.getByRole('navigation',{name:'Sections',exact:true}).getByRole('button',{name:'Retained placements'}).click();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue('Retained placements');await expect(review).toBeVisible();
  await ui.locator('[data-command="preview"]').click();
  await expect(ui.locator('[data-pdf-preview-status]')).toContainText('Review the placements');
  await ui.locator('[data-command="preflight"]').click();
  const finding=ui.locator('[data-pdf-preflight]');await expect(finding).toContainText('Review the placements');
  await finding.locator('[data-command="finding"]').click();
  await expect(review.getByRole('button',{name:'Adjust placements'})).toBeFocused();
  await review.getByRole('button',{name:'Adjust placements'}).click();
  await expect(ui.locator('[data-disclosure="pdf-section-options"] > summary')).toBeFocused();
  const footnotePosition=panel.locator('[data-pdf-note="'+retainedNote+'"] [data-pdf-note-field="block"]');
  await expect(footnotePosition).toHaveValue('1');
  await footnotePosition.fill('2');
  await expect.poll(async()=>(await documents.read('section',{id,sectionId:retainedId})).section.notes.find(note=>note.id===retainedNote).block).toBe(2);
  await review.getByRole('button',{name:'Confirm these positions'}).press('Enter');
  await expect(review).toBeHidden();
  await ui.locator('[data-command="edit-undo"]').click();await expect(review).toBeVisible();
  await ui.locator('[data-command="edit-redo"]').click();await expect(review).toBeHidden();
  const output=page.waitForEvent('download');
  await ui.getByRole('button',{name:'Download PDF',exact:true}).click();
  const file=await output,bytes=await readFile(await file.path());
  expect(rendered.at(-1).anchors).toContainEqual({block:2,paragraph:expect.stringContaining('First retained block.')});
  const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWasm:false,useWorkerFetch:false});
  try{
   const pdf=await task.promise,parts=[];
   for(let n=1;n<=pdf.numPages;n++) {
    const sheet=await pdf.getPage(n),data=await sheet.getTextContent();parts.push(...data.items.map(item=>item.str??''));sheet.cleanup();
   }
   const text=parts.join(' ');expect(text).toContain('Retained page note.');
   expect(text).toContain('Last retained block.');expect(text).toContain('First retained block.');
   expect(text.indexOf('Last retained block.')).toBeLessThan(text.indexOf('First retained block.'));
  }finally{await task.destroy();}
 }finally{await app.close();removeRenderer();await clearVault(fixture.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-notes-ui-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
