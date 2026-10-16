import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';

async function fixture(page,count=42){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-authoring-ui-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[2];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Earlier observation '+i,body:'Unrelated original '+i,sections:[],relations:[],figures:[],attachments:[]}));
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const errors=[],fullReads=[],writes=[],loaded=[],read=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=function(id,...args){loaded.push(id);return read.call(this,id,...args);};
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{
  if(request.url().endsWith('/api/notebook')||request.url().endsWith('/api/workspace/read/page'))fullReads.push(request.url());
  if(/\/api\/research\/records\/(save|remove)$/.test(request.url()))writes.push(request.postDataJSON());
 });
 return {...f,book,app,errors,fullReads,writes,loaded,stopTracking:()=>{ResearchCatalogue.prototype.record=read;},close:async()=>{ResearchCatalogue.prototype.record=read;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}};
}
async function create(page,f){
 await page.goto(f.app.url);await page.evaluate(id=>location.hash='#/notebooks/'+id,f.book.notebooks[0].id);
 await page.getByRole('button',{name:'New record',exact:true}).click();await page.getByRole('button',{name:'Create free-form note',exact:true}).click();
 await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Untitled free-form note');
 return page.evaluate(()=>location.hash.split('/')[2]);
}
async function save(page){await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');}
async function remove(page,accept=true){
 if(await page.locator('.record-reader').count()){
  await page.getByRole('button',{name:'Remove record',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Remove record',exact:true});await dialog.getByRole('button',{name:accept?'Remove record':'Cancel',exact:true}).click();return;
 }
 page.once('dialog',dialog=>accept?dialog.accept():dialog.dismiss());await page.getByRole('button',{name:'Remove record',exact:true}).click();
}

for(const count of [42,420])test('new records and removal stay scoped with '+count+' existing records',async({page})=>{
 test.setTimeout(120000);const f=await fixture(page,count);
 try{
  const id=await create(page,f);expect(f.loaded).toEqual([]);
  await page.getByLabel('Record title',{exact:true}).fill('New apiary field notes');await save(page);
  expect(f.writes[0].recordIds).toEqual([id]);expect(f.writes[0].changes[0].expectedRevision).toBeNull();
  expect(f.loaded.every(value=>value===id)).toBe(true);
  await page.reload();await expect(page.locator('.record-editing h1')).toHaveText('New apiary field notes');
  await remove(page,false);await expect(page.locator('.record-editing h1')).toHaveText('New apiary field notes');
  await remove(page);await expect(page.locator('#entry-results')).toBeVisible();
  expect(f.writes.at(-1)).toMatchObject({workspaceId:f.book.id,recordId:id});expect(f.fullReads).toEqual([]);expect(new Set(f.loaded)).toEqual(new Set([id]));
  f.stopTracking();expect((await f.workspace.read()).book.entries).toEqual(f.book.entries);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('failed creation retains the draft, reload recovers it and unsaved removal never creates a record',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page);
 try{
  const id=await create(page,f);await page.getByLabel('Record title',{exact:true}).fill('Recover my new observation');
  await expect(page.locator('[data-record-checkpoint]')).toContainText('Record draft checkpointed');
  await page.route('**/api/research/records/save',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic save interruption'})}));
  await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#notice')).toContainText('Synthetic save interruption');
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Recover my new observation');
  await page.unroute('**/api/research/records/save');await page.reload();
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('button',{name:'Review draft',exact:true}).click();
  await page.getByRole('button',{name:'Recover this draft',exact:true}).click();await page.getByRole('button',{name:'Save recovered record',exact:true}).click();
  await expect(page.locator('.record-reader h1')).toHaveText('Recover my new observation');expect((await f.workspace.read()).book.entries.find(record=>record.id===id).title).toBe('Recover my new observation');
  await page.getByRole('button',{name:'Back to records',exact:true}).click();await page.getByRole('button',{name:'New record',exact:true}).click();await page.getByRole('button',{name:'Create free-form note',exact:true}).click();
  await page.getByLabel('Record title',{exact:true}).fill('Discard this unsaved draft');await expect(page.locator('[data-record-checkpoint]')).toContainText('Record draft checkpointed');
  const writes=f.writes.length;await remove(page);await expect(page.locator('#entry-results')).toBeVisible();expect(f.writes).toHaveLength(writes);
  expect((await new ResearchDrafts(f.workspace).list()).drafts).toEqual([]);expect(f.fullReads).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('removal preserves concurrent edits and a lost reply can be retried without another write',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page),selected=f.book.entries[0],records=new ResearchRecords(f.workspace,{});
 try{
  await page.goto(f.app.url);await page.evaluate(id=>location.hash='#/records/'+id,selected.id);await expect(page.locator('.record-editing h1')).toHaveText(selected.title);
  await page.getByRole('button',{name:'Remove record',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Remove record',exact:true});
  await records.save({workspaceId:f.book.id,changes:[{id:selected.id,expectedRevision:recordRevision(selected),record:{...selected,title:'Concurrent field notes'}}]},{recordIds:[selected.id]});
  await dialog.getByRole('button',{name:'Remove record',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('changed in another window');
  await dialog.getByRole('button',{name:'Refresh record',exact:true}).click();await expect(page.locator('.record-editing h1')).toHaveText('Concurrent field notes');
  await page.route('**/api/research/records/remove',async route=>{const response=await route.fetch();expect(response.ok()).toBe(true);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic lost reply'})});});
  await remove(page);await expect(dialog.getByRole('alert')).toContainText('Synthetic lost reply');
  const committed=(await f.workspace.outline()).etag;
  await page.unroute('**/api/research/records/remove');await dialog.getByRole('button',{name:'Retry this removal',exact:true}).click();await expect(page.locator('#entry-results')).toBeVisible();expect((await f.workspace.outline()).etag).toBe(committed);
  expect(f.fullReads).toEqual([]);expect(new Set(f.loaded)).toEqual(new Set([selected.id]));expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
