import {test,expect} from '@playwright/test';
import {completeRunCreation} from './run-creation-controls.js';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runFixture} from '../run-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';

async function fixture(page){
 const data=runFixture(),directory=await mkdtemp(path.join(os.tmpdir(),'observanda-run-ui-')),f=await encryptedFixture(directory,data.book);
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const errors=[],fullReads=[],loaded=[],commands=[],original=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=function(id,...args){loaded.push(id);return original.call(this,id,...args);};
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{
  if(request.url().endsWith('/api/notebook')||request.url().endsWith('/api/workspace/read/page'))fullReads.push(request.url());
  if(request.url().endsWith('/api/research/records/save'))commands.push(request.postDataJSON());
 });
 await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,data.parent.id);await expect(page.getByLabel('Record title',{exact:true})).toHaveValue(data.parent.title,{timeout:15000});
 return {...f,...data,app,errors,fullReads,loaded,commands,close:async()=>{ResearchCatalogue.prototype.record=original;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}};
}
const area=page=>page.locator('[data-run-pages]');

test('run pages compare pinned conditions, retain drafts, reuse collapsed details and work on narrow screens',async({page},testInfo)=>{
 test.setTimeout(90000);const f=await fixture(page);
 try{
  const runs=area(page);await expect(runs.locator('ol li')).toHaveCount(10);await expect(runs).toContainText('1–10 of 23');
  expect(new Set(f.loaded)).toEqual(new Set([f.parent.id]));
  await page.getByLabel('Record title',{exact:true}).fill('Unfinished interpretation');
  await runs.getByRole('button',{name:'Compare conditions and changes',exact:true}).click();
  const comparison=runs.getByRole('region',{name:'Run comparison',exact:true});await expect(comparison).toContainText('Light level 0');await expect(runs).toContainText('Acquisition interrupted');
  expect(new Set(f.loaded)).toEqual(new Set([f.parent.id]));
  const reads=f.loaded.length;await runs.getByRole('button',{name:'Hide comparison',exact:true}).click();await runs.getByRole('button',{name:'Compare conditions and changes',exact:true}).click();
  await expect(comparison).toBeVisible();expect(f.loaded.length).toBe(reads);
  await runs.getByRole('button',{name:'Next runs',exact:true}).focus();await page.keyboard.press('Enter');await expect(runs.locator('[data-run-page-status]')).toBeFocused();await expect(runs).toContainText('11–20 of 23');await expect(comparison).toContainText('Light level 10');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.setProperty('--app-font-size','24px'));
  await comparison.evaluate(el=>el.scrollIntoView({block:'start'}));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await comparison.focus();await page.keyboard.press('ArrowRight');await expect.poll(()=>comparison.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
  await comparison.evaluate(el=>{el.scrollLeft=0;window.scrollBy(0,-110);});await page.screenshot({path:testInfo.outputPath('run-comparison-narrow.png')});
  await runs.getByRole('button',{name:'Next runs',exact:true}).click();await expect(runs).toContainText('21–23 of 23');await expect(runs.locator('tbody tr')).toHaveCount(3);
  await runs.getByRole('button',{name:'Previous runs',exact:true}).click();await expect(runs).toContainText('11–20 of 23');
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Unfinished interpretation');await expect(page.locator('#save-status')).toHaveText('Unsaved changes');expect(f.fullReads).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('failed and malformed run pages retry and late responses cannot replace another record',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page);let release;
 try{
  const runs=area(page);await expect(runs).toContainText('1–10 of 23');
  await page.route('**/api/research/records/runs',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic page interruption'})}));
  await runs.getByRole('button',{name:'Next runs',exact:true}).click();await expect(runs.getByRole('alert')).toHaveText('Synthetic page interruption');
  await page.unroute('**/api/research/records/runs');await runs.getByRole('button',{name:'Retry runs',exact:true}).click();await expect(runs).toContainText('11–20 of 23');
  await page.route('**/api/research/records/runs',async route=>{const response=await route.fetch(),body=await response.json();body.runs[0].revision='bad';await route.fulfill({response,json:body});});
  await runs.getByRole('button',{name:'Compare conditions and changes',exact:true}).click();await expect(runs.getByRole('alert')).toContainText('response was incomplete');
  await page.unroute('**/api/research/records/runs');await runs.getByRole('button',{name:'Retry runs',exact:true}).click();await expect(runs.getByRole('region',{name:'Run comparison',exact:true})).toBeVisible();
  let ready;const started=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/research/records/runs',async route=>{const response=await route.fetch();ready();await gate;await route.fulfill({response});});
  await runs.getByRole('button',{name:'Next runs',exact:true}).click();await started;
  await page.evaluate(id=>location.hash='#/records/'+id,f.method.id);await expect(page.getByLabel('Record title',{exact:true})).toHaveValue(f.method.title);
  release();await page.unrouteAll({behavior:'wait'});await expect(page.getByLabel('Record title',{exact:true})).toHaveValue(f.method.title);await expect(area(page)).not.toContainText('21–23');
  expect(f.fullReads).toEqual([]);expect(f.errors).toEqual([]);
 }finally{release?.();await page.unrouteAll({behavior:'wait'});await f.close();}
});

test('new runs and successive repeats use selected documents without loading full records',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page);
 try{
  await page.getByRole('button',{name:'Add run or take',exact:true}).click();
  const saved=[];
  for(let i=0;i<4;i++){
   saved.push(await completeRunCreation(page,'New take '+i,{edit:false}));await expect(page.locator('.record-reader')).toContainText('planned');
   if(i<3)await page.getByRole('button',{name:'Create another run or take',exact:true}).click();
  }
  expect(new Set(saved).size).toBe(4);expect(f.commands).toEqual([]);expect(f.fullReads).toEqual([]);expect(f.loaded.every(id=>id===f.parent.id)).toBe(true);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
