import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {RecordWriting} from '../../src/record-writing.js';

test('publication permissions are saved with the lab book and its writing sections',async({page},info)=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-publication-controls-')),book=sampleNotebook(),record=book.entries[0],notebook=book.notebooks.find(n=>n.id===record.notebookId);
 record.sections=[{id:randomUUID(),title:'Internal method',body:'Retained internal observation.'}];
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');
  await page.getByRole('button',{name:'Edit record',exact:true}).click();
  await page.locator('.record-editing [data-action="writing-edit"][data-section="'+record.sections[0].id+'"]').click();
  const dialog=page.getByRole('dialog',{name:'Edit writing section',exact:true}),permission=dialog.getByRole('checkbox',{name:'Allow this section on websites',exact:true});
  await expect(permission).toBeChecked();await permission.uncheck();
  await expect(dialog.locator('[data-writing-status]')).toHaveText('Recovery checkpoint saved.');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  const target={workspaceId:book.id,recordId:record.id,sectionId:record.sections[0].id};
  expect((await new RecordWriting(f.workspace).read(target)).value.share).toBe(false);
  await page.reload();await expect(page.locator('.record-editing')).toBeVisible();
  await page.locator('.record-editing [data-action="writing-edit"][data-section="'+record.sections[0].id+'"]').click();await expect(permission).not.toBeChecked();
  await page.screenshot({path:info.outputPath('section-publication-permission.png')});await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.goto(app.origin+'/#/projects/'+notebook.projectId);
  await page.locator('.project-notebook').filter({hasText:notebook.title}).getByRole('button',{name:'Lab book settings',exact:true}).click();
  const settings=page.locator('#notebook-config-form');await settings.getByRole('checkbox',{name:'Allow web publishing from this lab book',exact:true}).uncheck();
  await settings.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(settings).not.toBeVisible();
  expect((await f.workspace.outline()).metadata.notebooks.find(n=>n.id===notebook.id).share).toBe(false);
  await page.reload();await page.locator('.project-notebook').filter({hasText:notebook.title}).getByRole('button',{name:'Lab book settings',exact:true}).click();
  await expect(settings.getByRole('checkbox',{name:'Allow web publishing from this lab book',exact:true})).not.toBeChecked();expect(errors).toEqual([]);
 }finally{await page.close();await app.close();clearVault(f.vault);if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-publication-controls-'))throw Error('Unexpected disposable path');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
