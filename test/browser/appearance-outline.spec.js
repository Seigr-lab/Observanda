import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {writeWorkspaceDashboard,readWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {defaultFeed} from '../../src/web/website-feed-model.js';

async function fixture(page,count,{publicRecord=false,publicRecords=false,feeds=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-appearance-outline-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Private specimen '+i,body:'PRIVATE_ORIGINAL_'+i,share:false,sections:[],figures:[],attachments:[],relations:[]}));
 if(publicRecord)Object.assign(book.entries[0],{share:true,title:'Selected field observation',body:'Approved readable observation.'});
 if(publicRecords)for(const [index,record] of book.entries.entries())Object.assign(record,{share:true,title:'Published observation '+index,body:'Published body '+index});
 if(feeds)book.website.home.sections=[3,7].map((size,i)=>({id:'feed'+i,kind:'records',title:'Feed '+i,show:true,layout:'grid',feed:{...defaultFeed('records'),pageSize:size,visitorOrder:true,visitorFilters:true,visitorView:true}}));
 const {workspace:ws,vault,deviceStore}=await encryptedFixture(directory,book),settings=defaultDashboard();settings.views[0].panels=[];
 await writeWorkspaceDashboard(ws,settings,(await readWorkspaceDashboard(ws)).etag);
 const app=await startServer({root:ws.root,deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),requests=[],bodies=[],errors=[],original=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=function(id,...args){bodies.push(id);return original.call(this,id,...args);};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push({path:new URL(r.url()).pathname,data:r.postData()});});
 return {app,ws,book,bodies,requests,errors,async close(){ResearchCatalogue.prototype.record=original;await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true});}};
}
async function open(page,f){await page.goto(f.app.url);await expect(page.locator('.desk-desktop')).toBeVisible();await page.evaluate(()=>location.hash='#/preferences/appearance');}

