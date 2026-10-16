import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {RecordValues} from '../../src/record-values.js';
import {ResearchDrafts} from '../../src/research-drafts.js';

async function fixture(page){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-edit-record-')),book=sampleNotebook(),active=book.entries[0];
 while(book.entries.length<64)book.entries.push({...structuredClone(book.entries[2]),id:randomUUID(),title:'Unrelated take '+book.entries.length,body:'Unrelated original. '.repeat(30)});
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),original=ResearchCatalogue.prototype.record,requests=[],errors=[];
 ResearchCatalogue.prototype.record=()=>{throw Error('Saved editing assembled a complete record');};
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/api/'))requests.push(new URL(request.url()).pathname);});
 await page.goto(app.url);await page.goto(app.origin+'/#/records/'+active.id);await expect(page.locator('.record-editing h1')).toHaveText(active.title);
 const service=new RecordValues(f.workspace),target=field=>({workspaceId:book.id,recordId:active.id,field});
 return {...f,book,active,app,service,target,requests,errors,
  async change(field,value){const base=await service.read(target(field));return service.save({...target(field),expectedRevision:base.revision,value:{value}});},
  async close(){ResearchCatalogue.prototype.record=original;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});},
  async read(){ResearchCatalogue.prototype.record=original;return (await f.workspace.read()).book;},
  scoped(){expect(requests.filter(route=>['/api/workspace/read/selection','/api/workspace/read/page','/api/research/records/save'].includes(route))).toEqual([]);expect(errors).toEqual([]);}
 };
}
const dialogFor=page=>page.getByRole('dialog',{name:'Edit Record title',exact:true});
async function openTitle(page){await page.locator('[data-record-detail-field]').selectOption('title');await page.getByRole('button',{name:'Edit selected detail',exact:true}).click();return dialogFor(page);}
async function alterReply(route,change){
 const response=await route.fetch();
 if(response.headers()['content-type']?.includes('application/x-ndjson')){
  const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
  const terminal=events.find(event=>Object.hasOwn(event,'result'));expect(terminal).toBeTruthy();change(terminal.result);
  return route.fulfill({response,body:events.map(event=>JSON.stringify(event)).join('\n')+'\n'});
 }
 const body=await response.json();change(body);return route.fulfill({response,json:body});
}

test('saved editing checkpoints only the selected value, retains failed saves and protects an in-flight save',async({page})=>{
 test.setTimeout(120000);const f=await fixture(page);let release=()=>{};
 try{
  const dialog=await openTitle(page),title=dialog.getByLabel('Record title',{exact:true}),save=dialog.getByRole('button',{name:'Save changes',exact:true});
  await title.fill('Edited field observation');await expect(dialog.locator('[data-writing-status]')).toHaveText('Recovery checkpoint saved.');
  await page.route('**/api/research/records/values/save',route=>route.fulfill({status:503,json:{code:'IO',message:'Synthetic record save failure'}}));
  await save.click();await expect(dialog.getByRole('alert')).toContainText('Synthetic record save failure');await expect(title).toHaveValue('Edited field observation');
  expect((await f.service.read(f.target('title'))).value.value).toBe(f.active.title);await page.unroute('**/api/research/records/values/save');
  const held=new Promise(resolve=>release=resolve);await page.route('**/api/research/records/values/save',async route=>{await held;await route.continue();});
  const request=page.waitForRequest(r=>r.url().endsWith('/api/research/records/values/save'));await save.click();const sent=(await request).postDataJSON();
  expect(sent.recordId).toBe(f.active.id);expect(sent.field).toBe('title');expect(sent.value).toEqual({value:'Edited field observation'});expect(sent.record).toBeUndefined();
  await expect(dialog.locator('[data-writing-fields]')).toHaveJSProperty('inert',true);await expect(save).toBeDisabled();await expect(dialog.locator('.record-save-progress')).toBeVisible();await expect(page.locator('#main .record-save-progress')).toHaveCount(0);release();await expect(dialog).not.toBeVisible();
  await expect(page.locator('.record-editing h1')).toHaveText('Edited field observation');await page.unroute('**/api/research/records/values/save');
  expect((await new ResearchDrafts(f.workspace).list()).drafts).toEqual([]);f.scoped();const stored=await f.read();expect(stored.entries.slice(1)).toEqual(f.book.entries.slice(1));expect(stored.entries[0].body).toEqual(f.active.body);
 }finally{release();await page.unrouteAll({behavior:'wait'});await f.close();}
});

