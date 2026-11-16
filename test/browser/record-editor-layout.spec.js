import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {test,expect} from '@playwright/test';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {startServer} from '../../src/server.js';

test('the record editor keeps the writing in the centre and its properties beside it, stacked on a phone',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(15000);await page.setViewportSize({width:1440,height:900});
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-layout-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];
 const {workspace,vault,deviceStore}=await encryptedFixture(directory,book),app=await startServer({root:workspace.root,port:0,deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);
  const properties=page.getByRole('complementary',{name:'Record properties',exact:true}),writing=page.locator('.record-writing-surface');
  await expect(properties.locator('[data-record-publication]')).toBeVisible();
  await expect(properties.getByRole('button',{name:'Edit record date',exact:true})).toBeVisible();
  // Wide screens: the writing starts in the first screen and the properties sit to its right.
  const [work,side]=[await writing.boundingBox(),await properties.boundingBox()];
  expect(side.x).toBeGreaterThan(work.x+work.width-1);expect(work.y).toBeLessThan(900);
  // A phone stacks the properties under the work, with no sideways scrolling.
  await page.setViewportSize({width:390,height:844});
  await expect.poll(async()=>(await properties.boundingBox()).y).toBeGreaterThan((await writing.boundingBox()).y);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }finally{await app.close();await clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