test('appearance preview respects each feed count and filters without replacing neighbouring feeds',async({page})=>{
 test.setTimeout(120000);const f=await fixture(page,43,{publicRecords:true,feeds:true});
 try{
  await open(page,f);const frame=page.frameLocator('#design-preview'),feeds=frame.locator('[data-public-feed]'),first=feeds.first(),second=feeds.nth(1);
  await expect(first.locator('[data-feed-item]')).toHaveCount(3);await expect(second.locator('[data-feed-item]')).toHaveCount(7);
  const ids=feed=>feed.locator('[data-feed-item]').evaluateAll(nodes=>nodes.map(node=>node.dataset.feedId)),original=await ids(first),other=await ids(second);
  await first.getByRole('link',{name:'Next entries',exact:true}).click();await expect.poll(()=>ids(first)).not.toEqual(original);expect(await ids(second)).toEqual(other);
  await first.getByRole('link',{name:'Previous entries',exact:true}).click();await expect.poll(()=>ids(first)).toEqual(original);
  await first.getByLabel('Order',{exact:true}).selectOption('oldest');await expect(first).toHaveAttribute('aria-busy','false');expect(await ids(first)).not.toEqual(original);
  await first.getByLabel('Search this feed',{exact:true}).fill('Published observation 42');await first.getByRole('button',{name:'Apply filters',exact:true}).click();await expect(first.locator('[data-feed-item]')).toHaveCount(1);await expect(first.locator('[data-feed-item]')).toContainText('Published observation 42');expect(await ids(second)).toEqual(other);
  await first.getByLabel('Search this feed',{exact:true}).fill('No matching observation');await first.getByRole('button',{name:'Apply filters',exact:true}).click();await expect(first.locator('[data-feed-empty]')).toBeVisible();await expect(first.locator('[data-feed-item]')).toHaveCount(0);
  await first.getByRole('button',{name:'Clear filters',exact:true}).click();await expect.poll(()=>ids(first)).toEqual(original);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
test('large preview collections continue in place, preserve the page through theme edits and retry a failed next page',async({page})=>{
 test.setTimeout(120000);const f=await fixture(page,80,{publicRecords:true});
 try{
  await open(page,f);const frame=page.frameLocator('#design-preview');
  await expect(frame.locator('[data-collection-next]').first()).toBeVisible();
  await frame.locator('[data-collection-next]').first().click();await expect(frame.locator('[data-collection-previous]').first()).toBeVisible();
  await expect(page.getByLabel('Preview page',{exact:true})).toHaveValue(/collection=/);
  const selected=await page.getByLabel('Preview page',{exact:true}).inputValue(),titles=await frame.locator('.publication-card h2').allTextContents();
  await page.getByLabel('Accent',{exact:true}).fill('#334455');
  await expect(frame.locator('body')).toHaveCSS('--accent','#334455');
  await expect(page.getByLabel('Preview page',{exact:true})).toHaveValue(selected);
  await expect.poll(()=>frame.locator('.publication-card h2').allTextContents()).toEqual(titles);
  await page.route('**/appearance-preview/**',route=>route.request().isNavigationRequest()?route.fulfill({status:503,json:{message:'Synthetic interrupted card page'}}):route.continue(),{times:1});
  await frame.locator('[data-collection-next]').first().click();await expect(page.locator('#design-preview-note')).toHaveText('Synthetic interrupted card page');
  await page.getByRole('button',{name:'Retry preview',exact:true}).click();await expect(frame.locator('[data-collection-previous]').first()).toBeVisible();
  await expect.poll(()=>frame.locator('.publication-card h2').allTextContents()).not.toEqual(titles);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='20px');
  await expect(frame.locator('[data-collection-next]').first()).toBeVisible();
  await expect(frame.locator('body')).toHaveJSProperty('scrollWidth',await frame.locator('body').evaluate(node=>node.clientWidth));
  await page.locator('#design-preview').scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('continued-record-collection.png')});
  expect(await page.locator('#design-preview').getAttribute('sandbox')).toBe('allow-same-origin');expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
for(const count of [42,420])test('appearance saves themes and personal settings without loading '+count+' private bodies',async({page})=>{
 test.setTimeout(120000);const f=await fixture(page,count);
 try{
  await open(page,f);await expect(page.frameLocator('#design-preview').locator('.specimen-index')).toBeVisible();
  await page.locator('[data-action="theme-start"][data-theme="studio"]').click();
  await page.getByLabel('Accent',{exact:true}).fill('#334455');
  await page.getByRole('button',{name:'Save as new theme',exact:true}).click();await page.getByLabel('Theme name',{exact:true}).fill('Field design');
  await page.route('**/api/workspace/save',route=>route.fulfill({status:503,json:{code:'DATABASE_UNAVAILABLE',message:'Synthetic interrupted theme save'}}),{times:1});
  await page.getByRole('button',{name:'Save theme',exact:true}).click();await expect(page.locator('#notice')).toContainText('Synthetic interrupted theme save');
  await expect(page.getByLabel('Theme name',{exact:true})).toHaveValue('Field design');await page.getByRole('button',{name:'Save theme',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.getByLabel('App text size').fill('20');await page.getByLabel('Header alignment',{exact:true}).selectOption('right');
  await page.getByRole('button',{name:'Save appearance',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.reload();await expect(page.getByLabel('Accent',{exact:true})).toHaveValue('#334455');await expect(page.getByLabel('Saved theme',{exact:true}).locator('option')).toHaveCount(1);await expect(page.getByLabel('Header alignment',{exact:true})).toHaveValue('right');
  await page.getByLabel('Accent',{exact:true}).fill('#556677');await page.getByRole('button',{name:'Undo edits',exact:true}).click();await expect(page.getByLabel('Accent',{exact:true})).toHaveValue('#334455');
  await page.getByLabel('Accent',{exact:true}).fill('#778899');await page.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(page.getByLabel('Accent',{exact:true})).toHaveValue('#334455');
  await page.getByRole('button',{name:'Logos & branding',exact:true}).click();await expect(page.getByLabel('Branding scope',{exact:true})).toBeVisible();await page.goBack();await expect(page.getByLabel('Accent',{exact:true})).toHaveValue('#334455');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='20px');
  await page.getByRole('combobox',{name:'Body font',exact:true}).focus();await page.keyboard.press('Enter');await page.keyboard.type('DM Sans');await page.keyboard.press('Enter');await expect(page.getByRole('combobox',{name:'Body font',exact:true})).toContainText('DM Sans');
  await page.getByRole('button',{name:'Save appearance',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await expect(page.getByLabel('Preview page',{exact:true})).toBeEnabled();await expect(page.frameLocator('#design-preview').locator('.specimen-index')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('appearance-phone.png')});
  let selectedFont='dm-sans';
  if(count===42){
   await page.locator('[data-font-upload]').setInputFiles('src/fonts/dm-sans.ttf');await expect(page.locator('.custom-font-row')).toHaveCount(1);
   selectedFont=await page.locator('[data-font-sample]').getAttribute('data-font-sample');const label=await page.locator('.custom-font-row strong').textContent();
   await page.getByRole('combobox',{name:'Body font',exact:true}).click();await page.getByRole('option',{name:label+' Custom · Variable',exact:true}).click();
   await page.locator('[data-appearance-axes="font"] summary').click();await page.locator('[data-appearance-axis="font"][data-font-axis="wght"]').fill('475');
   await expect(page.frameLocator('#design-preview').locator('body')).toHaveCSS('font-family','"Observanda '+selectedFont+'", serif');
   await page.getByRole('button',{name:'Save appearance',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
   await page.reload();await expect(page.getByRole('combobox',{name:'Body font',exact:true})).toContainText(label);
  }
  expect(f.bodies).toEqual([]);expect(f.requests.filter(r=>r.path==='/api/workspace/read/page')).toEqual([]);
  const previews=f.requests.filter(r=>r.path==='/api/appearance-preview');expect(previews.length).toBeGreaterThan(0);for(const r of previews){expect(Object.keys(JSON.parse(r.data)).sort()).toEqual(['appearance','etag','mode','workspaceId']);expect(r.data.length).toBeLessThan(2000);}
  for(const r of f.requests.filter(r=>r.path==='/api/workspace/save')){const data=JSON.parse(r.data);expect(data.response).toBe('outline');expect(data.changes).toEqual([]);expect(data.removed).toEqual([]);}
  expect(f.errors).toEqual([]);const saved=(await f.ws.read()).book;expect(saved.entries).toEqual(f.book.entries);expect(saved.themes).toHaveLength(1);expect(saved.appearance.font).toBe(selectedFont);
 }finally{await f.close();}
});

test('appearance page choices continue without losing the selected page, and late-page links and styles load independently',async({page})=>{
 test.setTimeout(120000);const f=await fixture(page,100,{publicRecords:true});
 try{
  await open(page,f);await expect(page.frameLocator('#design-preview').locator('body')).toHaveAttribute('data-page','home');
  const choices=page.getByLabel('Preview page',{exact:true}),more=page.getByRole('button',{name:'More page choices',exact:true}),previous=page.getByRole('button',{name:'Previous page choices',exact:true});
  await expect(choices.locator('option')).toHaveCount(40);await expect(previous).toBeDisabled();
  await more.click();await expect(previous).toBeEnabled();await expect(choices).toHaveValue('index.html');expect(await choices.locator('option').count()).toBeLessThanOrEqual(41);
  const late=await choices.locator('option').last().getAttribute('value');await choices.selectOption(late);
  await expect(page.frameLocator('#design-preview').locator('body')).toHaveAttribute('data-page','entry:'+late.split('/')[1].slice(0,-5));
  await page.frameLocator('#design-preview').locator('[data-book-next]').click();
  const nextRecord=f.book.entries[f.book.entries.findIndex(r=>late.includes(r.id))+1];await expect(choices).toHaveValue('entries/'+nextRecord.id+'.html');
  await page.getByLabel('Accent',{exact:true}).fill('#773355');
  await expect(page.frameLocator('#design-preview').locator('html')).toHaveCSS('--accent','#773355');
  await expect(page.frameLocator('#design-preview').locator('.record-page')).toContainText(nextRecord.body);
  await expect(choices).toHaveValue('entries/'+nextRecord.id+'.html');
  await page.getByRole('button',{name:'Expand preview',exact:true}).click();
  await expect(page.frameLocator('.expanded-preview iframe').locator('.record-page')).toContainText(nextRecord.body);
  await page.getByRole('button',{name:'Close preview',exact:true}).click();await expect(page.frameLocator('#design-preview').locator('.record-page')).toContainText(nextRecord.body);
  await page.route('**/api/appearance-preview/*/pages?cursor=*',route=>route.fulfill({status:503,json:{message:'Synthetic interrupted page choices'}}),{times:1});
  await more.click();await expect(page.locator('#design-preview-note')).toHaveText('Synthetic interrupted page choices');
  await more.click();await expect(previous).toBeEnabled();await previous.click();await expect(previous).toBeDisabled();
  await page.frameLocator('#design-preview').locator('[data-book-back]').click();await expect(page.frameLocator('#design-preview').locator('[data-book-records] li')).toHaveCount(40);
  await page.frameLocator('#design-preview').locator('[data-browse-next]').click();await expect(page.frameLocator('#design-preview').locator('[data-browse-previous]')).toBeVisible();
  const middleRecord=f.book.entries[40];await expect(page.frameLocator('#design-preview').locator('[data-public-record]').first()).toHaveAttribute('data-public-record',middleRecord.id);
  await page.frameLocator('#design-preview').locator('[data-public-record]').first().getByRole('link').click();await expect(page.frameLocator('#design-preview').locator('.record-page')).toContainText(middleRecord.body);
  // A slow selector-label response must not make a subsequent style change
  // forget the page which is already visible in the frame.
  let releaseLabel,labelRequested=false;const heldLabel=new Promise(resolve=>releaseLabel=resolve);
  await page.route(/\/api\/appearance-preview\/[^/]+\/pages\?path=browse\.html%3F/,async route=>{const response=await route.fetch();labelRequested=true;await heldLabel;await route.fulfill({response}).catch(()=>{});},{times:1});
  try{
   await page.frameLocator('#design-preview').locator('[data-book-back]').click();await expect(page.frameLocator('#design-preview').locator('[data-public-record]').first()).toHaveAttribute('data-public-record',middleRecord.id);
   await expect.poll(()=>labelRequested).toBe(true);
   await page.getByLabel('Accent',{exact:true}).fill('#335577');await expect(page.frameLocator('#design-preview').locator('html')).toHaveCSS('--accent','#335577');
  }finally{releaseLabel();}
  await expect(page.frameLocator('#design-preview').locator('[data-public-record]').first()).toHaveAttribute('data-public-record',middleRecord.id);
  await page.frameLocator('#design-preview').getByLabel('Search public records',{exact:true}).fill(f.book.entries.at(-1).title);
  await page.frameLocator('#design-preview').getByRole('button',{name:'Apply filters',exact:true}).click();await expect(page.frameLocator('#design-preview').locator('[data-public-record]')).toHaveCount(1);
  await expect(page.frameLocator('#design-preview').locator('[data-public-record]')).toHaveAttribute('data-public-record',f.book.entries.at(-1).id);
  await page.frameLocator('#design-preview').getByRole('button',{name:'Clear filters',exact:true}).click();await expect(page.frameLocator('#design-preview').locator('[data-public-record]')).toHaveCount(40);
  await page.route('**/appearance-preview/*/browse.html?cursor=*',route=>route.fulfill({status:503,json:{message:'Synthetic interrupted browse page'}}),{times:1});
  await page.frameLocator('#design-preview').locator('[data-browse-next]').click();await expect(page.locator('#design-preview-note')).toHaveText('Synthetic interrupted browse page');
  await page.getByRole('button',{name:'Retry preview',exact:true}).click();await expect(page.frameLocator('#design-preview').locator('[data-public-record]').first()).toHaveAttribute('data-public-record',middleRecord.id);
  await page.getByRole('button',{name:'Expand preview',exact:true}).click();await expect(page.locator('.expanded-preview iframe')).toHaveAttribute('sandbox','allow-same-origin');
  await page.frameLocator('.expanded-preview iframe').getByLabel('Search public records',{exact:true}).fill(f.book.entries.at(-1).title);
  await page.frameLocator('.expanded-preview iframe').getByLabel('Search public records',{exact:true}).press('Enter');await expect(page.frameLocator('.expanded-preview iframe').locator('[data-public-record]')).toHaveCount(1);
  await page.getByRole('button',{name:'Close preview',exact:true}).click();await expect(page.frameLocator('#design-preview').locator('[data-public-record]').first()).toHaveAttribute('data-public-record',middleRecord.id);
  await expect(page.locator('#design-preview')).toHaveAttribute('sandbox','allow-same-origin');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='20px');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:test.info().outputPath('appearance-page-choices-phone.png')});
  expect(f.requests.filter(r=>r.path==='/api/workspace/read/page')).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('appearance previews retry, reject stale replies and show only selected website records',async({page})=>{
 test.setTimeout(120000);const f=await fixture(page,42,{publicRecord:true});
 try{
  await page.route('**/api/appearance-preview',route=>route.fulfill({status:503,json:{message:'Synthetic interrupted preview'}}),{times:1});await open(page,f);
  await expect(page.locator('#design-preview-note')).toHaveText('Synthetic interrupted preview');await expect(page.getByLabel('Preview page',{exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Retry preview',exact:true}).click();await expect(page.getByLabel('Preview content',{exact:true})).toHaveValue('website');
  await page.getByLabel('Preview page',{exact:true}).selectOption('entries/'+f.book.entries[0].id+'.html');await expect(page.frameLocator('#design-preview').locator('body')).toContainText('Approved readable observation.');await expect(page.frameLocator('#design-preview').locator('body')).not.toContainText('PRIVATE_ORIGINAL_');
  const url=new URL(await page.locator('#design-preview').getAttribute('src'),f.app.origin),designId=url.pathname.split('/')[2];
  expect((await fetch(url)).status).toBe(401);expect((await page.request.get(f.app.origin+'/api/export/'+designId)).status()).toBe(409);
  let release,arrived;const held=new Promise(r=>release=r),received=new Promise(r=>arrived=r);
  await page.route('**/api/appearance-preview',async route=>{const response=await route.fetch();arrived();await held;await route.fulfill({response}).catch(()=>{});},{times:1});
  await page.getByLabel('Preview content',{exact:true}).selectOption('examples');await received;
  await page.getByLabel('Preview content',{exact:true}).selectOption('website');await expect(page.getByLabel('Preview page',{exact:true})).toBeEnabled();release();
  await expect(page.getByLabel('Preview content',{exact:true})).toHaveValue('website');await expect(page.frameLocator('#design-preview').locator('.specimen-banner')).toHaveCount(0);
  await page.getByRole('button',{name:'General',exact:true}).click();await expect(page.locator('#design-preview')).toHaveCount(0);await page.goBack();await expect(page.getByLabel('Preview page',{exact:true})).toBeEnabled();
  expect(f.requests.filter(r=>r.path==='/api/workspace/read/page')).toEqual([]);expect(f.bodies.every(id=>id===f.book.entries[0].id)).toBe(true);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
