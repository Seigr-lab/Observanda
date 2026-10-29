import {openRecordActions} from './record-editing-helper.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {RecordValues} from '../../src/record-values.js';

test('reader moves recover conflicts and lost commit responses without reconstructing the record',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(10000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-location-ui-')),book=sampleNotebook(),record=book.entries[0],notebook={...book.notebooks[0],id:randomUUID(),title:'Destination observations'};
 book.notebooks.push(notebook);record.sections=Array.from({length:67},(_,i)=>({id:randomUUID(),title:'Observation '+i,body:'Original observation '.repeat(80)}));
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),original=ResearchCatalogue.prototype.record,errors=[],reads=[],moves=[];
 ResearchCatalogue.prototype.record=()=>{throw Error('Reader move reconstructed an original');};page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{const route=new URL(r.url()).pathname;if(/^\/api\/workspace\/read\/(selection|page)$/.test(route))reads.push(route);if(route==='/api/research/records/location')moves.push(r.postDataJSON());});
 const dialog=page.getByRole('dialog',{name:'Move record',exact:true}),open=async()=>{await openRecordActions(page);await page.locator('.record-toolbar').getByRole('button',{name:'Move record',exact:true}).click();},move=()=>dialog.getByRole('button',{name:'Move record',exact:true}).click();let release;
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');await expect(page.locator('.record-reader h1')).toHaveText(record.title);
  await open();await dialog.getByRole('button',{name:'Close',exact:true}).click();expect(moves).toEqual([]);
  await open();await dialog.getByLabel('Destination lab book',{exact:true}).selectOption(notebook.id);
  const values=new RecordValues(f.workspace),target={workspaceId:book.id,recordId:record.id,field:'title'},base=await values.read(target);await values.save({...target,expectedRevision:base.revision,value:{value:'Concurrent observation title'}});
  await move();await expect(dialog.getByRole('alert')).not.toBeEmpty();await expect(dialog.getByRole('button',{name:'Move record',exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'Refresh record',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.locator('.record-reader h1')).toHaveText('Concurrent observation title');
  await open();await dialog.getByLabel('Destination lab book',{exact:true}).selectOption(notebook.id);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('record-location-phone.png')});
  await page.route('**/api/research/records/location',async route=>{await route.fetch();await route.abort('failed');},{times:1});await move();await expect(dialog.getByRole('button',{name:'Retry this move',exact:true})).toBeEnabled();
  const failed=moves.at(-1);await dialog.getByRole('button',{name:'Close',exact:true}).click();await open();await expect(dialog.getByLabel('Destination lab book',{exact:true})).toHaveValue(notebook.id);await dialog.getByRole('button',{name:'Retry this move',exact:true}).click();await expect(dialog).not.toBeVisible();expect(moves.at(-1)).toEqual(failed);
  await expect(page.locator('main').getByRole('button',{name:notebook.title,exact:true})).toBeVisible();
  const moved=await f.workspace.catalogue(async store=>store.member(await store.snapshot(),record.id));expect(moved.notebookId).toBe(notebook.id);expect(moved.share).toBe(false);
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>document.documentElement.style.fontSize='');await open();await dialog.getByLabel('Destination lab book',{exact:true}).selectOption(record.notebookId);
  let ready;const started=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve);await page.route('**/api/research/records/location',async route=>{const response=await route.fetch();ready();await gate;await route.fulfill({response}).catch(()=>{});},{times:1});await move();await started;
  await expect(dialog.getByRole('status').first()).toContainText('Closing this window does not cancel');await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.goto(app.origin+'/#/records/'+book.entries[1].id+'/read');release();await page.unrouteAll({behavior:'wait'});await expect(dialog).not.toBeVisible();await expect(page.locator('.record-reader h1')).toHaveText(book.entries[1].title);
  expect(reads).toEqual([]);expect(errors).toEqual([]);
 }finally{release?.();await page.unrouteAll({behavior:'wait'});ResearchCatalogue.prototype.record=original;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
