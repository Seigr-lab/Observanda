import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {AppError} from '../../src/errors.js';
import {operationStage} from '../../src/operation-progress.js';
import {RecordValues} from '../../src/record-values.js';
import {openRecordDetail} from './record-editing-helper.js';
import {navigate} from './preferences-helper.js';

test('new record save progress stays readable, preserves newer typing and closes on failure and retry',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-save-progress-ui-')),f=await encryptedFixture(directory,sampleNotebook()),book=(await f.workspace.read()).book;
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,headless:true,port:0});
 let release,fail=false;const gate=new Promise(resolve=>{release=resolve;}),remember=ResearchCatalogue.prototype.rememberHistory,errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 ResearchCatalogue.prototype.rememberHistory=async function(record,...args){if(record.title==='Submitted title')await gate;if(fail&&record.title==='Retry this title')throw new AppError('INVALID');if(record.title==='Retry this title')return operationStage('unrecognized-nested-stage',{},()=>remember.call(this,record,...args));return remember.call(this,record,...args);};
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/notebooks/'+book.notebooks[0].id);
  await page.getByRole('button',{name:'New record',exact:true}).click();await page.getByRole('button',{name:'Create free-form note',exact:true}).click();
  await expect(page).toHaveURL(/#\/records\/[a-f0-9-]+$/);const recordId=await page.evaluate(()=>location.hash.split('/')[2]);
  const title=page.getByLabel('Record title',{exact:true}),save=page.getByRole('button',{name:'Save record',exact:true});
  await expect(title).toBeVisible();await title.fill('Submitted title');await save.click();
  const progress=page.getByRole('region',{name:'Saving records',exact:true});await expect(progress.getByRole('heading',{name:'Writing records and history'})).toBeVisible();
  await expect(progress.locator('[data-count]')).toHaveText('0 of 1 records completed in this stage');await expect(progress.locator('[data-hint]')).toContainText('only when the complete save succeeds');
  await expect(page.locator('#save-status')).toHaveText('Unsaved changes');await expect(title).toBeEnabled();await title.fill('Newer typing');
  await page.setViewportSize({width:760,height:1000});await page.evaluate(()=>document.documentElement.style.fontSize='24px');await progress.scrollIntoViewIfNeeded();
  expect(await progress.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await expect(progress.locator('[data-time]')).toBeVisible();await page.screenshot({path:test.info().outputPath('record-save-progress.png')});
  release();await expect(progress).toHaveCount(0);await expect(title).toHaveValue('Newer typing');await expect(page.locator('#save-status')).toHaveText('Unsaved changes');
  expect((await f.workspace.read()).book.entries.find(record=>record.id===recordId).title).toBe('Submitted title');
  await expect(page.locator('#notice')).toContainText('Newer edits remain unsaved');await expect(page.locator('#notice')).not.toHaveClass(/error/);await page.locator('#notice').getByRole('button',{name:'Dismiss'}).click();
  await page.getByRole('button',{name:'Back to records',exact:true}).click();await expect(page.locator('#leave-dialog')).toBeVisible();await page.locator('#leave-dialog').getByRole('button',{name:'Stay here',exact:true}).click();await expect(title).toHaveValue('Newer typing');
  await save.click();await expect(page.locator('#save-status')).toHaveText('Saved');expect((await f.workspace.read()).book.entries.find(record=>record.id===recordId).title).toBe('Newer typing');
  await page.locator('#notice').getByRole('button',{name:'Dismiss'}).click();
  fail=true;await title.fill('Retry this title');await save.click();await expect(save).toBeEnabled();await expect(progress).toHaveCount(0);await expect(title).toHaveValue('Retry this title');await expect(page.locator('#save-status')).toHaveText('Unsaved changes');
  expect((await f.workspace.read()).book.entries.find(record=>record.id===recordId).title).toBe('Newer typing');
  const failure=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Check these fields',exact:true})});await expect(failure).toBeVisible();await failure.getByRole('button',{name:'Back to workspace',exact:true}).click();
  fail=false;await save.click();await expect(page.locator('#save-status')).toHaveText('Saved');expect((await f.workspace.read()).book.entries.find(record=>record.id===recordId).title).toBe('Retry this title');expect(errors).toEqual([]);
 }finally{release();ResearchCatalogue.prototype.rememberHistory=remember;await page.close();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});


