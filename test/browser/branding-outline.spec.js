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

async function fixture(page,count){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-branding-outline-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Private take '+String(i).padStart(3,'0'),body:'Original material '+i,share:false,sections:[],figures:[],attachments:[],relations:[]}));
 const {workspace:ws,vault,deviceStore}=await encryptedFixture(directory,book),settings=defaultDashboard();settings.views[0].panels=[];
 await writeWorkspaceDashboard(ws,settings,(await readWorkspaceDashboard(ws)).etag);
 const app=await startServer({root:ws.root,deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),requests=[],bodies=[],errors=[],original=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=function(id,...args){bodies.push(id);return original.call(this,id,...args);};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push({path:new URL(r.url()).pathname,data:r.postData()});});
 return {app,ws,book,bodies,requests,errors,async close(){ResearchCatalogue.prototype.record=original;await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true});}};
}
const svg={name:'mark.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="teal"/></svg>')};
for(const count of [42,420])test('branding searches scopes and saves without loading '+count+' record bodies',async({page})=>{
 test.setTimeout(120000);const f=await fixture(page,count);
 try{
  await page.goto(f.app.url);await expect(page.locator('.desk-desktop')).toBeVisible();await page.evaluate(()=>location.hash='#/branding/home');
  const scope=page.getByLabel('Branding scope',{exact:true});await expect(scope).toHaveValue('home');
  await scope.selectOption('record-picker');const dialog=page.locator('#dialog');
  await expect(dialog.locator('[data-action="research-target-choose"]')).toHaveCount(25);
  await expect(dialog.locator('[data-target-status]')).toHaveText('1–25 of '+count);
  await dialog.getByRole('button',{name:'Next results',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(dialog.locator('[data-target-status]')).toHaveText('26–'+Math.min(50,count)+' of '+count);await expect(dialog.locator('[data-action="research-target-choose"]').first()).toBeFocused();
  await dialog.getByRole('button',{name:'Previous results',exact:true}).click();await expect(dialog.locator('[data-target-status]')).toHaveText('1–25 of '+count);
  const selected=f.book.entries.at(-1);await dialog.getByLabel('Find in this workspace',{exact:true}).fill(selected.title);
  await expect(dialog.locator('[data-action="research-target-choose"]')).toHaveCount(1);await dialog.locator('[data-action="research-target-choose"]').click();
  await expect(scope.locator('option:checked')).toHaveText('Record: '+selected.title);await expect(page.getByLabel('Add logo',{exact:true})).toBeEnabled();
  expect(await scope.locator('option').count()).toBeLessThan(10);
  await page.getByLabel('Add logo',{exact:true}).setInputFiles(svg);await expect(page.getByLabel('Logo 1 alternative text')).toBeVisible({timeout:20000});
  await page.getByLabel('Logo 1 alternative text').fill('A private record mark');
  await page.route('**/api/workspace/save',route=>route.fulfill({status:503,json:{code:'DATABASE_UNAVAILABLE',message:'Synthetic branding interruption'}}),{times:1});
  await page.getByRole('button',{name:'Save branding',exact:true}).click();await expect(page.locator('#notice')).toContainText('Synthetic branding interruption');await expect(page.getByLabel('Logo 1 alternative text')).toHaveValue('A private record mark');
  await page.getByRole('button',{name:'Save branding',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.reload();await expect(scope.locator('option:checked')).toHaveText('Record: '+selected.title);await expect(page.getByLabel('Logo 1 alternative text')).toHaveValue('A private record mark');
  await page.getByLabel('Logo 1 alternative text').fill('Discard this');await scope.selectOption('home');await expect(page.locator('#leave-dialog')).toBeVisible();
  await page.locator('#leave-dialog').getByRole('button',{name:'Stay here',exact:true}).click();await expect(scope).toHaveValue('entry:'+selected.id);await expect(page.getByLabel('Logo 1 alternative text')).toHaveValue('Discard this');
  await scope.selectOption('home');await page.locator('#leave-dialog').getByRole('button',{name:'Discard changes',exact:true}).click();await expect(scope).toHaveValue('home');
  await page.goBack();await expect(scope.locator('option:checked')).toHaveText('Record: '+selected.title);await expect(page.getByLabel('Logo 1 alternative text')).toHaveValue('A private record mark');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='20px');await scope.selectOption('record-picker');
  await expect(dialog.locator('[data-action="research-target-choose"]')).toHaveCount(25);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('branding-phone.png')});await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(f.bodies).toEqual([]);expect(f.requests.filter(r=>r.path==='/api/workspace/read/page')).toEqual([]);
  const writes=f.requests.filter(r=>r.path==='/api/workspace/save').map(r=>JSON.parse(r.data));expect(writes).toHaveLength(2);for(const command of writes){expect(command.response).toBe('outline');expect(command.changes).toEqual([]);expect(command.removed).toEqual([]);expect(Object.keys(command.metadata)).toEqual(['branding']);}
  expect(f.errors).toEqual([]);const saved=(await f.ws.read()).book;expect(saved.entries).toEqual(f.book.entries);expect(saved.branding).toHaveLength(1);expect(saved.branding[0].target).toBe('entry:'+selected.id);expect(saved.branding[0].logos[0].alt).toBe('A private record mark');
 }finally{await f.close();}
});

test('record branding retries failed names, rejects missing targets and ignores late responses after navigation',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page,42);
 try{
  await page.goto(f.app.url);await expect(page.locator('.desk-desktop')).toBeVisible();
  await page.route('**/api/workspace/read/labels',route=>route.fulfill({status:503,json:{code:'DATABASE_UNAVAILABLE',message:'Synthetic name interruption'}}),{times:1});
  await page.evaluate(id=>location.hash='#/branding/'+encodeURIComponent('entry:'+id),f.book.entries[0].id);
  await expect(page.locator('main [role="alert"]')).toHaveText('Synthetic name interruption');await expect(page.getByLabel('Add logo',{exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Retry record name',exact:true}).click();await expect(page.getByLabel('Branding scope').locator('option:checked')).toHaveText('Record: '+f.book.entries[0].title);await expect(page.getByLabel('Add logo',{exact:true})).toBeEnabled();
  let release,arrived;const held=new Promise(resolve=>release=resolve),received=new Promise(resolve=>arrived=resolve);
  await page.route('**/api/workspace/read/labels',async route=>{const response=await route.fetch();arrived();await held;await route.fulfill({response}).catch(()=>{});},{times:1});
  await page.evaluate(id=>location.hash='#/branding/'+encodeURIComponent('entry:'+id),f.book.entries[1].id);await received;
  await page.getByLabel('Branding scope').selectOption('home');release();await expect(page.getByLabel('Branding scope')).toHaveValue('home');await expect(page.getByLabel('Add logo',{exact:true})).toBeEnabled();
  await page.evaluate(id=>location.hash='#/branding/'+encodeURIComponent('entry:'+id),randomUUID());
  await expect(page.locator('main [role="alert"]')).toHaveText('This record is unavailable. Choose another branding scope.');await expect(page.getByLabel('Add logo',{exact:true})).toBeDisabled();
  await page.getByLabel('Branding scope').selectOption('home');expect(f.bodies).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
