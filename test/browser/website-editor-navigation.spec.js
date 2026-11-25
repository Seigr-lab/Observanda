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

test('the website editor keeps the app navigation and Back returns one screen at a time',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);await page.setViewportSize({width:1440,height:900});
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-navigation-'));
 const book=sampleNotebook();book.entries=[];const project=book.projects[0].title,fixture=await encryptedFixture(directory,book);
 const store=new WebsiteFileStore(fixture.workspace),id=randomUUID();
 await store.importFiles(id,{name:'Field atlas',files:new Map([['index.html','<!doctype html><html lang="en"><head><title>Field atlas</title></head><body><main><h1>Field atlas</h1></main></body></html>']])});
 const app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
 try{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.url);await expect(page.locator('#main-navigation')).toBeVisible();
  const back=page.getByRole('button',{name:'Back',exact:true}),menuButton=page.getByRole('button',{name:'Menu',exact:true}),editor=page.locator('[data-website-files-app]');
  const canvas=page.frameLocator('#website-files-canvas').getByRole('heading',{name:'Field atlas'});
  await expect(back).toBeDisabled();
  await page.evaluate(hash=>location.hash=hash,'#/websites/'+id+'/editor');
  await expect(canvas).toBeVisible();
  // The editor is a page of the app: the same navigation, collapsed by the same button.
  await expect(page.locator('#main-navigation')).toBeVisible();await expect(page.locator('#main-navigation').getByRole('button',{name:'Open project '+project,exact:true})).toBeVisible();
  await menuButton.click();await expect(page.locator('#main-navigation')).toBeHidden();
  await menuButton.click();await expect(page.locator('#main-navigation')).toBeVisible();
  // A screen inside the editor is one history step: Back returns to the editor, Forward reopens it.
  const task=editor.locator('.website-workspace-identity>.website-task-label');
  const siteMenu=editor.locator('[data-website-site-menu]');if(!await siteMenu.evaluate(node=>node.open))await siteMenu.locator('summary').click();
  await siteMenu.getByRole('button',{name:'Publishing destination',exact:true}).click();await expect(task).toHaveText('Publishing destination');
  await back.click();await expect(task).toHaveText('Website editor');await expect(canvas).toBeVisible();
  await page.goForward();await expect(task).toHaveText('Publishing destination');
  // Its own way out returns through history too, so Back never reopens the closed screen.
  await editor.getByRole('button',{name:'Return to editing',exact:true}).click();await expect(task).toHaveText('Website editor');
  // A place chosen in the navigation leaves the editor in one step; Back returns to the editor.
  await page.locator('#main-navigation').getByRole('button',{name:'Open project '+project,exact:true}).click();
  await expect(editor).toHaveCount(0);await expect(page.getByRole('heading',{level:1,name:project})).toBeVisible();
  await back.click();await expect(canvas).toBeVisible();await expect(task).toHaveText('Website editor');
  await back.click();await expect(editor).toHaveCount(0);await expect(back).toBeDisabled();
  expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(fixture.vault);await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
});
