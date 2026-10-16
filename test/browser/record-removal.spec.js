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
import {RecordValues} from '../../src/record-values.js';

test('reader removal pins the reviewed revision, recovers uncertain replies and preserves history',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(10000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-removal-ui-')),book=sampleNotebook(),record=book.entries[0];
 record.sections=Array.from({length:67},(_,i)=>({id:randomUUID(),title:'Observation '+i,body:'Original observation '.repeat(80)}));
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),original=ResearchCatalogue.prototype.record,errors=[],reads=[],commands=[];
 ResearchCatalogue.prototype.record=()=>{throw Error('Reader removal reconstructed an original');};page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{const route=new URL(r.url()).pathname;if(/^\/api\/workspace\/read\/(selection|page)$/.test(route))reads.push(route);if(route==='/api/research/records/remove')commands.push(r.postDataJSON());});
 const dialog=page.getByRole('dialog',{name:'Remove record',exact:true}),open=()=>page.locator('.record-reader').getByRole('button',{name:'Remove record',exact:true}).click(),remove=()=>dialog.getByRole('button',{name:'Remove record',exact:true}).click();let release;
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');await expect(page.locator('.record-reader h1')).toHaveText(record.title);
  await open();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(commands).toEqual([]);
  await open();const values=new RecordValues(f.workspace),target={workspaceId:book.id,recordId:record.id,field:'title'},base=await values.read(target);await values.save({...target,expectedRevision:base.revision,value:{value:'Revised source observation'}});
  const retained=(await f.workspace.outline()).etag;
  await remove();await expect(dialog.getByRole('alert')).toContainText('changed in another window');await expect(dialog.getByRole('button',{name:'Remove record',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'Refresh record',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.locator('.record-reader h1')).toHaveText('Revised source observation');
  await open();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('record-removal-phone.png')});
  await page.route('**/api/research/records/remove',route=>route.fulfill({json:{}}),{times:1});await remove();await expect(dialog.getByRole('button',{name:'Retry this removal',exact:true})).toBeEnabled();const command=commands.at(-1);
  await page.route('**/api/research/records/remove',async route=>{await route.fetch();await route.abort('failed');},{times:1});await dialog.getByRole('button',{name:'Retry this removal',exact:true}).click();await expect(dialog.getByRole('button',{name:'Retry this removal',exact:true})).toBeEnabled();expect(commands.at(-1)).toEqual(command);
  await expect(dialog.getByRole('status').first()).toContainText('does not cancel');await dialog.getByRole('button',{name:'Close',exact:true}).click();await open();await dialog.getByRole('button',{name:'Retry this removal',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.locator('.record-reader')).toHaveCount(0);expect(commands.at(-1)).toEqual(command);
  expect(await f.workspace.catalogue(async store=>store.member(await store.snapshot(),record.id))).toBeNull();
  ResearchCatalogue.prototype.record=original;
  const prior=await f.workspace.catalogue(store=>store.recordSelection([record.id],{snapshotId:retained}));expect(prior.book.entries[0].sections).toEqual(record.sections);expect(prior.book.entries[0].title).toBe('Revised source observation');
  ResearchCatalogue.prototype.record=()=>{throw Error('Reader removal reconstructed an original');};
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>document.documentElement.style.fontSize='');await page.goto(app.origin+'/#/records/'+book.entries[1].id+'/read');await expect(page.locator('.record-reader h1')).toHaveText(book.entries[1].title);await open();
  let ready;const started=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve);await page.route('**/api/research/records/remove',async route=>{const response=await route.fetch();ready();await gate;await route.fulfill({response}).catch(()=>{});},{times:1});await remove();await started;
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.goto(app.origin+'/#/records/'+book.entries[2].id+'/read');release();await page.unrouteAll({behavior:'wait'});await expect(dialog).not.toBeVisible();await expect(page.locator('.record-reader h1')).toHaveText(book.entries[2].title);
  expect(reads).toEqual([]);expect(errors).toEqual([]);
 }finally{release?.();await page.unrouteAll({behavior:'wait'});ResearchCatalogue.prototype.record=original;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
