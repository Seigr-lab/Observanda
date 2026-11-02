import {test,expect} from '@playwright/test';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';

test('book, entry and section controls update an existing website placement and independently grant PDF parts',async({page})=>{
 test.setTimeout(240000);page.setDefaultTimeout(20000);await page.setViewportSize({width:1600,height:1000});
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-publication-controls-')),book=sampleNotebook(),record=book.entries[2],notebook=book.notebooks[0],section={id:randomUUID(),title:'Dilution series',body:'The calibration used a 1:10 dilution.',share:false};
 notebook.title='Spectroscopy lab book';record.title='Absorbance calibration';record.sections=[section];record.body='Peak absorbance was measured at 595 nm.';book.entries=[record];
 const fixture=await encryptedFixture(directory,book),app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const dialog=page.getByRole('dialog'),files=new WebsiteFileStore(fixture.workspace),proof=process.env.OBSERVANDA_VISIBILITY_PROOF;
 async function capture(view,name){if(proof){await mkdir(proof,{recursive:true});await view.screenshot({path:path.join(proof,name+'.png')});}}
 const save=async()=>{await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();};
 const edit=async name=>{await page.locator('[data-record-publication] [data-value-field="'+name+'"]').click();await expect(dialog).toBeVisible();};
 const bookSetting=async(website,pdf)=>{
  await page.goto(app.origin+'/#/projects/'+notebook.projectId);
  await page.locator('.project-notebook').filter({hasText:notebook.title}).getByRole('button',{name:'Lab book settings',exact:true}).click();
  await dialog.locator('[name="publication"]').setChecked(website);await dialog.locator('[name="pdfPublication"]').setChecked(pdf);
  await capture(page,'lab-book-visibility');await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(dialog).not.toBeVisible();
 };
 const entrySetting=async(name,value)=>{await edit(name);await dialog.locator('[data-record-value]').selectOption(String(value));await save();};
 const openSection=async()=>{await page.locator('[data-action="writing-edit"][data-section="'+section.id+'"]').click();await expect(dialog).toBeVisible();};
 try{
  await page.goto(app.url);await bookSetting(true,true);
  const entryURL=app.origin+'/#/records/'+record.id;
  await page.goto(entryURL+'/read');await page.getByRole('button',{name:'Edit record',exact:true}).click();
  await edit('publication');await dialog.getByRole('checkbox',{name:'PDF · Summary / context',exact:true}).uncheck();
  await expect(dialog.locator('[data-writing-status]')).toHaveText('Recovery checkpoint saved.');
  await expect(dialog).not.toContainText('Lab book saved.');
  for(const target of ['Website','PDF']){
   const heading=await dialog.getByRole('columnheader',{name:target,exact:true}).boundingBox();
   const control=dialog.getByRole('checkbox',{name:target+' · Summary / context',exact:true}),box=await control.boundingBox(),hit=await control.locator('..').boundingBox();
   expect(Math.abs(heading.x+heading.width/2-box.x-box.width/2)).toBeLessThan(2);expect(hit.width).toBeGreaterThanOrEqual(40);expect(hit.height).toBeGreaterThanOrEqual(40);
  }
  await capture(page,'entry-parts-visibility');await save();
  await entrySetting('sharePdf',true);await entrySetting('share',true);
  await expect(page.locator('[data-record-publication]')).toContainText('Available for publication');await capture(page,'entry-visibility');
  await openSection();await dialog.locator('[data-writing-share-pdf]').check();await expect(dialog.locator('[data-writing-share]')).not.toBeChecked();await capture(page,'section-visibility');await save();
  const find=async target=>files.getSource((await files.sourceForRecord({workspaceId:book.id,recordId:record.id,target})).id,{target});
  const pdf=await files.pdfSource((await find('pdf')).id),website=await find('website');expect(pdf.parts.body).toBeNull();expect(pdf.parts.sections[0].id).toBe(section.id);
  expect(website.html).toContain('Peak absorbance was measured at 595 nm.');expect(website.html).not.toContain('The calibration used a 1:10 dilution.');
  // Begin with a pre-existing saved placement; every change to its permissions
  // below is made through the normal record or lab-book controls.
  const site=await files.create({name:'Laboratory results',html:'<!doctype html><html><head><title>Results</title></head><body><main><h1>Laboratory results</h1><p>Authored introduction.</p></main></body></html>'});
  await files.insertSource(site.site.id,{expectedRevision:site.site.revision,path:site.path,sourceId:website.id,sourceRevision:website.revision});
  const editor=await page.context().newPage();await editor.setViewportSize({width:1600,height:1000});
  await editor.goto(app.origin+'/#/websites/'+site.site.id+'/editor');
  const placement=editor.frameLocator('#website-files-canvas').locator('[data-observanda-source="'+website.id+'"]');
  await expect(placement).toContainText('Peak absorbance was measured at 595 nm.');await expect(placement).not.toContainText(section.body);
  await openSection();await dialog.locator('[data-writing-share]').check();await dialog.locator('[data-writing-share-pdf]').uncheck();await save();
  await editor.bringToFront();await expect(placement).toContainText(section.body,{timeout:20000});await capture(editor,'placed-entry-updated');
  await entrySetting('share',false);await expect(placement).toHaveText('',{timeout:20000});
  await entrySetting('share',true);await expect(placement).toContainText(section.body,{timeout:20000});
  await bookSetting(false,true);await expect(placement).toHaveText('',{timeout:20000});
  await page.goto(entryURL);await expect(page.locator('[data-record-publication]')).toContainText('Withheld by lab book');
  await bookSetting(true,true);await expect(placement).toContainText(section.body,{timeout:20000});
  const updatedPdf=await files.pdfSource((await find('pdf')).id);expect(updatedPdf.parts.body).toBeNull();expect(updatedPdf.parts.sections).toHaveLength(0);
  await expect(editor.frameLocator('#website-files-canvas').getByText('Authored introduction.',{exact:true})).toBeVisible();await editor.close();
 }finally{await app.close();await clearVault(fixture.vault);await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
});

test('new entry authors choose both outputs for writing, media and entry parts before the first save',async({page})=>{
 test.setTimeout(150000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-new-entry-privacy-')),book=sampleNotebook(),notebook=book.notebooks[0];
 notebook.sharePdf=true;
 const fixture=await encryptedFixture(directory,book),app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/notebooks/'+notebook.id);
  await page.getByRole('button',{name:'New record',exact:true}).click();await page.getByRole('button',{name:'Create free-form note',exact:true}).click();
  await page.getByLabel('Record title',{exact:true}).fill('New visibility decisions');
  const panel=page.locator('.record-draft-editor [data-record-publication]');
  const website=panel.getByRole('checkbox',{name:'Available for websites',exact:true}),pdf=panel.getByRole('checkbox',{name:'Available for PDF',exact:true});
  await expect(website).not.toBeChecked();await expect(pdf).not.toBeChecked();await website.check();await pdf.check();
  await panel.locator('summary').click();await panel.getByRole('checkbox',{name:'PDF · Summary / context',exact:true}).uncheck();
  await page.locator('[data-action="section-add"]').click();
  const section=page.locator('[data-writing-section]').last();await section.locator('[data-writing-heading]').fill('Calibration detail');await section.locator('[data-writing-share]').uncheck();await section.locator('[data-writing-share-pdf]').check();
  await page.locator('[data-disclosure="draft-evidence"] > summary').click();
  await page.getByLabel('Add media',{exact:true}).setInputFiles(path.resolve('src/preview-assets/image.png'));
  const media=page.locator('.media-item').last();await media.locator('[data-column="sharePdf"]').check();await expect(media.locator('[data-column="share"]')).not.toBeChecked();
  const recordId=new URL(page.url()).hash.split('/')[2];await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('.record-editing h1')).toHaveText('New visibility decisions',{timeout:20000});
  const saved=(await fixture.workspace.read()).book.entries.find(item=>item.id===recordId);
  expect(saved).toMatchObject({share:true,sharePdf:true,publication:{pdf:{body:false},website:{body:true}}});
  expect(saved.sections.at(-1)).toMatchObject({title:'Calibration detail',share:false,sharePdf:true});expect(saved.attachments.at(-1)).toMatchObject({share:false,sharePdf:true});
  await page.reload();await expect(page.locator('.record-editing [data-record-publication]')).toContainText('Available for publication');
 }finally{await app.close();await clearVault(fixture.vault);await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
});
