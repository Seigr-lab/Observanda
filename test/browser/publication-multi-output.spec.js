import {test,expect} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {MediaStore} from '../../src/media.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {navigate} from './preferences-helper.js';
import {task,chooseWebsitePage,openPageSettings} from './composer-helper.js';

async function inspectPdf(bytes){
 const loading=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWasm:false,useWorkerFetch:false});
 try{const pdf=await loading.promise,pages=[];for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n);pages.push({view:page.view,text:(await page.getTextContent()).items.map(item=>item.str??'').join(' ')});page.cleanup();}return pages;}finally{await loading.destroy();}
}

test('two websites and two PDFs retain independent sources, designs, destinations and source-update decisions',async({page,browser},info)=>{
 test.setTimeout(300000);page.setDefaultTimeout(15000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-multi-publication-')),book=sampleNotebook();book.title='Publishing workspace';
 const [first,second,internal]=book.entries;
 Object.assign(first,{title:'Field source',body:'FIELD ORIGINAL 9007199254740993.',figures:[],sections:[{id:randomUUID(),title:'Field section',body:'PUBLIC FIELD SECTION.',share:true}]});
 Object.assign(second,{title:'Learning source',body:'LEARNING ORIGINAL.',sections:[{id:randomUUID(),title:'Learning section',body:'PUBLIC LEARNING ORIGINAL.',share:true},{id:randomUUID(),title:'Internal details',body:'PRIVATE SECTION SENTINEL.',share:false}]});
 Object.assign(internal,{title:'Private research source',body:'PRIVATE RECORD SENTINEL.',sections:[{id:randomUUID(),title:'Internal observation',body:'PRIVATE REPORT ORIGINAL 0001.2300.',share:false}]});
 const fixture=await encryptedFixture(directory,book),sites=new WebsiteSites(fixture.workspace),documents=new PdfDocuments(fixture.workspace,book.id),errors=[];
 const removeRenderer=installPdfRenderer(async input=>{const view=await browser.newPage();try{
  await view.route('**/*',route=>route.abort());await view.emulateMedia({media:'print'});await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);
  const preflight=await view.evaluate(measurePdfPreflight),bytes=input.preflightOnly||preflight.status==='fatal'?null:await view.pdf({preferCSSPageSize:true,printBackground:true});
  return {bytes,preflight,...(bytes?{sha256:createHash('sha256').update(bytes).digest('hex')}:{}),renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};
 }finally{await view.close();}});
 const app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0,headless:true});
 page.on('pageerror',error=>errors.push(error.message));
 const manager=async()=>{await navigate(page,'Websites');await expect(page.getByRole('heading',{name:'Websites',exact:true})).toBeVisible();};
 const card=name=>page.locator('[data-website-card]').filter({has:page.getByRole('heading',{name,exact:true})});
 const editor=async name=>{await manager();await card(name).getByRole('button',{name:'Website editor',exact:true}).click();await expect(page.locator('.website-site-context')).toContainText(name);};
 const saveWebsite=async()=>{await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');};
 const prepareWebsite=async recordId=>{await page.getByRole('button',{name:'Preview & export',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.locator('#full-public-preview')).toBeVisible({timeout:30000});await page.locator('#preview-page').selectOption('entries/'+recordId+'.html');await expect(page.locator('#full-public-preview')).toHaveAttribute('href',new RegExp('/entries/'+recordId+'\\.html$'));return new URL(await page.locator('#full-public-preview').getAttribute('href'),app.url).href;};
 const pdf=page.locator('[data-pdf-editor]'),saved=async()=>{await expect(pdf.locator('[data-pdf-status]')).toHaveText('Saved');await expect(pdf).toHaveAttribute('aria-busy','false');};
 const details=async name=>{const summary=pdf.locator('summary').filter({hasText:new RegExp('^'+name+'$')});if(!await summary.evaluate(node=>node.parentElement.open))await summary.click();};
 const openPdf=async name=>{await navigate(page,'PDF editor');await pdf.getByRole('button',{name,exact:true}).click();await expect(pdf.getByRole('heading',{name,exact:true})).toBeVisible();await saved();};
 const downloadPdf=async()=>{const pending=page.waitForEvent('download',{timeout:45000});await pdf.getByRole('button',{name:'Download PDF',exact:true}).click();return readFile(await (await pending).path());};
 const publications=[];let report,workbook,reportBytes,reportJob;
 try{
  await page.goto(app.url);
  for(const [index,record] of [first,second].entries()){
   const name=index?'Learning website':'Field website',heading=index?'Learning page':'Field page';await manager();await page.getByRole('button',{name:'New website',exact:true}).click();await page.getByLabel('Website name',{exact:true}).fill(name);await page.getByRole('button',{name:'Create website',exact:true}).click();await expect(page.locator('.website-site-context')).toContainText(name);
   await expect(page.getByLabel('Page',{exact:true})).toHaveValue('');await task(page,'Site');await page.getByLabel('Website title',{exact:true}).fill(name+' design');
   await task(page,'Content');await page.locator('[data-project-share="'+book.projects[0].id+'"]').check();await page.locator('[data-publish-entry="'+record.id+'"]').check();await saveWebsite();
   await chooseWebsitePage(page,'entries/'+record.id+'.html');await openPageSettings(page);await page.getByText('Page header',{exact:true}).click();await page.getByLabel('Display heading',{exact:true}).fill(heading);await saveWebsite();
   await page.locator('.website-site-context').getByRole('button',{name:'Publishing destination',exact:true}).click();await page.getByLabel('GitHub owner / organization',{exact:true}).fill('Example');await page.getByLabel('Repository name',{exact:true}).fill(index?'learning-pages':'field-pages');await page.getByRole('button',{name:'Save destination',exact:true}).click();await expect(page.locator('#destination-status')).toHaveText('Destination saved on this device.');
   await page.locator('.website-site-context').getByRole('button',{name:'Website editor',exact:true}).click();const preview=await prepareWebsite(record.id),website=(await sites.list()).sites.find(value=>value.name===name),state=await sites.read(website.id),url=preview,response=await page.request.get(url);expect(response.status()).toBe(200);const html=await response.text();
   expect(html).toContain(heading);expect(html).toContain(record.body);expect(html).not.toContain(index?first.body:second.body);expect(html).not.toContain('PRIVATE SECTION SENTINEL');expect(html).not.toContain('PRIVATE RECORD SENTINEL');expect(state.site.selection.records.filter(value=>value.share).map(value=>value.id)).toEqual([record.id]);publications.push({name,id:website.id,pin:state.websitePin,preview,url,html});console.info('Prepared '+name);
  }
  await navigate(page,'PDF editor');
  for(const [index,record] of [internal,second].entries()){
   const name=index?'Learning workbook':'Internal report',width=index?210:180;await pdf.getByRole('button',{name:'New document',exact:true}).click();await expect(page).toHaveURL(/#\/modules\/pdf-editor\/[a-f0-9-]{36}$/);const id=new URL(page.url()).hash.split('/').at(-1);
   await details('Document');await pdf.getByLabel('Document name',{exact:true}).fill(name);await saved();await details('Document layout');await pdf.getByLabel('Page width (mm)',{exact:true}).fill(String(width));await pdf.getByLabel('Page header',{exact:true}).fill(name+' header');await saved();
   if(index){await pdf.getByLabel('Section title',{exact:true}).fill('Internal workbook notes');await pdf.getByRole('textbox',{name:'Content',exact:true}).fill('OMITTED WORKBOOK SENTINEL.');await saved();await pdf.getByRole('combobox',{name:'Edition audience',exact:true}).selectOption('public');await saved();await pdf.locator('[data-pdf-publication]').getByRole('button',{name:'Omit',exact:true}).click();await saved();}
   await pdf.getByRole('button',{name:'Add research',exact:true}).click();await pdf.getByRole('button',{name:'Content in this workspace or project',exact:true}).click();await pdf.getByLabel('Search record titles').fill(record.title);await pdf.getByRole('button',{name:'Search',exact:true}).click();await pdf.locator('.pdf-source-list').getByRole('button',{name:record.title,exact:true}).click();await pdf.getByRole('button',{name:record.sections[0].title,exact:true}).click();await pdf.getByRole('button',{name:'Insert selected content',exact:true}).click();await expect(pdf.getByRole('textbox',{name:'Content',exact:true})).toHaveText(record.sections[0].body);await saved();
   if(index){await pdf.locator('[data-pdf-publication]').getByRole('button',{name:'Mark reviewed for public use',exact:true}).click();await saved();await pdf.getByRole('button',{name:'Review content selection',exact:true}).click();await expect(pdf.locator('[data-pdf-audience-summary]')).toHaveText('1 included, 1 omitted, 0 awaiting public review (2 sections)');}
   const state=await documents.read('open',{id}),sectionId=(await documents.read('sections',{id})).items.at(-1).id,value={id,sectionId,revision:state.revision,header:state.header};expect(state.header.layout.widthMm).toBe(width);expect(state.header.audience??'private').toBe(index?'public':'private');
   if(index)workbook=value;else{report=value;reportBytes=await downloadPdf();expect((await inspectPdf(reportBytes)).map(value=>value.text).join(' ')).toContain(record.sections[0].body);reportJob=await pdf.locator('[data-pdf-export]').filter({has:page.locator('[data-command="export-download"]:visible')}).first().getAttribute('data-pdf-export');}
   console.info('Saved '+name);await pdf.getByRole('button',{name:'Documents',exact:true}).click();
  }
  expect((await documents.read('list')).items.map(value=>value.name).sort()).toEqual(['Internal report','Learning workbook']);
  for(const record of [internal,second]){
   const current=await fixture.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),record.id);return store.record(row.id,row.revision);}),expectedRevision=recordRevision(current);current.sections[0].body=record===internal?'PRIVATE REPORT AMENDED.':'PUBLIC LEARNING AMENDED.';
   await new ResearchRecords(fixture.workspace,new MediaStore(fixture.workspace)).save({workspaceId:book.id,changes:[{id:current.id,expectedRevision,record:current}]});
  }
  await openPdf('Internal report');await pdf.getByRole('navigation',{name:'Sections'}).getByRole('button',{name:internal.sections[0].title,exact:true}).click();await pdf.getByRole('button',{name:'Review source update',exact:true}).click();await expect(pdf.locator('.pdf-source-diff')).toContainText('PRIVATE REPORT AMENDED.');await pdf.getByRole('button',{name:'Keep document unchanged',exact:true}).click();await expect(pdf.getByRole('textbox',{name:'Content',exact:true})).toHaveText(internal.sections[0].body);expect((await documents.read('open',{id:report.id})).revision).toBe(report.revision);
  await pdf.getByRole('button',{name:'Review source update',exact:true}).click();await pdf.getByRole('button',{name:'Accept source update',exact:true}).click();await expect(pdf.getByRole('textbox',{name:'Content',exact:true})).toHaveText('PRIVATE REPORT AMENDED.');await saved();
  await openPdf('Learning workbook');await pdf.getByRole('navigation',{name:'Sections'}).getByRole('button',{name:second.sections[0].title,exact:true}).click();await expect(pdf.getByRole('textbox',{name:'Content',exact:true})).toHaveText(second.sections[0].body);await pdf.getByRole('button',{name:'Review source update',exact:true}).click();await pdf.getByRole('button',{name:'Accept source update',exact:true}).click();await expect(pdf.getByRole('textbox',{name:'Content',exact:true})).toHaveText('PUBLIC LEARNING AMENDED.');await saved();await expect(pdf.locator('[data-pdf-publication]')).toContainText('Content or document settings changed. Review again.');await pdf.locator('[data-pdf-publication]').getByRole('button',{name:'Mark reviewed for public use',exact:true}).click();await saved();await expect(pdf.locator('[data-pdf-publication]')).toContainText('Reviewed for public use');const workbookRevision=(await documents.read('open',{id:workbook.id})).revision;
  const workbookPages=await inspectPdf(await downloadPdf()),workbookText=workbookPages.map(value=>value.text).join(' ');expect(workbookText).toContain('PUBLIC LEARNING AMENDED.');expect(workbookText).not.toContain('PRIVATE REPORT');expect(workbookText).not.toContain('PRIVATE SECTION SENTINEL');expect(workbookText).not.toContain('OMITTED WORKBOOK SENTINEL');expect(workbookPages[0].view[2]).toBeCloseTo(210*72/25.4,0);
  await openPdf('Internal report');await pdf.getByRole('button',{name:'History',exact:true}).click();await pdf.locator('[data-command="restore"][data-revision="'+report.revision+'"]').click();await saved();await pdf.getByRole('navigation',{name:'Sections'}).getByRole('button',{name:internal.sections[0].title,exact:true}).click();await expect(pdf.getByRole('textbox',{name:'Content',exact:true})).toHaveText(internal.sections[0].body);expect((await documents.read('open',{id:report.id})).header).toEqual(report.header);expect((await documents.read('open',{id:workbook.id})).revision).toBe(workbookRevision);
  await page.reload();await expect(pdf.getByRole('heading',{name:'Internal report',exact:true})).toBeVisible();await pdf.getByRole('button',{name:'PDF exports',exact:true}).click();const retained=page.waitForEvent('download');await pdf.locator('[data-pdf-export="'+reportJob+'"]').getByRole('button',{name:'Download retained PDF',exact:true}).click();expect(await readFile(await (await retained).path())).toEqual(reportBytes);
  for(const [index,publication] of publications.entries()){
   expect((await sites.read(publication.id)).websitePin.websiteRevision).toBe(publication.pin.websiteRevision);expect(await (await page.request.get(publication.url)).text()).toBe(publication.html);
   await editor(publication.name);await task(page,'Site');await expect(page.getByLabel('Website title',{exact:true})).toHaveValue(publication.name+' design');await page.locator('.website-site-context').getByRole('button',{name:'Publishing destination',exact:true}).click();await expect(page.getByLabel('Repository name',{exact:true})).toHaveValue(index?'learning-pages':'field-pages');
  }
  const preview=await page.context().newPage();try{await preview.goto(publications[1].url);await expect(preview.getByRole('heading',{name:'Learning page',exact:true})).toBeVisible();await expect(preview.locator('body')).toContainText('PUBLIC LEARNING ORIGINAL.');await expect(preview.locator('body')).not.toContainText('PUBLIC LEARNING AMENDED.');await preview.screenshot({path:info.outputPath('retained-learning-website.png')});}finally{await preview.close();}
  await openPdf('Learning workbook');await pdf.getByRole('navigation',{name:'Sections'}).getByRole('button',{name:second.sections[0].title,exact:true}).click();await expect(pdf.getByRole('textbox',{name:'Content',exact:true})).toHaveText('PUBLIC LEARNING AMENDED.');await page.screenshot({path:info.outputPath('independent-learning-workbook.png')});expect(errors).toEqual([]);
 }finally{await page.close();await app.close();removeRenderer();clearVault(fixture.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-multi-publication-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
