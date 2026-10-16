import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';

test('an already-open compatibility editor receives bounded saved updates and retries only its interrupted page',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-updates-ui-')),book=sampleNotebook(),seed=book.entries[2];
 book.entries=Array.from({length:65},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Take '+i,body:'Private source '+i,sections:[],figures:[],attachments:[],relations:[],contributors:[]}));
 book.formatVersion=20;
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));
 const read=ResearchCatalogue.prototype.read;
 try{
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Take 0');
  await page.getByLabel('Record title',{exact:true}).fill('Local authored change');
  const base=await f.workspace.read(),changed=upgradeNotebook(base.book);
  changed.entries.slice(1).forEach((record,i)=>record.title='Other window '+i);
  await f.workspace.save(changed,base.etag);
  ResearchCatalogue.prototype.read=()=>{throw Error('Whole workspace read during update');};
  let fail=true;
  await page.route('**/api/workspace/read/change-page',async route=>{
   requests.push(route.request().postDataJSON());
   const response=await route.fetch();
   if(requests.length===2&&fail){fail=false;await route.fulfill({status:503,json:{code:'IO',message:'Synthetic lost page reply'}});}
   else await route.fulfill({response});
  });
  await page.getByRole('button',{name:'Save record',exact:true}).click();
  const loading=page.getByRole('dialog',{name:'Updating saved records',exact:true});
  await expect(loading.getByRole('button',{name:'Retry loading',exact:true})).toBeFocused();
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Local authored change');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='24px');
  expect(await loading.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.keyboard.press('Enter');await expect(loading).not.toBeVisible();await expect(page.locator('#save-status')).toHaveText('Saved');
  expect(requests[1].cursor).toBe(requests[2].cursor);expect(requests.filter(r=>r.cursor===requests[0].cursor)).toHaveLength(1);
  expect(errors).toEqual([]);
  ResearchCatalogue.prototype.read=read;
  const saved=await f.workspace.read();expect(saved.book.entries[0].title).toBe('Local authored change');expect(saved.book.entries[64].title).toBe('Other window 63');
 }finally{ResearchCatalogue.prototype.read=read;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
