import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {sampleNotebook} from '../../src/sample.js';
import {testServer} from '../device-fixture.js';
import {RecordValues} from '../../src/record-values.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';

test('reader history pages and restores a saved document without entering the full editor',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-history-reader-')),book=sampleNotebook(),record=book.entries[0];
 record.sections=Array.from({length:70},(_,i)=>({id:randomUUID(),title:'Retained section '+i,body:'Exact writing '+i}));
 record.contributors=Array.from({length:11},(_,i)=>({id:randomUUID(),name:'Observer '+i,role:'Acquisition'}));
 const f=await encryptedFixture(directory,book),values=new RecordValues(f.workspace),target={workspaceId:book.id,recordId:record.id,field:'title'},base=await values.read(target);
 await values.save({...target,expectedRevision:base.revision,value:{value:'Current saved title'}});
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),read=ResearchCatalogue.prototype.record,errors=[],requests=[];
 ResearchCatalogue.prototype.record=()=>{throw Error('Reader history reconstructed a complete record');};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);});
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');
  await page.getByRole('button',{name:'History',exact:true}).click();const dialog=page.locator('#dialog');
  await dialog.getByRole('button',{name:'Review version',exact:true}).click();await expect(dialog).toContainText('Changed since this version: Title.');
  let nav=dialog.getByRole('navigation',{name:'Version content navigation',exact:true});
  await nav.getByLabel('Go to item',{exact:true}).fill('69');await nav.getByRole('button',{name:'Go',exact:true}).click();await expect(dialog).toContainText('Exact writing 69');await expect(dialog).not.toContainText('Exact writing 0');
  await dialog.getByText('Compare with current saved version',{exact:true}).click();await expect(dialog.locator('[data-history-compare]')).toHaveAttribute('open','');
  await nav.getByRole('combobox',{name:'Browse content',exact:true}).selectOption('contributors');await nav.getByRole('button',{name:'Next items',exact:true}).click();await expect(nav).toContainText('Items 5–8 of 11');await expect(dialog.locator('[data-history-compare]')).toHaveAttribute('open','');
  const clipping=await dialog.locator('clipPath').evaluateAll(nodes=>nodes.map(n=>n.id));expect(new Set(clipping).size).toBe(clipping.length);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await dialog.getByRole('button',{name:'Restore this version',exact:true}).click();
  const refreshed=page.waitForResponse(async response=>new URL(response.url()).pathname==='/api/workspace/read/record-content'&&response.ok()&&(await response.json()).header?.title===record.title);
  await dialog.getByRole('button',{name:'Restore record',exact:true}).click();await expect(dialog).not.toBeVisible();await refreshed;
  await expect(page.locator('.record-reader h1')).toHaveText(record.title);expect((await values.read(target)).value.value).toBe(record.title);
  expect(requests.filter(route=>/^\/api\/workspace\/read\/(selection|page)$/.test(route)||route==='/api/research/records/save')).toEqual([]);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=read;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
