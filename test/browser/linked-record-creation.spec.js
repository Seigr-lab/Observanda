import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {beekeepingFixture} from '../beekeeping-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {readProgressStream} from '../../src/web/progress-stream.js';
import {navigate,preferences} from './preferences-helper.js';

for(const templated of [false,true])test(`create ${templated?'a template inspection':'an ordinary linked record'} from a large source without loading its body`,async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(10000);const {book,hive,other}=beekeepingFixture();if(!templated)hive.template=null;
 hive.sections=Array.from({length:templated?257:67},(_,i)=>({id:randomUUID(),title:'Retained observation '+i,body:'Unchanged source evidence '.repeat(100)}));
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-linked-creation-')),f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const original=ResearchCatalogue.prototype.record,loaded=[],requests=[],errors=[],applyCommands=[];let created,plan,acknowledgement,interrupted=false,finished=false;
 ResearchCatalogue.prototype.record=function(id,...args){if(book.entries.some(r=>r.id===id))throw Error('Linked creation loaded an existing body');loaded.push(id);return original.call(this,id,...args);};
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{const route=new URL(request.url()).pathname;if(/\/api\/workspace\/read\/(selection|page)$/.test(route)||route==='/api/research/records/save')requests.push({path:route,body:request.postDataJSON()});if(route==='/api/research/drafts/review/apply')applyCommands.push(request.postDataJSON());});
 const dialog=page.getByRole('dialog',{name:'Add linked record',exact:true}),reader=page.locator('.record-reader');
 try{
  await page.goto(app.url);
  if(templated){await navigate(page,'Preferences');await preferences(page,'Templates');const enabled=page.waitForResponse(r=>r.url().endsWith('/api/dashboard/pending')&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='save'&&r.ok());await page.getByRole('switch',{name:'Enable Beekeeping',exact:true}).check();await enabled;}
  await page.goto(app.origin+'/#/records/'+hive.id+'/read');await expect(reader).toContainText(hive.title);
  await page.getByRole('button',{name:'Add linked record',exact:true}).click();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(reader).toContainText(hive.title);expect(requests).toEqual([]);
  await page.getByRole('button',{name:'Add linked record',exact:true}).click();await page.evaluate(id=>location.hash='#/records/'+id+'/read',other.id);await expect(dialog).not.toBeVisible();await expect(reader).toContainText(other.title);
  await page.goto(app.origin+'/#/records/'+hive.id+'/read');
  if(templated){await page.getByRole('button',{name:'New inspection',exact:true}).click();await expect(page.getByLabel('Queen observation',{exact:true})).toHaveValue('');}
  else{await page.getByRole('button',{name:'Add linked record',exact:true}).click();await dialog.getByLabel('Record template').selectOption('type:note');await dialog.getByRole('button',{name:'Create record',exact:true}).click();}
  await page.getByLabel('Record title',{exact:true}).fill('New linked observation');expect(requests).toEqual([]);created=new URL(page.url()).hash.split('/')[2];expect(created).toBeTruthy();expect(book.entries.some(record=>record.id===created)).toBe(false);
  // Initial Save commits the durable checkpoint through a retained review plan.
  // Interrupt its apply request, then prove retry keeps that exact identity.
  await page.route('**/api/research/drafts/review/prepare',async route=>{const response=await route.fetch();plan=await readProgressStream(new Response(await response.body()),()=>{});await route.fulfill({response});});
  await page.route('**/api/research/drafts/review/apply',async route=>{if(!interrupted){interrupted=true;return route.fulfill({status:503,json:{code:'IO',message:'Synthetic interrupted creation'}});}const response=await route.fetch();acknowledgement=await readProgressStream(new Response(await response.body()),()=>{});await route.fulfill({response});});
  const prepared=page.waitForResponse(r=>r.url().endsWith('/api/research/drafts/review/prepare')&&r.ok());await page.getByRole('button',{name:'Save record',exact:true}).click();await prepared;expect(plan).toMatchObject({recordId:created,newRecord:true,count:0,storageRevision:null});await expect(page.locator('#notice')).toContainText('Synthetic interrupted creation');await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('New linked observation');
  expect(await f.workspace.catalogue(async store=>store.member(await store.snapshot(),created))).toBe(null);await page.locator('#notice').getByRole('button',{name:'Dismiss',exact:true}).click();
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/research/drafts/review/apply')&&r.ok());await page.getByRole('button',{name:'Save record',exact:true}).click();await saved;expect(acknowledgement).toMatchObject({recordDraftRecovered:true,recordId:created});expect(acknowledgement.book).toBeUndefined();await expect(page.locator('.record-editing h1')).toHaveText('New linked observation');
  expect(applyCommands).toHaveLength(2);expect(applyCommands[0]).toEqual({id:plan.id,workspaceId:book.id,expectedRevision:plan.revision});expect(applyCommands[1]).toEqual(applyCommands[0]);expect(loaded).toEqual([]);expect(requests).toEqual([]);
  await page.getByRole('button',{name:'Back to records',exact:true}).click();await expect(page.locator('#entry-results')).toBeVisible();
  await page.goto(app.origin+'/#/records/'+hive.id+'/read');if(!templated)await page.getByRole('button',{name:'Show linked records',exact:true}).click();await page.getByRole('region',{name:templated?'Hive history':'Linked records',exact:true}).getByRole('link',{name:'New linked observation',exact:true}).click();await expect(reader.locator('h1')).toHaveText('New linked observation');expect(errors).toEqual([]);
  finished=true;
 }finally{ResearchCatalogue.prototype.record=original;await app.close();if(!finished){clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}}
 try{
  const saved=(await f.workspace.read()).book;expect(saved.entries.find(r=>r.id===hive.id)).toEqual(hive);expect(saved.entries.find(r=>r.id===other.id)).toEqual(other);
  const record=saved.entries.find(r=>r.id===created);expect(record.relations).toEqual([expect.objectContaining({type:'Documents',target:{workspaceId:book.id,kind:'record',id:hive.id}})]);expect(record.sections.length).toBeLessThan(10);expect(Boolean(record.template)).toBe(templated);expect(record.share).toBe(false);
 }finally{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
