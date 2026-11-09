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
import {createFigure} from '../../src/web/figure-model.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {pdfStructureDefaults,pdfCaptionDefaults} from '../../src/web/pdf-structure-model.js';
import {parsePdfCrossReference} from '../../src/web/pdf-cross-reference-model.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {navigate} from './preferences-helper.js';
const table=title=>({type:'doc',content:[{type:'book_table',attrs:{version:1,id:randomUUID(),title,headers:['Observation'],rows:[['3']]}}]});

test('authored PDF references persist, renumber after movement, print without links and report a removed target',async({page,browser})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-references-ui-')),fixture=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),errors=[],rendered=[];
 const removeRenderer=installPdfRenderer(async input=>{
  const view=await browser.newPage();try{
   await view.route('**/*',route=>route.abort());await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);
   rendered.push({text:await view.locator('body').innerText(),references:await view.locator('a.pdf-cross-reference').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent,href:node.getAttribute('href')})))});
   const preflight=await view.evaluate(measurePdfPreflight),bytes=await view.pdf({preferCSSPageSize:true,printBackground:true});
   return {bytes,preflight,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};
  }finally{await view.close();}
 });
 const app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore}),documents=new PdfDocuments(fixture.workspace,(await fixture.workspace.outline()).metadata.id);page.on('pageerror',error=>errors.push(error.message));
 try{
  const id=randomUUID(),intro={id:randomUUID(),title:'Discussion',content:'Authored discussion.',layout:null,start:null},first={id:randomUUID(),title:'First measurements',content:table('First readings'),layout:null,start:null},target={id:randomUUID(),title:'Target section',content:table('Target readings'),layout:null,start:null};
  for(const item of [first,target]){
   const figure=createFigure();figure.title=item.title+' trace';figure.series[0].points=[{x:1,y:2,error:null},{x:2,y:3,error:null}];item.figures=[figure];
   item.content.content.push({type:'book_figure',attrs:{version:1,id:randomUUID(),figureId:figure.id,alternative:figure.title}});
  }
  const header={version:1,id,name:'Cross-reference report',language:'en',direction:'ltr',layout:pdfLayoutPreset(),structure:{...pdfStructureDefaults(),numberSections:true,caption:{...pdfCaptionDefaults(),numberTables:true,numberFigures:true}}},change=(revision,operation)=>documents.change({id,commandId:randomUUID(),expectedRevision:revision,operation});
  let saved=await change(null,{type:'create',header,section:intro});for(const section of [first,target])saved=await change(saved.revision,{type:'append',section});
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name:'Cross-reference report',exact:true}).click();
  const picker=ui.locator('[data-pdf-cross-references]'),content=ui.getByRole('textbox',{name:'Content',exact:true});
  async function chooseTarget(){
   await ui.locator('[data-command="choose-reference"]').press('Enter');await expect(picker.locator('[data-pdf-cross-reference-query]')).toBeFocused();
   await picker.locator('[data-pdf-cross-reference-query]').fill('Target section');await picker.locator('[data-command="cross-reference-search"]').click();await picker.getByRole('button',{name:'Target section',exact:true}).click();
  }
  await expect(ui).toHaveAttribute('aria-busy','false');await content.press('Home');await content.press('Control+ArrowRight');
  await expect.poll(()=>content.evaluate(el=>{const s=window.getSelection();return el.contains(s.anchorNode)?s.anchorOffset:0;})).toBeGreaterThanOrEqual(8);
  await chooseTarget();await picker.locator('li').filter({hasText:'Figure: Target section trace'}).getByRole('button',{name:'Insert reference'}).press('Enter');
  await expect(content).toHaveText(/Authored ?Figure: Target section trace ?discussion\./);
  await expect(ui).toHaveAttribute('aria-busy','false');await expect(content).toBeFocused();await content.press('Home');await content.pressSequentially('Revised ');await expect(content).toContainText('Revised ');await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');
  await ui.locator('[data-command="edit-undo"]').press('Enter');await expect(content).not.toContainText('Revised');await expect(content).toContainText('Figure: Target section trace');
  await expect(ui.locator('[data-command="edit-redo"]')).toBeEnabled();await ui.locator('[data-command="edit-redo"]').press('Enter');await expect(content).toContainText('Revised');
  await content.press('End');
  await chooseTarget();await picker.locator('li').filter({hasText:'Table: Target readings'}).getByRole('button',{name:'Insert reference',exact:true}).click();await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');await expect(content).toContainText('Table: Target readings');
  await chooseTarget();await picker.locator('li').filter({hasText:'Section: Target section'}).getByRole('button',{name:'Insert reference',exact:true}).click();await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');await expect(content).toContainText('Section: Target section');
  const authored=(await documents.read('section',{id,sectionId:intro.id})).section;expect(authored.content.content.flatMap(block=>block.content??[]).filter(node=>node.marks?.some(mark=>parsePdfCrossReference(mark.attrs?.href)))).toHaveLength(3);
  await page.reload();await expect(ui.getByLabel('Section title',{exact:true})).toBeVisible({timeout:45000});await expect(content).toContainText('Table: Target readings');await expect(content).toContainText('Section: Target section');
  await content.locator('a').filter({hasText:'Figure: Target section trace'}).click();
  await ui.getByRole('button',{name:'Go to selected reference'}).press('Enter');await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue('Target section');await expect(content).toBeFocused();
  await ui.getByRole('button',{name:'Return to reference'}).press('Enter');await expect(content).toBeFocused();expect(await page.evaluate(()=>window.getSelection().toString())).toBe('Figure: Target section trace');
  async function download(){const ready=page.waitForEvent('download',{timeout:45000});await ui.getByRole('button',{name:'Download PDF',exact:true}).click();const artifact=await ready;expect((await readFile(await artifact.path())).subarray(0,5).toString()).toBe('%PDF-');await ui.getByRole('button',{name:'Close exports',exact:true}).click();}
  await download();expect(rendered[0].references.map(value=>value.text)).toEqual(['Figure 2','Table 2','3 Target section']);expect(rendered[0].text).not.toContain('Table: Target readings');
  await ui.getByRole('navigation',{name:'Sections',exact:true}).getByRole('button',{name:'Target section',exact:true}).click();const outline=ui.locator('[data-pdf-outline]');await outline.locator('summary').click();await outline.locator('[data-pdf-outline-position]').fill('2');await outline.locator('[data-command="outline-move"]').click();await expect(ui.getByRole('navigation',{name:'Sections',exact:true}).getByRole('button').nth(1)).toHaveText('Target section');
  await download();expect(rendered[1].references.map(value=>value.text)).toEqual(['Figure 1','Table 1','2 Target section']);expect(rendered[1].references.map(value=>value.href)).toEqual(rendered[0].references.map(value=>value.href));
  const targetButton=ui.getByRole('navigation',{name:'Sections',exact:true}).getByRole('button',{name:'Target section',exact:true});
  await ui.locator('[data-command="audience-omit"]').click();await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');
  await ui.locator('[data-command="preflight"]').click();await ui.locator('[data-pdf-preflight] [data-command="finding"]').press('Enter');
  await expect(content).toBeFocused();expect(await page.evaluate(()=>window.getSelection().toString())).toBe('Figure: Target section trace');
  await targetButton.click();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue('Target section');
  await ui.locator('[data-command="audience-include"]').click();await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');
  const production=ui.locator('[data-disclosure="pdf-production"]');if(!await production.evaluate(el=>el.open))await production.locator(':scope > summary').click();
  await ui.locator('summary').filter({hasText:/^Document layout$/}).click();await ui.getByRole('combobox',{name:'Clickable links',exact:true}).selectOption('disabled');await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');await download();expect(rendered[2].references).toEqual([]);expect(rendered[2].text).toContain('Table 1');expect(rendered[2].text).toContain('2 Target section');expect(rendered[2].text).not.toContain('Table: Target readings');
  const options=ui.locator('[data-disclosure="pdf-section-options"]');if(!await options.evaluate(el=>el.open))await options.locator(':scope > summary').click();
  await ui.getByRole('button',{name:'Remove section',exact:true}).click();await expect(ui.getByRole('navigation',{name:'Sections',exact:true}).getByRole('button',{name:'Target section',exact:true})).toHaveCount(0);await ui.getByRole('button',{name:'Download PDF',exact:true}).click();
  await expect(ui.locator('[data-export-error]:visible')).toHaveText('This document contains an internal reference that needs a PDF destination.');await expect(ui.locator('[data-pdf-export]').filter({has:page.locator('[data-export-error]:visible')}).locator('[data-export-state]')).toHaveText('Could not finish');expect(rendered).toHaveLength(3);expect((await documents.read('section',{id,sectionId:intro.id})).section.content).toEqual(authored.content);expect(errors).toEqual([]);
  await ui.getByRole('button',{name:'Close exports',exact:true}).click();await ui.locator('[data-command="preflight"]').click();
  await ui.locator('[data-pdf-preflight] [data-command="finding"]').press('Enter');await expect(content).toBeFocused();
  expect(await page.evaluate(()=>window.getSelection().toString())).toBe('Figure: Target section trace');
 }finally{await app.close();removeRenderer();await clearVault(fixture.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-references-ui-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
