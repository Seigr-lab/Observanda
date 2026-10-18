import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {navigate} from './preferences-helper.js';

// The real compiler and measured browser layout supply findings. Only the
// desktop renderer transport is supplied by this headless browser fixture.
test('PDF layout findings navigate beyond the first section window and focus the exact saved table without changing it',async({page,browser})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-findings-ui-')),fixture=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),errors=[],measurements=[],requests=[];
 const removeRenderer=installPdfRenderer(async input=>{
  const view=await browser.newPage();try{
   await view.route('**/*',route=>route.abort());await view.emulateMedia({media:'print'});await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);
   const preflight=await view.evaluate(measurePdfPreflight);measurements.push(preflight);
   return {bytes:null,sha256:null,preflight,renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};
  }finally{await view.close();}
 });
 const app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore}),documents=new PdfDocuments(fixture.workspace,(await fixture.workspace.outline()).metadata.id);
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/\/api\/pdf\/(?:change|section|sections)$/.test(new URL(request.url()).pathname))requests.push({operation:new URL(request.url()).pathname.split('/').at(-1),body:request.postDataJSON()});});
 try{
  const id=randomUUID(),tableId=randomUUID(),sections=Array.from({length:22},(_,index)=>({id:randomUUID(),title:'Section '+String(index+1).padStart(2,'0'),content:'Exact retained observation '+(index+1)+'.',layout:null,start:null}));
  sections[21].content={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'The following table is the exact finding target.'}]},{type:'book_table',attrs:{version:1,id:tableId,title:'Late retained table',headers:['Observation'],rows:[['Unbroken measured cell. '.repeat(280)]]}}]};
  const change=(expectedRevision,operation)=>documents.change({id,commandId:randomUUID(),expectedRevision,operation});let saved=await change(null,{type:'create',header:{version:1,id,name:'Finding navigation workbook',language:'en',direction:'ltr',layout:{...pdfLayoutPreset(),widthMm:120,heightMm:140,margins:{top:10,right:10,bottom:10,left:10},fontSizePt:10}},section:sections[0]});for(const section of sections.slice(1))saved=await change(saved.revision,{type:'append',section});
  const revision=saved.revision,original=(await documents.read('section',{id,sectionId:sections[21].id,revision})).section;
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name:'Finding navigation workbook',exact:true}).click();const navigation=ui.getByRole('navigation',{name:'Sections',exact:true});await expect(navigation.getByRole('button')).toHaveCount(20);await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue('Section 01');await expect(navigation.getByRole('button',{name:'Section 22',exact:true})).toHaveCount(0);
  await ui.getByRole('button',{name:'Check PDF layout',exact:true}).click();const findings=ui.locator('[data-pdf-preflight]');await expect(findings).toContainText('Review these findings');expect(measurements).toHaveLength(1);const findingIndex=measurements[0].findings.findIndex(row=>row.code==='PDF_BLOCK_TOO_TALL'&&row.sectionId===sections[21].id&&row.blockId?.includes(tableId));expect(findingIndex).toBeGreaterThanOrEqual(0);expect(measurements[0].findings[findingIndex].blockIndex).toBe(1);expect(measurements[0].findings[findingIndex].details.heightPx).toBeGreaterThan(measurements[0].findings[findingIndex].details.availableHeightPx);
  await findings.locator('[data-command="finding"][data-finding="'+findingIndex+'"]').click();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue('Section 22');await expect(navigation.getByRole('button')).toHaveCount(2);await expect(navigation.getByRole('button',{name:'Section 22',exact:true})).toHaveAttribute('aria-current','true');await expect(navigation.getByRole('button',{name:'Section 01',exact:true})).toHaveCount(0);
  const content=ui.locator('[data-document-key="'+sections[21].id+'"] [contenteditable="true"]'),target=content.locator(':scope > [data-pdf-finding-target]');await expect(target).toHaveCount(1);await expect(target).toContainText('Late retained table');const edit=target.locator('[data-book-edit]');await expect(edit).toBeFocused();await edit.press('Enter');const dialog=page.getByRole('dialog',{name:'Book content',exact:true});await expect(dialog.getByLabel('Title / caption',{exact:true})).toHaveValue('Late retained table');await expect(dialog.getByLabel('Row 1, 1',{exact:true})).toHaveValue(original.content.content[1].attrs.rows[0][0]);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
  expect(requests.some(row=>row.operation==='section'&&row.body.sectionId===sections[21].id&&row.body.locate===true&&row.body.revision===revision)).toBe(true);expect(requests.some(row=>row.operation==='sections'&&row.body.offset===20&&row.body.limit===20&&row.body.revision===revision)).toBe(true);expect(requests.filter(row=>row.operation==='change')).toEqual([]);expect((await documents.read('open',{id})).revision).toBe(revision);expect((await documents.read('section',{id,sectionId:sections[21].id,revision})).section).toEqual(original);expect(errors).toEqual([]);
 }finally{await app.close();removeRenderer();clearVault(fixture.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-findings-ui-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
