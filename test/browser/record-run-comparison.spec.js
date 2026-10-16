import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runComparisonFixture} from '../run-comparison-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';

test('run comparison details navigate independently, preserve visible values on failure and ignore abandoned responses',async({page},info)=>{
 test.setTimeout(120000);const data=runComparisonFixture(),directory=await mkdtemp(path.join(os.tmpdir(),'observanda-comparison-ui-')),f=await encryptedFixture(directory,data.book),original=ResearchCatalogue.prototype.record;
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(new URL(request.url()).pathname));let release;
 ResearchCatalogue.prototype.record=()=>{throw Error('Comparison UI assembled a record');};
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+data.parent.id);const area=page.locator('[data-run-pages]');
  await expect(page.getByRole('navigation',{name:'Record editing areas',exact:true})).toBeVisible();
  await area.getByRole('button',{name:'Compare conditions and changes',exact:true}).click();await expect(area.getByRole('region',{name:'Run comparison',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Read record',exact:true}).click();await area.getByRole('button',{name:'Hide comparison',exact:true}).click();
  await area.getByRole('button',{name:'Compare conditions and changes',exact:true}).click();const row=area.locator('[data-run-comparison-row="'+data.runs[0].id+'"]'),events=row.locator('[data-run-detail="events"]'),assessments=row.locator('[data-run-detail="assessments"]'),methods=row.locator('[data-run-detail="methods"]');
  await expect(events).toContainText('1–4 of 11');await expect(row).toContainText('Observation 1');await expect(row).not.toContainText('Reviewed observation zero');
  let failed=false;await page.route('**/api/research/records/runs/comparison',async route=>{if(!failed){failed=true;await route.abort('failed');return;}await route.continue();});
  await events.getByRole('button',{name:'Next items',exact:true}).click();await expect(row.getByRole('button',{name:'Retry comparison details',exact:true})).toBeFocused();await expect(events).toContainText('1–4 of 11');
  await row.getByRole('button',{name:'Retry comparison details',exact:true}).click();await expect(events.locator('[data-detail-status]')).toBeFocused();await expect(events).toContainText('5–8 of 11');await expect(assessments).toContainText('1–4 of 11');await expect(methods).toContainText('1–4 of 11');
  await events.getByRole('spinbutton',{name:'Go to item',exact:true}).fill('9');await events.getByRole('button',{name:'Go',exact:true}).click();await expect(events).toContainText('9–11 of 11');await expect(row).toContainText('Reviewed acquisition zero');
  await assessments.getByRole('spinbutton',{name:'Go to item',exact:true}).fill('9');await assessments.getByRole('button',{name:'Go',exact:true}).click();await expect(row).toContainText('Reviewed observation zero');await expect(events).toContainText('9–11 of 11');
  await methods.getByRole('spinbutton',{name:'Go to item',exact:true}).fill('9');await methods.getByRole('button',{name:'Go',exact:true}).click();await expect(row).toContainText('Method context 10');await expect(methods).toContainText('9–11 of 11');
  await page.unroute('**/api/research/records/runs/comparison');await page.route('**/api/research/records/runs/comparison',async route=>{const response=await route.fetch(),body=await response.json();body.conditions.windows.methods.count++;await route.fulfill({response,json:body});});
  await methods.getByRole('button',{name:'Previous items',exact:true}).click();await expect(row.getByRole('alert')).toContainText('response was incomplete');await expect(methods).toContainText('9–11 of 11');await page.unroute('**/api/research/records/runs/comparison');await row.getByRole('button',{name:'Retry comparison details',exact:true}).click();await expect(methods).toContainText('5–8 of 11');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');const table=area.getByRole('region',{name:'Run comparison',exact:true});await events.evaluate(el=>el.scrollIntoView({block:'center'}));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('comparison-detail-navigation-mobile.png')});
  await table.focus();await page.keyboard.press('ArrowLeft');
  let ready;const started=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve);await page.route('**/api/research/records/runs/comparison',async route=>{const response=await route.fetch();ready();await gate;await route.fulfill({response});});
  await events.getByRole('button',{name:'Previous items',exact:true}).click();await started;await page.evaluate(id=>location.hash='#/records/'+id+'/read',data.method.id);await expect(page.locator('.record-reader')).toContainText(data.method.title);release();await page.unrouteAll({behavior:'wait'});await expect(page.locator('.record-reader')).toContainText(data.method.title);await expect(page.locator('[data-run-comparison-row]')).toHaveCount(0);expect(errors).toEqual([]);
  expect(requests.filter(route=>/^\/api\/workspace\/read\/(selection|page)$/.test(route)||route==='/api/research/records/save')).toEqual([]);
 }finally{release?.();await page.unrouteAll({behavior:'wait'});ResearchCatalogue.prototype.record=original;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