test('saved record progress belongs to the selected field and failed edits remain recoverable across navigation',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-selected-save-progress-')),f=await encryptedFixture(directory,sampleNotebook()),book=(await f.workspace.read()).book,record=book.entries[0];
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,headless:true,port:0}),service=new RecordValues(f.workspace),target={workspaceId:book.id,recordId:record.id,field:'title'},saveValue=RecordValues.prototype.save,errors=[];
 let release,fail=false;const gate=new Promise(resolve=>release=resolve);page.on('pageerror',error=>errors.push(error.message));
 RecordValues.prototype.save=async function(command){
  if(this.workspace.root!==f.workspace.root||command.recordId!==record.id)return saveValue.call(this,command);
  if(command.value.value==='Submitted selected title')await operationStage('write-records',{unit:'records',total:1},()=>gate);
  if(fail)throw new AppError('INVALID');
  return operationStage('unrecognized-nested-stage',{},()=>saveValue.call(this,command));
 };
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');await page.getByRole('button',{name:'Edit record',exact:true}).click();
  const dialog=await openRecordDetail(page),title=dialog.getByLabel('Record title',{exact:true}),save=dialog.getByRole('button',{name:'Save changes',exact:true}),progress=dialog.getByRole('region',{name:'Saving records',exact:true});
  await title.fill('Submitted selected title');await expect(dialog.locator('[data-writing-status]')).toHaveText('Recovery checkpoint saved.');await save.click();
  await expect(progress.getByRole('heading',{name:'Writing records and history',exact:true})).toBeVisible();await expect(progress.locator('[data-count]')).toHaveText('0 of 1 records completed in this stage');await expect(progress.locator('[data-hint]')).toHaveText('Your recovery checkpoint remains available until this save is confirmed.');
  await expect(page.locator('#main .record-save-progress')).toHaveCount(0);await expect(dialog.locator('[data-writing-fields]')).toHaveJSProperty('inert',true);await expect(save).toBeDisabled();expect((await service.read(target)).value.value).toBe(record.title);
  await page.setViewportSize({width:760,height:1000});await page.evaluate(()=>document.documentElement.style.fontSize='24px');await progress.scrollIntoViewIfNeeded();expect(await progress.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);await expect(progress.locator('[data-time]')).toBeVisible();await page.screenshot({path:test.info().outputPath('selected-record-save-progress.png')});
  release();await expect(dialog).not.toBeVisible();await expect(page.locator('.record-save-progress')).toHaveCount(0);await expect(page.locator('.record-editing h1')).toHaveText('Submitted selected title');expect((await service.read(target)).value.value).toBe('Submitted selected title');
  await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));await page.setViewportSize({width:1280,height:900});await openRecordDetail(page);await title.fill('Retry selected title');fail=true;await save.click();
  await expect(dialog.locator('[data-writing-error]')).toContainText('Some fields are invalid');await expect(save).toBeEnabled();await expect(progress).toHaveCount(0);await expect(title).toHaveValue('Retry selected title');expect((await service.read(target)).value.value).toBe('Submitted selected title');
  await dialog.getByRole('button',{name:'Keep recovery checkpoint and close',exact:true}).click();await expect(dialog).not.toBeVisible();await navigate(page,'Dashboard');await expect(page.locator('#leave-dialog')).not.toBeVisible();await page.goto(app.origin+'/#/records/'+record.id);
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();await expect(title).toHaveValue('Retry selected title');
  fail=false;await save.click();await expect(dialog).not.toBeVisible();await expect(page.locator('.record-save-progress')).toHaveCount(0);await expect(page.locator('.record-editing h1')).toHaveText('Retry selected title');expect((await service.read(target)).value.value).toBe('Retry selected title');
  await page.getByRole('button',{name:'Read record',exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText('Retry selected title');const stored=(await f.workspace.read()).book;expect(stored.entries.find(entry=>entry.id===record.id).body).toEqual(record.body);expect(stored.entries.filter(entry=>entry.id!==record.id)).toEqual(book.entries.filter(entry=>entry.id!==record.id));expect(errors).toEqual([]);
 }finally{release();RecordValues.prototype.save=saveValue;await page.close();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
