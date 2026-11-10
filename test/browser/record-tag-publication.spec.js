import {test,expect} from '@playwright/test';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../../src/sample.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {defaultPublicationPrivacy} from '../../src/web/record-publication-privacy.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {answerConfirmation} from './confirm-helper.js';

test('saving a literal lab tag updates its website copy and finder without refreshing unrelated material',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(20000);await page.setViewportSize({width:1360,height:900});page.on('dialog',dialog=>dialog.accept());
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-tags-source-')),book=sampleNotebook(),record=book.entries[2];
 const notebook=book.notebooks.find(n=>n.id===record.notebookId);notebook.title='Water chemistry';notebook.share=true;notebook.sharePdf=true;
 record.title='Stream-water elemental analysis';record.tags=['Co','CO','inductively coupled plasma'];record.body='Instrument readings recorded at the upstream station.';
 record.share=false;record.sharePdf=false;record.publication=defaultPublicationPrivacy();record.publication.pdf.tags=false;book.entries=[record];
 const fixture=await encryptedFixture(directory,book),store=new WebsiteFileStore(fixture.workspace);
 const app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const panel=page.locator('.record-tags'),dialog=page.getByRole('dialog');
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');await page.getByRole('button',{name:'Edit record',exact:true}).click();
  for(const field of ['share','sharePdf']){
   await page.locator('[data-record-publication] [data-value-field="'+field+'"]').click();await dialog.locator('[data-record-value]').selectOption('true');
   await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  }
  const source=await store.sourceForRecord({workspaceId:book.id,recordId:record.id,target:'website'}),pdf=await store.sourceForRecord({workspaceId:book.id,recordId:record.id,target:'pdf'});
  const original=(await store.sourceStatus(source.id)).source,pdfVersion=await store.pdfVersion();
  const site=await store.create({name:'Stream monitoring'}),placed=await store.insertSource(site.site.id,{sourceId:source.id,sourceRevision:source.revision,expectedRevision:site.site.revision});
  await store.save(site.site.id,{path:placed.path,expectedRevision:placed.site.revision,html:placed.html.replace('Instrument readings recorded at the upstream station.','The website editor wrote this introduction.'),css:placed.css});
  await expect(panel.locator('li')).toHaveCount(3);
  for(const details of await page.locator('details').filter({has:panel}).all())if(!await details.evaluate(node=>node.open))await details.locator(':scope > summary').click();
  await expect(panel).toBeVisible();
  if(process.env.OBSERVANDA_RECORD_TAG_SCREEN){
   await panel.locator('[data-action="record-tag-edit"]').first().click();await expect(panel.locator('[data-tag-input="rename"]')).toBeVisible();
   await panel.evaluate(el=>el.scrollIntoView({block:'center'}));await expect(panel.getByText('Co',{exact:true})).toBeInViewport();await expect(panel.getByText('CO',{exact:true})).toBeInViewport();await expect(panel.locator('[data-action="record-tag-add"]')).toBeInViewport();const output=path.resolve(process.env.OBSERVANDA_RECORD_TAG_SCREEN);
   await mkdir(path.dirname(output),{recursive:true});await page.screenshot({path:output});await panel.locator('[data-action="record-tag-cancel"]').click();
  }
  await panel.locator('[data-tag-input="add"]').fill('ICP, batch A');await panel.locator('[data-action="record-tag-add"]').click();
  await expect(panel.locator('li').filter({hasText:'ICP, batch A'})).toBeVisible();
  await expect.poll(async()=>(await store.searchLibrary({tags:['ICP, batch A']})).items.length).toBe(1);
  expect((await store.open(site.site.id)).html).toContain('The website editor wrote this introduction.');
  const added=(await store.sourceStatus(source.id)).source;expect(added.css.blob).toBe(original.css.blob);expect(added.assets).toEqual(original.assets);
  const row=panel.locator('li').filter({hasText:'ICP, batch A'});await row.locator('[data-action="record-tag-edit"]').click();
  await row.locator('[data-tag-input="rename"]').fill('ICP, batch B');await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/research/records/tags')&&response.ok()),row.locator('[data-action="record-tag-rename"]').click()]);
  await expect.poll(async()=>{try{return (await store.open(site.site.id)).html;}catch(error){if(error.code!=='CONFLICT')throw error;return '';}}).toContain('ICP, batch B');
  expect((await store.searchLibrary({tags:['ICP, batch A']})).items).toHaveLength(0);
  const removed=page.waitForResponse(response=>response.url().endsWith('/api/research/records/tags')&&response.ok());await panel.locator('li').filter({hasText:'ICP, batch B'}).locator('[data-action="record-tag-remove"]').click();await answerConfirmation(page,'Remove');await removed;
  await expect(panel.locator('li').filter({hasText:'ICP, batch B'})).toHaveCount(0);
  await expect.poll(async()=>(await store.searchLibrary({tags:['ICP, batch B']})).items.length).toBe(0);
  const opened=await store.open(site.site.id);expect(opened.html).not.toContain('ICP, batch B');expect(opened.html).toContain('The website editor wrote this introduction.');
  expect((await store.searchLibrary({tags:['Co','CO']})).items).toHaveLength(1);
  expect((await store.getSource(pdf.id,{target:'pdf'})).html).not.toContain('inductively coupled plasma');expect(await store.pdfVersion()).toBe(pdfVersion);
 }finally{await app.close();await clearVault(fixture.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
