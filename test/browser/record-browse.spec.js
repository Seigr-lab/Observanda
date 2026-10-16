import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {openRecordDetail} from './record-editing-helper.js';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
async function fixture(){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-browse-ui-')),book=upgradeNotebook(sampleNotebook()),source=book.entries[0];
 book.entries=Array.from({length:61},(_,i)=>({...source,id:randomUUID(),title:'Listening take '+String(i).padStart(2,'0'),figures:[],contributors:[],body:i%2?'Forest field recording':'Studio recording',sections:[],tags:[i%2?'field':'studio'],type:'note'}));
 const {workspace,vault,deviceStore}=await encryptedFixture(directory,book),app=await testServer({root:workspace.root,deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 return {book,workspace,app,service:new ResearchRecords(workspace,{}),close:async()=>{await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true});}};
}

test('record pages combine filters, preserve page context and open current saved content',async({page})=>{
 const f=await fixture(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(f.app.url);await page.evaluate(id=>location.hash='#/notebooks/'+id,f.book.notebooks[0].id);
  await expect(page.locator('[data-record-list-status]')).toHaveText('Records 1-25 of 61');
  await page.getByText('Filters',{exact:true}).click();await page.getByLabel('Sort records',{exact:true}).selectOption('title');
  await expect(page.locator('.records-table tbody tr').first()).toContainText('Listening take 00');
  await page.getByRole('button',{name:'Next records',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(page.locator('[data-record-list-status]')).toHaveText('Records 26-50 of 61');await expect(page.locator('[data-record-list-status]')).toBeFocused();
  await page.getByRole('button',{name:'Listening take 25',exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText('Listening take 25');
  await page.getByRole('button',{name:'Back to records',exact:true}).click();await expect(page.locator('[data-record-list-status]')).toHaveText('Records 26-50 of 61');
  const saved=await f.workspace.read(),record=saved.book.entries[25],added={...record,id:randomUUID(),title:'Additional field record'};
  await f.service.save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Revised listening take'}},{id:added.id,expectedRevision:null,record:added}]});
  await page.getByRole('button',{name:'Next records',exact:true}).click();await expect(page.locator('[data-record-list-status]')).toHaveText('Records 51-61 of 61');
  await expect(page.locator('#entry-results')).toContainText('Saved records have changed.');
  await page.getByRole('button',{name:'Previous records',exact:true}).click();await page.getByRole('button',{name:'Listening take 25',exact:true}).click();
  await expect(page.locator('.record-reader h1')).toHaveText('Revised listening take');
  await page.getByRole('button',{name:'Back to records',exact:true}).click();await expect(page.locator('[data-record-list-status]')).toHaveText('Records 1-25 of 62');
  await page.getByLabel('Search records',{exact:true}).fill('Forest');await expect(page.locator('#record-count')).toHaveText('31');
  await page.getByLabel('Tags',{exact:true}).fill('studio');await expect(page.getByRole('heading',{name:'No records match these filters',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Clear filters',exact:true}).first().click();await expect(page.locator('#record-count')).toHaveText('62');
  await page.setViewportSize({width:390,height:844});
  expect(await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.getByRole('button',{name:'Next records',exact:true}).click();await expect(page.locator('[data-record-list-status]')).toHaveText('Records 26-50 of 62');
  expect(errors).toEqual([]);
 }finally{await f.close();}
});

test('late query and record-open responses cannot replace newer filters or another record draft',async({page})=>{
 const f=await fixture(),errors=[];page.on('pageerror',e=>errors.push(e.message));let releaseQuery=()=>{},releaseOpen=()=>{};
 try{
  await page.goto(f.app.url);await page.evaluate(()=>location.hash='#/records');await expect(page.locator('#record-count')).toHaveText('61');
  let queryStarted,queryDone;const started=new Promise(resolve=>queryStarted=resolve),done=new Promise(resolve=>queryDone=resolve),gate=new Promise(resolve=>releaseQuery=resolve);
  await page.route('**/api/projects/record-collection/query',async route=>{
   if(route.request().postDataJSON().query.search!=='Studio')return route.continue();
   const response=await route.fetch();queryStarted();await gate;try{await route.fulfill({response});}finally{queryDone();}
  });
  await page.getByLabel('Search records',{exact:true}).fill('Studio');await started;
  await page.getByLabel('Search records',{exact:true}).fill('Forest');await expect(page.locator('#record-count')).toHaveText('30');
  releaseQuery();await done;await expect(page.getByLabel('Search records',{exact:true})).toHaveValue('Forest');await expect(page.locator('#record-count')).toHaveText('30');
  await page.unroute('**/api/projects/record-collection/query');
  let openStarted,openDone;const opened=new Promise(resolve=>openStarted=resolve),finished=new Promise(resolve=>openDone=resolve),openGate=new Promise(resolve=>releaseOpen=resolve);
  let heldOpen=false;await page.route('**/api/workspace/read/start',async route=>{if(heldOpen)return route.continue();heldOpen=true;const response=await route.fetch();openStarted();await openGate;try{await route.fulfill({response});}finally{openDone();}});
  await page.locator('.records-table a[href*="/record/"]').first().click();await opened;
  await page.evaluate(id=>location.hash='#/records/'+id,f.book.entries[0].id);const edit=await openRecordDetail(page);await edit.getByLabel('Record title',{exact:true}).fill('Keep my independent draft');
  releaseOpen();await finished;await expect(edit.getByLabel('Record title',{exact:true})).toHaveValue('Keep my independent draft');
  await edit.getByRole('button',{name:'Save changes',exact:true}).click();await expect(edit).not.toBeVisible();
  expect((await f.workspace.read()).book.entries[0].title).toBe('Keep my independent draft');expect(errors).toEqual([]);
 }finally{releaseQuery();releaseOpen();await f.close();}
});

test('failed queries show a recovery action and never pretend the collection is empty',async({page})=>{
 const f=await fixture();
 try{
  await page.goto(f.app.url);
  await page.route('**/api/projects/record-collection/query',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'DATABASE_UNAVAILABLE',message:'PostgreSQL is temporarily unavailable.'})}));
  await page.evaluate(()=>location.hash='#/records');await expect(page.locator('#entry-results [role="alert"]')).toContainText('temporarily unavailable');
  await expect(page.getByRole('heading',{name:'No records in this view',exact:true})).toHaveCount(0);
  await page.unroute('**/api/projects/record-collection/query');await page.getByRole('button',{name:'Refresh records',exact:true}).click();
  await expect(page.locator('[data-record-list-status]')).toHaveText('Records 1-25 of 61');
 }finally{await f.close();}
});
