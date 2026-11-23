import {test,expect} from '@playwright/test';
import {completeRunCreation} from './run-creation-controls.js';
import {revealInEditor} from './record-editor-helper.js';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runFixture} from '../run-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';

// A saved record opens for reading, with its runs paged beneath it.
const readerTitle=page=>page.locator('.record-reader h1');
async function fixture(page){
 const data=runFixture(),directory=await mkdtemp(path.join(os.tmpdir(),'observanda-run-ui-')),f=await encryptedFixture(directory,data.book);
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 // The reader opens a record through bounded record-content reads; run pages have their own requests.
 const errors=[],fullReads=[],loaded=[],commands=[],contentReads=[],runReads=[],original=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=function(id,...args){loaded.push(id);return original.call(this,id,...args);};
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{
  if(request.url().endsWith('/api/notebook')||request.url().endsWith('/api/workspace/read/page'))fullReads.push(request.url());
  if(request.url().endsWith('/api/research/records/save'))commands.push(request.postDataJSON());
  if(request.url().endsWith('/api/workspace/read/record-content'))contentReads.push(request.postDataJSON().recordId);
  if(request.url().endsWith('/api/research/records/runs'))runReads.push(request.postDataJSON());
 });
 await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,data.parent.id);await expect(readerTitle(page)).toHaveText(data.parent.title,{timeout:15000});
 return {...f,...data,app,errors,fullReads,loaded,commands,contentReads,runReads,close:async()=>{ResearchCatalogue.prototype.record=original;await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}};
}
const area=page=>page.locator('[data-run-pages]');
// Run pages belong to the record's Activity and history area.
const showRuns=page=>revealInEditor(page,area(page),'Activity and history');

test('run pages compare pinned conditions, leave the record untouched, reuse collapsed details and work on narrow screens',async({page},testInfo)=>{
 test.setTimeout(90000);const f=await fixture(page);await showRuns(page);
 try{
  const runs=area(page);await expect(runs.locator('ol li')).toHaveCount(10);await expect(runs).toContainText('1–10 of 23');
  expect(new Set(f.contentReads)).toEqual(new Set([f.parent.id]));expect(f.loaded.every(id=>id===f.parent.id)).toBe(true);
  await runs.getByRole('button',{name:'Compare conditions and changes',exact:true}).click();
  const comparison=runs.getByRole('region',{name:'Run comparison',exact:true});await expect(comparison).toContainText('Light level 0');await expect(runs).toContainText('Acquisition interrupted');
  expect(new Set(f.contentReads)).toEqual(new Set([f.parent.id]));expect(f.loaded.every(id=>id===f.parent.id)).toBe(true);
  const reads=f.runReads.length;await runs.getByRole('button',{name:'Hide comparison',exact:true}).click();await runs.getByRole('button',{name:'Compare conditions and changes',exact:true}).click();
  await expect(comparison).toBeVisible();expect(f.runReads.length).toBe(reads);
  await runs.getByRole('button',{name:'Next runs',exact:true}).focus();await page.keyboard.press('Enter');await expect(runs.locator('[data-run-page-status]')).toBeFocused();await expect(runs).toContainText('11–20 of 23');await expect(comparison).toContainText('Light level 10');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.setProperty('--app-font-size','24px'));
  await comparison.evaluate(el=>el.scrollIntoView({block:'start'}));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await comparison.focus();await page.keyboard.press('ArrowRight');await expect.poll(()=>comparison.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
  await comparison.evaluate(el=>{el.scrollLeft=0;window.scrollBy(0,-110);});await page.screenshot({path:testInfo.outputPath('run-comparison-narrow.png')});
  await runs.getByRole('button',{name:'Next runs',exact:true}).click();await expect(runs).toContainText('21–23 of 23');await expect(runs.locator('tbody tr')).toHaveCount(3);
  await runs.getByRole('button',{name:'Previous runs',exact:true}).click();await expect(runs).toContainText('11–20 of 23');
  // Paging and comparing runs reads only run pages: the open record stays as it was and nothing is saved.
  await expect(readerTitle(page)).toHaveText(f.parent.title);expect(f.commands).toEqual([]);expect(f.fullReads).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('failed and malformed run pages retry and late responses cannot replace another record',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page);let release;await showRuns(page);
 try{
  const runs=area(page);await expect(runs).toContainText('1–10 of 23');
  await page.context().route('**/api/research/records/runs',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic page interruption'})}));
  await runs.getByRole('button',{name:'Next runs',exact:true}).click();await expect(runs.getByRole('alert')).toHaveText('Synthetic page interruption');
  await page.context().unroute('**/api/research/records/runs');await runs.getByRole('button',{name:'Retry runs',exact:true}).click();await expect(runs).toContainText('11–20 of 23');
  await page.context().route('**/api/research/records/runs',async route=>{const response=await route.fetch(),body=await response.json();body.runs[0].revision='bad';await route.fulfill({response,json:body});});
  await runs.getByRole('button',{name:'Compare conditions and changes',exact:true}).click();await expect(runs.getByRole('alert')).toContainText('response was incomplete');
  await page.context().unroute('**/api/research/records/runs');await runs.getByRole('button',{name:'Retry runs',exact:true}).click();await expect(runs.getByRole('region',{name:'Run comparison',exact:true})).toBeVisible();
  let ready;const started=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve);
  // The page request is held, then answered only after another record has opened. A request the page
  // has already abandoned cannot be answered, which is the same outcome for the record shown.
  await page.context().route('**/api/research/records/runs',async route=>{ready();await gate;try{await route.continue();}catch{}});
  await runs.getByRole('button',{name:'Next runs',exact:true}).click();await started;
  await page.evaluate(id=>location.hash='#/records/'+id,f.method.id);await expect(readerTitle(page)).toHaveText(f.method.title);
  release();await page.unrouteAll({behavior:'wait'});await expect(readerTitle(page)).toHaveText(f.method.title);await expect(area(page)).not.toContainText('21–23');
  expect(f.fullReads).toEqual([]);expect(f.errors).toEqual([]);
 }finally{release?.();await page.unrouteAll({behavior:'wait'});await f.close();}
});

test('new runs and successive repeats use selected documents without loading full records',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page);
 try{
  // Runs are added while editing the record, from its activity area.
  await (await revealInEditor(page,page.getByRole('button',{name:'Add run or take',exact:true}),'Activity and history')).click();
  const saved=[];
  for(let i=0;i<4;i++){
   saved.push(await completeRunCreation(page,'New take '+i,{edit:false}));await expect(page.locator('.record-reader')).toContainText('Planned');
   // A run offers its next take from its evidence area while it is being edited.
   if(i<3)await (await revealInEditor(page,page.getByRole('button',{name:'Create another run or take',exact:true}),'Evidence and results')).click();
  }
  expect(new Set(saved).size).toBe(4);expect(f.commands).toEqual([]);expect(f.fullReads).toEqual([]);expect(f.loaded.every(id=>id===f.parent.id)).toBe(true);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
