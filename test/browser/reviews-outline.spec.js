import {openRecordActions} from './record-editing-helper.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {Reviews} from '../../src/reviews.js';
import {reviewHash} from '../../src/security/review-exchange.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {writeWorkspaceDashboard,readWorkspaceDashboard} from '../../src/security/dashboard-storage.js';

async function fixture(page,count){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-review-outline-ui-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.notebooks.push({...structuredClone(book.notebooks[0]),id:randomUUID(),title:'Other takes'});
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),notebookId:book.notebooks[i<2?0:1].id,title:'Private take '+i,body:'Original material '+i,share:false,sections:[],figures:[],attachments:[],relations:[]}));
 const f=await encryptedFixture(path.join(directory,'author'),book),other=await encryptedFixture(path.join(directory,'reviewer'),sampleNotebook()),settings=defaultDashboard();settings.views[0].panels=[];settings.enabledModules.push('collaboration');
 await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const reviews=new Reviews(f.workspace,f.deviceStore),contact=await new Reviews(other.workspace,other.deviceStore).identity.contact();
 await reviews.run('contact',{workspaceId:book.id,name:'Reviewer',contact,verified:true});
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),requests=[],bodies=[],errors=[],original=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=function(id,...args){bodies.push(id);return original.call(this,id,...args);};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push({path:new URL(r.url()).pathname,data:r.postData()});});
 return {...f,app,book,reviews,contact,bodies,requests,errors,async close(){ResearchCatalogue.prototype.record=original;await app.close();clearVault(f.vault);clearVault(other.vault);await rm(directory,{recursive:true,force:true});}};
}
for(const count of [42,420])test('review workflow reads only its selected records among '+count+' originals',async({page})=>{
 test.setTimeout(120000);const f=await fixture(page,count);
 try{
  await page.goto(f.app.url);await expect(page.locator('.desk-desktop')).toBeVisible();await page.evaluate(()=>location.hash='#/modules/collaboration');await expect(page.getByRole('heading',{name:'Collaboration',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Request review',exact:true}).click();const dialog=page.locator('#dialog'),scope=dialog.getByLabel('Send for review',{exact:true}),create=dialog.getByRole('button',{name:'Create encrypted request',exact:true});
  await scope.selectOption('notebook:'+f.book.notebooks[0].id);await expect(create).toBeDisabled();
  await page.route('**/api/reviews/plan',route=>route.fulfill({status:503,json:{code:'DATABASE_UNAVAILABLE',message:'Synthetic selection interruption'}}),{times:1});
  await dialog.getByRole('button',{name:'Preview selection',exact:true}).click();await expect(dialog.locator('[role="alert"]')).toContainText('PostgreSQL is unavailable.');await expect(create).toBeDisabled();
  await dialog.getByRole('button',{name:'Preview selection',exact:true}).click();await expect(dialog.locator('[data-review-plan] li')).toHaveCount(2);expect(f.bodies).toEqual([]);
  const target=f.book.entries[0];await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:target.id,expectedRevision:recordRevision(target),record:{...target,title:'Changed after preview'}}]},{recordIds:[target.id]});f.bodies.length=0;
  await create.click();await expect(dialog.locator('[role="alert"]')).toContainText('The selection changed');expect(f.bodies).toEqual([]);
  await dialog.getByRole('button',{name:'Preview selection',exact:true}).click();await expect(dialog.locator('[data-review-plan]')).toContainText('Changed after preview');
  await scope.selectOption('notebook:'+f.book.notebooks[1].id);await expect(create).toBeDisabled();await expect(dialog.locator('[data-review-plan] li')).toHaveCount(0);
  await scope.selectOption('notebook:'+f.book.notebooks[0].id);await dialog.getByRole('button',{name:'Preview selection',exact:true}).click();await expect(create).toBeEnabled();
  const download=page.waitForEvent('download');await create.click();await download;await expect(dialog).not.toBeVisible();expect(f.bodies).toEqual(f.book.entries.slice(0,2).map(r=>r.id));f.bodies.length=0;
  await page.reload();await expect(page.getByRole('button',{name:'Open review',exact:true})).toHaveCount(1);await page.getByRole('button',{name:'Open review',exact:true}).click();await expect(dialog.locator('.review-readable')).toHaveCount(2);await dialog.getByRole('button',{name:'Close',exact:true}).click();expect(f.bodies).toEqual([]);
  await page.evaluate(id=>location.hash='#/records/'+id+'/read',f.book.entries[1].id);await expect(page.locator('.record-reader')).toContainText('Private take 1');await openRecordActions(page);await expect(page.getByRole('button',{name:'Witnessed by',exact:true})).toBeVisible();f.bodies.length=0;const beforeWitness=f.requests.length;
  await openRecordActions(page);await page.getByRole('button',{name:'Witnessed by',exact:true}).click();await expect(dialog).toContainText('Private take 1');await expect(dialog).not.toContainText('Changed after preview');expect(f.bodies).toEqual([]);
  await dialog.getByRole('button',{name:'Request review',exact:true}).click();await expect(dialog.locator('[name="scope"]')).toHaveValue('record:'+f.book.entries[1].id);await dialog.getByRole('button',{name:'Preview selection',exact:true}).click();await expect(dialog.locator('[data-review-plan] li')).toHaveCount(1);expect(f.bodies).toEqual([]);expect(f.requests.slice(beforeWitness).filter(r=>/^\/api\/workspace\/read\/(selection|page)$/.test(r.path))).toEqual([]);await expect(page.locator('.record-reader')).toContainText('Private take 1');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='20px');expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('reviews-phone.png')});
  expect(f.requests.filter(r=>r.path==='/api/workspace/read/page')).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
