import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {writeWorkspaceDashboard,readWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {startServer} from '../../src/server.js';

async function fixture(page,count=42){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-discovery-ui-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Study '+i,body:'Private detailed notes '+i,sections:[],attachments:[],figures:[],relations:[],contributors:[{id:randomUUID(),name:'Artist '+i,role:'Performer'}]}));
 const f=await encryptedFixture(directory,book),settings=defaultDashboard();settings.views[0].panels=[];settings.shortcuts=[];
 await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),requests=[],bodies=[],errors=[];
 const original=ResearchCatalogue.prototype.record;ResearchCatalogue.prototype.record=function(id,...args){bodies.push(id);return original.call(this,id,...args);};
 page.on('request',request=>{if(request.url().includes('/api/workspace/read/')||request.url().includes('/dashboard-collection/'))requests.push({url:request.url(),data:request.postDataJSON()});});page.on('pageerror',error=>errors.push(error.message));
 await page.goto(app.url);await page.getByRole('button',{name:'+ Add cards',exact:true}).click();
 return {...f,book,app,requests,bodies,errors,close:async()=>{ResearchCatalogue.prototype.record=original;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}};
}
for(const count of [42,420])test('card search, paging, pinning and restoration stay scoped with '+count+' records',async({page},testInfo)=>{
 test.setTimeout(90000);const f=await fixture(page,count);
 try{
  const library=page.getByRole('region',{name:'Data library',exact:true});await expect(library.locator('.desk-library-item')).toHaveCount(12);
  await library.getByRole('combobox',{name:'Show',exact:true}).selectOption('contributors');await expect(library.locator('[data-discovery-page]')).toHaveText('1–12 of '+(count+1));
  expect(f.bodies).toEqual([]);
  await library.getByRole('button',{name:'Next',exact:true}).click();await expect(library.locator('[data-discovery-page]')).toHaveText('13–24 of '+(count+1));await expect(library.locator('[data-discovery-page]')).toBeFocused();
  const second=await library.locator('strong').allTextContents();await library.getByRole('button',{name:'Next',exact:true}).click();await library.getByRole('button',{name:'Previous',exact:true}).click();await expect(library.locator('strong')).toHaveText(second);
  await library.getByRole('searchbox',{name:'Find data to display',exact:true}).fill('Artist '+(count-1));await expect(library.locator('.desk-library-item')).toHaveCount(1);await expect(library.getByRole('combobox',{name:'Show'})).toHaveValue('contributors');
  if(count===42){await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.setProperty('--app-font-size','24px'));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:testInfo.outputPath('card-library-narrow.png')});}
  expect(f.bodies).toEqual([]);await library.getByRole('button',{name:'Pin Artist '+(count-1),exact:true}).click();
  await library.locator('[data-action="dashboard-add"]').click();const card=page.locator('.desk-card');await expect(card).toContainText('Artist '+(count-1));
  expect(f.bodies.every(id=>id===f.book.entries.at(-1).id)).toBe(true);
  await card.locator('[data-action="dashboard-close"]').click();await page.getByRole('button',{name:'Restore cards',exact:true}).click();await library.locator('[data-action="dashboard-add"]').click();await expect(card).toContainText('Artist '+(count-1));
  expect(f.requests.filter(r=>r.url.endsWith('/page'))).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
test('website counts can be pinned and reopened without promoting the dashboard to all record bodies',async({page})=>{
 test.setTimeout(60000);
 const f=await fixture(page,420);
 try{
  const library=page.getByRole('region',{name:'Data library',exact:true});
  await library.getByRole('combobox',{name:'Show',exact:true}).selectOption('website');
  await library.getByRole('button',{name:'Pin Website content',exact:true}).click();
  await library.locator('[data-action="dashboard-add"][data-label="Website content"]').click();
  const card=page.locator('.desk-card');await expect(card).toContainText('Website content');await expect(card).toContainText(String(f.book.entries.filter(e=>e.share).length));
  expect(f.bodies).toEqual([]);await expect(page.locator('#desk-save-state')).toHaveText('');await page.reload();await expect(card).toContainText('Website content');await expect(card).toContainText(String(f.book.entries.filter(e=>e.share).length));
  expect(f.requests.filter(r=>r.url.endsWith('/page'))).toEqual([]);expect(f.bodies).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
test('card discovery retries failed or malformed pages and cancels obsolete searches',async({page})=>{
 test.setTimeout(60000);const f=await fixture(page);let release;
 try{
  const library=page.getByRole('region',{name:'Data library'});await expect(library.locator('.desk-library-item')).toHaveCount(12);
  await library.getByRole('combobox',{name:'Show'}).selectOption('contributors');await expect(library.locator('[data-discovery-page]')).toHaveText('1–12 of 43');
  await page.route('**/api/projects/dashboard-collection/discovery',route=>route.fulfill({status:503,json:{message:'Synthetic discovery interruption'}}));
  await library.getByRole('searchbox',{name:'Find data to display'}).fill('Artist');await expect(library.getByRole('alert')).toContainText('Synthetic discovery interruption');
  await page.unrouteAll({behavior:'wait'});await library.getByRole('button',{name:'Retry card search'}).click();await expect(library.locator('.desk-library-item')).toHaveCount(12);
  await page.route('**/api/projects/dashboard-collection/discovery',route=>{const command=route.request().postDataJSON();return route.fulfill({json:{...command,items:[{key:'bad'}],total:1}});});
  await library.getByRole('searchbox',{name:'Find data to display'}).fill('Artist 0');await expect(library.getByRole('alert')).toContainText('response was incomplete');
  await page.unrouteAll({behavior:'wait'});await library.getByRole('button',{name:'Retry card search'}).click();await expect(library.locator('.desk-library-item')).toHaveCount(5);
  let ready;const started=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/projects/dashboard-collection/discovery',async route=>{const response=await route.fetch();ready();await gate;await route.fulfill({response});});
  await library.getByRole('searchbox',{name:'Find data to display'}).fill('Study');await started;await library.getByRole('button',{name:'Close data library'}).click();release();await page.unrouteAll({behavior:'wait'});
  await expect(library).toHaveCount(0);expect(f.requests.filter(r=>r.url.endsWith('/page'))).toEqual([]);expect(f.errors).toEqual([]);
 }finally{release?.();await page.unrouteAll({behavior:'wait'});await f.close();}
});
