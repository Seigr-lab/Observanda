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

test('record save progress stays readable, preserves newer typing and closes on failure and retry',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-save-progress-ui-')),f=await encryptedFixture(directory,sampleNotebook()),book=(await f.workspace.read()).book;
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,headless:true,port:0});
 let release,fail=false;const gate=new Promise(resolve=>{release=resolve;}),remember=ResearchCatalogue.prototype.rememberHistory,errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 ResearchCatalogue.prototype.rememberHistory=async function(record,...args){if(record.title==='Submitted title')await gate;if(fail&&record.title==='Retry this title')throw new AppError('INVALID');if(record.title==='Retry this title')return operationStage('unrecognized-nested-stage',{},()=>remember.call(this,record,...args));return remember.call(this,record,...args);};
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);
  const title=page.getByLabel('Record title',{exact:true}),save=page.getByRole('button',{name:'Save record',exact:true});
  await expect(title).toHaveValue(book.entries[0].title);await title.fill('Submitted title');await save.click();
  const progress=page.getByRole('region',{name:'Saving records',exact:true});await expect(progress.getByRole('heading',{name:'Writing records and history'})).toBeVisible();
  await expect(progress.locator('[data-count]')).toHaveText('0 of 1 records completed in this stage');await expect(progress.locator('[data-hint]')).toContainText('only when the complete save succeeds');
  await expect(page.locator('#save-status')).toHaveText('Unsaved changes');await expect(title).toBeEnabled();await title.fill('Newer typing');
  await page.setViewportSize({width:760,height:1000});await page.evaluate(()=>document.documentElement.style.fontSize='24px');await progress.scrollIntoViewIfNeeded();
  expect(await progress.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await expect(progress.locator('[data-time]')).toBeVisible();await page.screenshot({path:'.local/record-save-progress.png'});
  release();await expect(progress).toHaveCount(0);await expect(title).toHaveValue('Newer typing');await expect(page.locator('#save-status')).toHaveText('Unsaved changes');
  expect((await f.workspace.read()).book.entries[0].title).toBe('Submitted title');
  await expect(page.locator('#notice')).toContainText('Newer edits remain unsaved');await expect(page.locator('#notice')).not.toHaveClass(/error/);await page.locator('#notice').getByRole('button',{name:'Dismiss'}).click();
  await page.getByRole('button',{name:'Back to records',exact:true}).click();await expect(page.locator('#leave-dialog')).toBeVisible();await page.locator('#leave-dialog').getByRole('button',{name:'Stay here',exact:true}).click();await expect(title).toHaveValue('Newer typing');
  await save.click();await expect(page.locator('#save-status')).toHaveText('Saved');expect((await f.workspace.read()).book.entries[0].title).toBe('Newer typing');
  await page.locator('#notice').getByRole('button',{name:'Dismiss'}).click();
  fail=true;await title.fill('Retry this title');await save.click();await expect(save).toBeEnabled();await expect(progress).toHaveCount(0);await expect(title).toHaveValue('Retry this title');await expect(page.locator('#save-status')).toHaveText('Unsaved changes');
  expect((await f.workspace.read()).book.entries[0].title).toBe('Newer typing');
  const failure=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Check these fields',exact:true})});await expect(failure).toBeVisible();await failure.getByRole('button',{name:'Back to workspace',exact:true}).click();
  fail=false;await save.click();await expect(page.locator('#save-status')).toHaveText('Saved');expect((await f.workspace.read()).book.entries[0].title).toBe('Retry this title');expect(errors).toEqual([]);
 }finally{release();ResearchCatalogue.prototype.rememberHistory=remember;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