test('review browsing pages, retries, and direct routes keep archive bodies out of the client',async({page})=>{
 test.setTimeout(120000);const f=await fixture(page,42);
 try{
  for(let i=0;i<7;i++)await f.reviews.run('create',{workspaceId:f.book.id,id:randomUUID(),recipient:reviewHash(f.contact),message:'Request '+i,records:[{id:f.book.entries[0].id,revision:recordRevision(f.book.entries[0])}]});f.bodies.length=0;
  await page.route('**/api/reviews/list',route=>route.fulfill({status:503,json:{code:'DATABASE_UNAVAILABLE',message:'Synthetic list interruption'}}),{times:1});
  await page.goto(f.app.url);await expect(page.locator('.desk-desktop')).toBeVisible();await page.evaluate(()=>location.hash='#/modules/collaboration');await expect(page.locator('main [role="alert"]')).toContainText('PostgreSQL is unavailable.');await page.getByRole('button',{name:'Retry reviews',exact:true}).click();await expect(page.getByRole('button',{name:'Open review',exact:true})).toHaveCount(5);
  const next=page.getByRole('button',{name:'Next reviews',exact:true});await next.focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Open review',exact:true})).toHaveCount(2);await expect(page.getByRole('button',{name:'Previous reviews',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Previous reviews',exact:true}).click();await expect(page.getByRole('button',{name:'Open review',exact:true})).toHaveCount(5);
  await f.reviews.run('create',{workspaceId:f.book.id,id:randomUUID(),recipient:reviewHash(f.contact),message:'Concurrent request',records:[{id:f.book.entries[0].id,revision:recordRevision(f.book.entries[0])}]});f.bodies.length=0;
  await next.click();await expect(page.locator('#notice')).toContainText('The review list changed');await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.locator('main [role="status"]')).toContainText('1–5 of 8 reviews');
  expect(f.bodies).toEqual([]);expect(f.requests.filter(r=>r.path==='/api/workspace/read/page')).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
test('late review previews cannot select a different scope and a saved request survives refresh failure',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page,42);
 try{
  await page.goto(f.app.url);await expect(page.locator('.desk-desktop')).toBeVisible();await page.evaluate(()=>location.hash='#/modules/collaboration');await page.getByRole('button',{name:'Request review',exact:true}).click();
  const dialog=page.locator('#dialog'),scope=dialog.getByLabel('Send for review',{exact:true}),preview=dialog.getByRole('button',{name:'Preview selection',exact:true}),create=dialog.getByRole('button',{name:'Create encrypted request',exact:true});
  let release,arrived;const held=new Promise(resolve=>release=resolve),received=new Promise(resolve=>arrived=resolve);
  await page.route('**/api/reviews/plan',async route=>{const response=await route.fetch();arrived();await held;await route.fulfill({response}).catch(()=>{});},{times:1});
  await scope.selectOption('notebook:'+f.book.notebooks[0].id);await preview.click();await received;await scope.selectOption('notebook:'+f.book.notebooks[1].id);release();
  await expect(dialog.locator('[data-review-plan]')).toContainText('Preview the saved record titles');await expect(create).toBeDisabled();
  await scope.selectOption('notebook:'+f.book.notebooks[0].id);await preview.click();await expect(create).toBeEnabled();
  await page.route('**/api/reviews/list',route=>route.fulfill({status:503,json:{code:'DATABASE_UNAVAILABLE',message:'Refresh after saving failed'}}),{times:1});
  const download=page.waitForEvent('download');await create.click();await download;await expect(dialog).not.toBeVisible();await expect(page.locator('main [role="alert"]')).toContainText('PostgreSQL is unavailable.');
  await page.getByRole('button',{name:'Retry reviews',exact:true}).click();await expect(page.getByRole('button',{name:'Open review',exact:true})).toHaveCount(1);
  await page.evaluate(id=>location.hash='#/records/'+id,f.book.entries[0].id);await openRecordActions(page);await expect(page.getByRole('button',{name:'Witnessed by',exact:true})).toBeVisible();
  await openRecordActions(page);await page.getByRole('button',{name:'Witnessed by',exact:true}).click();await expect(dialog.getByRole('button',{name:'Open review',exact:true})).toHaveCount(1);
  expect(f.requests.filter(r=>r.path==='/api/reviews/create')).toHaveLength(1);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
