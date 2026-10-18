import {test,expect} from '@playwright/test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {MediaStore} from '../../src/media.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {navigate} from './preferences-helper.js';
const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]});

test('PDF author retains one late research table, reviews exact pinned updates and exports independently without surrounding private prose',async({page,browser})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-table-ui-')),book=sampleNotebook();book.title='workspace';
 const original=book.entries[0],tables=Array.from({length:22},(_,i)=>({type:'book_table',attrs:{version:1,id:randomUUID(),title:i===21?'Selected <exact> table':'Unselected table '+i,headers:['Observation','Exact value'],rows:[['Trial <one>',i===21?'9007199254740993':'PRIVATE CELL '+i],['Trial two','0001.2300']]}})),chosen=tables[21],part={id:randomUUID(),title:'Observation with separate tables',body:{type:'doc',content:[paragraph('PRIVATE surrounding research MUST NOT EXPORT'),...tables,paragraph('PRIVATE following discussion MUST NOT EXPORT')]}};original.share=false;original.sections=[part];
 const f=await encryptedFixture(directory,book),workspaceId=(await f.workspace.outline()).metadata.id,documents=new PdfDocuments(f.workspace,workspaceId),records=new ResearchRecords(f.workspace,new MediaStore(f.workspace)),rendered=[],errors=[],commands=[];
 const currentRecord=()=>f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),original.id);return store.record(row.id,row.revision);});
 const editSource=async apply=>{const record=await currentRecord(),expectedRevision=recordRevision(record);apply(record);await records.save({workspaceId,changes:[{id:record.id,expectedRevision,record}]});};
 const removeRenderer=installPdfRenderer(async input=>{const view=await browser.newPage();try{
  await view.route('**/*',route=>route.abort());await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);rendered.push({html:input.html,text:await view.locator('body').innerText()});const preflight=await view.evaluate(measurePdfPreflight),bytes=await view.pdf({preferCSSPageSize:true,printBackground:true});
  return {bytes,preflight,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};
 }finally{await view.close();}});
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().endsWith('/api/pdf/source-retain'))commands.push(request.postDataJSON());});
 try{
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name:'New document',exact:true}).click();await expect(page).toHaveURL(/#\/modules\/pdf-editor\/[a-f0-9-]{36}$/);const id=new URL(page.url()).hash.split('/').at(-1),saved=ui.locator('[data-pdf-status]');
  await ui.getByRole('button',{name:'Add research',exact:true}).click();await ui.getByRole('button',{name:'Content in this workspace or project',exact:true}).click();await ui.getByLabel('Search record titles').fill(original.title);await ui.getByRole('button',{name:'Search',exact:true}).click();await ui.locator('.pdf-source-list').getByRole('button',{name:original.title,exact:true}).click();await ui.getByRole('button',{name:part.title,exact:true}).click();
  const choices=ui.locator('[data-pdf-source-tables]');await expect(choices.locator('[data-command="research-table"]')).toHaveCount(20);await choices.getByRole('button',{name:'More',exact:true}).click();await expect(choices.locator('[data-command="research-table"]')).toHaveCount(2);await choices.getByRole('button',{name:chosen.attrs.title,exact:true}).click();
  await expect(ui.locator('.pdf-source-preview')).toContainText('9007199254740993');await expect(ui.locator('.pdf-source-preview')).not.toContainText('PRIVATE');
  // An intervening research save cannot substitute a later table for the chosen pin.
  await editSource(record=>{record.sections[0].body.content.find(node=>node.type==='book_table'&&node.attrs.id===chosen.attrs.id).attrs.rows[0][1]='9007199254740995';});
  await ui.getByRole('button',{name:'Insert selected content',exact:true}).click();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue(chosen.attrs.title);
  const sectionId=(await documents.read('sections',{id})).items.at(-1).id,edition=(await documents.read('open',{id})).revision,retained=(await documents.read('section',{id,sectionId})).section;
  expect(retained.content).toEqual({type:'doc',content:[chosen]});expect(retained.research.blockId).toBe(chosen.attrs.id);expect(retained.research.figures).toEqual([]);expect(commands[0].source).toMatchObject({blockId:chosen.attrs.id,snapshotId:retained.research.snapshotId,itemId:part.id});expect(JSON.stringify(retained)).not.toContain('PRIVATE');
  const firstDownload=page.waitForEvent('download',{timeout:45000});await ui.getByRole('button',{name:'Download PDF',exact:true}).click();const oldBytes=await readFile(await (await firstDownload).path()),oldJob=await ui.locator('[data-pdf-export]').filter({has:page.locator('[data-command="export-download"]:visible')}).first().getAttribute('data-pdf-export');await ui.getByRole('button',{name:'Close exports',exact:true}).click();expect(rendered[0].text).toContain('9007199254740993');
  await ui.getByLabel('Section title',{exact:true}).fill('Locally chosen heading');await expect(saved).toHaveText('Saved');await ui.getByRole('button',{name:'Review source update',exact:true}).click();await expect(ui.locator('.pdf-source-diff')).toContainText('9007199254740995');await expect(ui.locator('.pdf-source-diff')).not.toContainText('PRIVATE');await ui.getByRole('button',{name:'Keep document unchanged',exact:true}).click();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue('Locally chosen heading');expect((await documents.read('section',{id,sectionId})).section.content).toEqual(retained.content);
  await ui.getByRole('button',{name:'Review source update',exact:true}).click();await ui.getByRole('button',{name:'Accept source update',exact:true}).click();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue(chosen.attrs.title);const updated=(await documents.read('section',{id,sectionId})).section;expect(updated.content.content).toHaveLength(1);expect(updated.content.content[0].attrs.rows[0][1]).toBe('9007199254740995');expect(updated.research.blockId).toBe(chosen.attrs.id);expect(updated.research.snapshotId).not.toBe(retained.research.snapshotId);expect((await documents.read('section',{id,sectionId,revision:edition})).section).toEqual(retained);
  // Removing the current source selection leaves the retained document independently usable.
  await editSource(record=>{record.sections=[];record.body='Source table no longer available in current research';});
  await page.reload();await ui.getByRole('navigation',{name:'Sections',exact:true}).getByRole('button',{name:chosen.attrs.title,exact:true}).click();await expect(ui.getByRole('textbox',{name:'Content',exact:true})).toContainText('9007199254740995');
  const nextDownload=page.waitForEvent('download',{timeout:45000});await ui.getByRole('button',{name:'Download PDF',exact:true}).click();const bytes=await readFile(await (await nextDownload).path());expect(bytes.subarray(0,5).toString()).toBe('%PDF-');expect(rendered).toHaveLength(2);expect(rendered[1].text).toContain('9007199254740995');
  for(const output of rendered)for(const forbidden of ['PRIVATE','Source table no longer available',workspaceId,original.id,retained.research.recordRevision,retained.research.snapshotId])expect(output.html).not.toContain(forbidden);
  const text=await page.evaluate(async data=>{const library=await import('/vendor/pdfjs/pdf.js');library.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.js';const task=library.getDocument({data:Uint8Array.from(data),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWasm:false,useWorkerFetch:false}),pdf=await task.promise,parts=[];try{for(let index=1;index<=pdf.numPages;index++){const page=await pdf.getPage(index);parts.push((await page.getTextContent()).items.map(item=>item.str??'').join(' '));page.cleanup();}return parts.join(' ');}finally{await task.destroy();}},[...bytes]);expect(text).toContain('9007199254740995');expect(text).toContain('0001.2300');expect(text).not.toContain('PRIVATE');
  const oldAgain=page.waitForEvent('download');await ui.locator('[data-pdf-export="'+oldJob+'"]').getByRole('button',{name:'Download retained PDF',exact:true}).click();expect(await readFile(await (await oldAgain).path())).toEqual(oldBytes);expect(rendered).toHaveLength(2);expect((await documents.read('verify')).documents).toBe(1);expect(errors).toEqual([]);
 }finally{await app.close();removeRenderer();clearVault(f.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-table-ui-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