test('saved editing recovery keeps its original conflict base and preserves independently changed fields',async({page})=>{
 test.setTimeout(120000);const f=await fixture(page);
 try{
  const dialog=await openTitle(page);await dialog.getByLabel('Record title',{exact:true}).fill('Local interpretation');await dialog.getByRole('button',{name:'Keep recovery checkpoint and close',exact:true}).click();await expect(dialog).not.toBeVisible();
  await f.change('title','Other writer interpretation');await f.change('outcome','Incomplete field measurement');await page.reload();
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();
  await expect(dialog.getByLabel('Record title',{exact:true})).toHaveValue('Local interpretation');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(dialog.locator('.record-writing-conflict')).toContainText('Other writer interpretation');await dialog.getByRole('button',{name:'Keep my edit after review',exact:true}).click();await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  expect((await f.service.read(f.target('title'))).value.value).toBe('Local interpretation');expect((await f.service.read(f.target('outcome'))).value.value).toBe('Incomplete field measurement');f.scoped();
 }finally{await f.close();}
});

test('discard removes only the selected checkpoint and a failed reader refresh remains retryable',async({page})=>{
 test.setTimeout(120000);const f=await fixture(page);
 try{
  const dialog=await openTitle(page);await dialog.getByLabel('Record title',{exact:true}).fill('Unfinished local title');await expect(dialog.locator('[data-writing-status]')).toHaveText('Recovery checkpoint saved.');
  await f.change('title','Saved by another writer');
  await page.route('**/api/workspace/read/record-content',route=>route.fulfill({status:503,json:{code:'IO',message:'Synthetic refresh interruption'}}));
  await dialog.getByRole('button',{name:'Discard this edit',exact:true}).click();await dialog.getByRole('button',{name:'Discard this edit and its checkpoint?',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Synthetic refresh interruption');await page.unroute('**/api/workspace/read/record-content');await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.locator('.record-editing h1')).toHaveText('Saved by another writer');expect((await new ResearchDrafts(f.workspace).list()).drafts).toEqual([]);f.scoped();
 }finally{await f.close();}
});

test('a locked workspace cannot return a selected value into the editing view',async({page})=>{
 test.setTimeout(120000);const f=await fixture(page);
 try{
  await page.route('**/api/research/records/values/read',async route=>{const locked=await page.request.post(f.app.origin+'/api/access/lock',{data:{},headers:{Origin:f.app.origin}});expect(locked.ok()).toBe(true);await route.continue();});
  const response=page.waitForResponse(r=>r.url().endsWith('/api/research/records/values/read'));await openTitle(page);const result=await response;expect(result.ok()).toBe(false);expect((await result.json()).code).toBe('ACCESS_LOCKED');
  await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();await expect(page.locator('.record-writing[open]')).toHaveCount(0);await expect(page.locator('.record-editing')).toHaveCount(0);f.scoped();
 }finally{await f.close();}
});

test('incomplete selected reads and save acknowledgements never discard the edit or its checkpoint',async({page})=>{
 test.setTimeout(120000);const f=await fixture(page);
 try{
  await page.route('**/api/research/records/values/read',async route=>{const response=await route.fetch(),body=await response.json();body.recordId=randomUUID();await route.fulfill({response,json:body});});
  await openTitle(page);let dialog=page.locator('dialog.record-writing[open]');await expect(dialog.getByRole('alert')).toContainText('selected content response was incomplete');await expect(dialog.locator('[data-record-value]')).toHaveCount(0);await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.unroute('**/api/research/records/values/read');
  await page.route('**/api/research/drafts/values/write',route=>alterReply(route,body=>{delete body.revision;}));
  dialog=await openTitle(page);await dialog.getByLabel('Record title',{exact:true}).fill('Retained after incomplete replies');await expect(dialog.getByRole('alert')).toContainText('checkpoint response was incomplete');
  await page.unroute('**/api/research/drafts/values/write');await dialog.getByRole('button',{name:'Retry checkpoint',exact:true}).click();await expect(dialog.locator('[data-writing-status]')).toHaveText('Recovery checkpoint saved.');await expect(dialog.locator('[data-writing-error]')).toBeEmpty();
  await page.route('**/api/research/records/values/save',route=>alterReply(route,body=>{delete body.etag;}));
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('save response was incomplete');await expect(dialog.getByLabel('Record title',{exact:true})).toHaveValue('Retained after incomplete replies');
  expect((await new ResearchDrafts(f.workspace).list()).drafts).toHaveLength(1);const committed=(await f.workspace.outline()).etag;
  await page.unroute('**/api/research/records/values/save');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();expect((await f.workspace.outline()).etag).toBe(committed);expect((await new ResearchDrafts(f.workspace).list()).drafts).toEqual([]);f.scoped();
 }finally{await f.close();}
});
