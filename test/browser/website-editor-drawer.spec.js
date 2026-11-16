import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test('the full-screen website editor opens the app navigation as a drawer and leaves for the chosen place',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);await page.setViewportSize({width:1440,height:900});
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-drawer-'));
 const book=sampleNotebook();book.entries=[];const project=book.projects[0].title,fixture=await encryptedFixture(directory,book);
 const store=new WebsiteFileStore(fixture.workspace),id=randomUUID();
 await store.importFiles(id,{name:'Field atlas',files:new Map([['index.html','<!doctype html><html lang="en"><head><title>Field atlas</title></head><body><main><h1>Field atlas</h1></main></body></html>']])});
 const app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
 try{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.url);await expect(page.locator('#main-navigation')).toBeVisible();
  await page.evaluate(hash=>location.hash=hash,'#/websites/'+id+'/editor');
  await expect(page.frameLocator('#website-files-canvas').getByRole('heading',{name:'Field atlas'})).toBeVisible();
  // The editor fills the window; the app navigation waits in a drawer.
  await expect(page.locator('.sidebar:visible')).toHaveCount(0);
  const toggle=page.getByRole('button',{name:'Open app menu',exact:true});await toggle.click();
  const drawer=page.getByRole('dialog',{name:'Menu',exact:true});
  await expect(drawer.getByRole('button',{name:'Open project '+project,exact:true})).toBeVisible();
  await expect(drawer.getByRole('button',{name:'Dashboard',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(drawer).toBeHidden();await expect(toggle).toBeFocused();
  // The close button closes it too.
  await toggle.click();await expect(drawer).toBeVisible();
  await drawer.getByRole('button',{name:'Close app menu',exact:true}).click();await expect(drawer).toBeHidden();
  // Choosing a place leaves the editor for it, with one navigation in the workspace.
  await toggle.click();await drawer.getByRole('button',{name:'Open project '+project,exact:true}).click();
  await expect(page.locator('[data-website-files-app]')).toHaveCount(0);
  await expect(page.getByRole('heading',{level:1,name:project})).toBeVisible();
  await expect(page.locator('[data-website-files-drawer]')).toHaveCount(0);await expect(page.locator('#main-navigation')).toHaveCount(1);
  expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(fixture.vault);await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
});
