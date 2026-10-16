import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ImportStore} from '../../src/migration/import-store.js';

test('reader provenance pages retry, cancel and ignore abandoned responses without loading the record editor',async({page})=>{
 test.setTimeout(120000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-provenance-ui-')),book=sampleNotebook(),record=book.entries[2];record.sections=Array.from({length:67},(_,i)=>({id:randomUUID(),title:'Observation '+i,body:'Unselected research '.repeat(70)}));
 const f=await encryptedFixture(directory,book),store=new ImportStore(f.workspace),batchId=randomUUID();
 await store.locked(async()=>{
  await store.write('batches/'+batchId,{version:1,id:batchId,workspaceId:book.id,state:'committed',createdAt:new Date().toISOString(),receipt:null});
  for(let i=0;i<21;i++){
   await store.putObject(batchId,i,{source:{title:'Source '+i,dates:[{meaning:'Observation',value:'2026-10-01'}],files:[]},mapping:{contentFile:0}});
   await store.write('record-sources/'+record.id+'/'+String(i).padStart(5,'0'),{batchId,index:i,namespace:'synthetic:observations',sourceId:'observation-'+i,sourceRevision:'1'});
  }
 });
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),original=ResearchCatalogue.prototype.record,errors=[],requests=[];let release;
 ResearchCatalogue.prototype.record=()=>{throw Error('Provenance inspected a full record');};page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));
 const dialog=page.getByRole('dialog',{name:'Source provenance',exact:true}),open=()=>page.getByRole('button',{name:'Source provenance',exact:true}).click(),next=()=>dialog.getByRole('button',{name:'Next sources',exact:true}).click(),previous=()=>dialog.getByRole('button',{name:'Previous sources',exact:true}).click();
 const defer=async()=>{let ready;const started=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve);await page.route('**/api/migration/import/provenance',async route=>{const response=await route.fetch();ready();await gate;await route.fulfill({response}).catch(()=>{});},{times:1});return {started,release:()=>release()};};
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');await open();await expect(dialog.locator('[data-provenance-content] > section')).toHaveCount(20);await expect(dialog.getByRole('heading',{name:'Source 19',exact:true})).toBeVisible();await expect(page.locator('.record-reader')).toContainText(record.title);
  await page.route('**/api/migration/import/provenance',route=>route.abort('failed'),{times:1});await next();await expect(dialog.getByRole('button',{name:'Retry loading sources',exact:true})).toBeFocused();await expect(dialog.locator('[data-provenance-content] > section')).toHaveCount(20);
  await dialog.getByRole('button',{name:'Retry loading sources',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Source 20',exact:true})).toBeVisible();await expect(dialog.locator('[data-provenance-content] > section')).toHaveCount(1);
  await page.route('**/api/migration/import/provenance',route=>route.fulfill({json:{items:[],next:7}}),{times:1});await previous();await expect(dialog.getByRole('alert')).toContainText('response was incomplete');await expect(dialog.getByRole('heading',{name:'Source 20',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Retry loading sources',exact:true}).click();await expect(dialog.locator('[data-provenance-content] > section')).toHaveCount(20);await expect(dialog.getByRole('button',{name:'Previous sources',exact:true})).toBeDisabled();
  const cancelled=await defer();await next();await cancelled.started;await dialog.getByRole('button',{name:'Cancel loading',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Loading cancelled');cancelled.release();await expect(dialog.locator('[data-provenance-content] > section')).toHaveCount(20);await dialog.getByRole('button',{name:'Retry loading sources',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Source 20',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('reader-provenance-mobile.png')});await previous();await expect(dialog.locator('[data-provenance-content] > section')).toHaveCount(20);
  const moved=await defer();await next();await moved.started;await page.evaluate(id=>location.hash='#/records/'+id+'/read',book.entries[0].id);await expect(dialog).not.toBeVisible();moved.release();await expect(page.locator('.record-reader')).toContainText(book.entries[0].title);
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>document.documentElement.style.fontSize='');const closed=await defer();await open();await closed.started;await dialog.getByRole('button',{name:'Close',exact:true}).click();closed.release();await expect(dialog).not.toBeVisible();await page.unrouteAll({behavior:'wait'});
  await open();await expect(dialog).toContainText('This record has no external import provenance.');await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Witnessed by',exact:true}).click();await expect(page.getByRole('dialog',{name:'Witnessed by',exact:true})).toContainText('No reviews yet.');await expect(page.locator('.record-reader')).toContainText(book.entries[0].title);
  expect(requests.filter(route=>/^\/api\/workspace\/read\/(selection|page)$/.test(route))).toEqual([]);expect(errors).toEqual([]);
 }finally{release?.();await page.unrouteAll({behavior:'wait'});ResearchCatalogue.prototype.record=original;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
