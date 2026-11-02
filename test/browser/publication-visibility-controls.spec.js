import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';

test('book, entry and section controls publish independent PDF and website compositions',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(20000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-publication-controls-')),book=sampleNotebook(),record=book.entries[2],notebook=book.notebooks[0],section={id:randomUUID(),title:'Observation detail',body:'Selected only for PDF.',share:false};
 record.sections=[section];record.body='Available to the website';book.entries=[record];
 const fixture=await encryptedFixture(directory,book),app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const dialog=page.getByRole('dialog'),files=new WebsiteFileStore(fixture.workspace);
 const save=async()=>{await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();};
 const edit=async name=>{const select=page.locator('[data-record-detail-field]');if(!await select.isVisible())await page.locator('[data-disclosure="record-details"] > summary').click();await select.selectOption(name);await select.locator('../..').locator('button[data-action="record-value-edit"]').click();await expect(dialog).toBeVisible();};
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/projects/'+notebook.projectId);
  await page.locator('.project-notebook').filter({hasText:notebook.title}).getByRole('button',{name:'Lab book settings',exact:true}).click();
  await dialog.locator('[name="pdfPublication"]').check();await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.goto(app.origin+'/#/records/'+record.id+'/read');await page.getByRole('button',{name:'Edit record',exact:true}).click();
  await edit('publication');await dialog.locator('[data-publication-target="pdf"][data-publication-part="body"]').uncheck();await save();
  await edit('sharePdf');await dialog.locator('[data-record-value]').selectOption('true');await save();
  await edit('share');await dialog.locator('[data-record-value]').selectOption('true');await save();
  await page.locator('[data-action="writing-edit"][data-section="'+section.id+'"]').click();await dialog.locator('[data-writing-share-pdf]').check();await expect(dialog.locator('[data-writing-share]')).not.toBeChecked();await save();
  const find=async target=>files.getSource((await files.sourceForRecord({workspaceId:book.id,recordId:record.id,target})).id,{target});
  const pdf=await files.pdfSource((await find('pdf')).id),website=await find('website');expect(pdf.parts.body).toBeNull();expect(pdf.parts.sections[0].id).toBe(section.id);
  expect(website.html).toContain('Available to the website');expect(website.html).not.toContain('Selected only for PDF.');
 }finally{await app.close();await clearVault(fixture.vault);await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
});