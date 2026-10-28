import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {referenceBook} from '../publication-reference-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {navigate} from './preferences-helper.js';
import {chooseWebsitePage,task} from './composer-helper.js';

test('canvas reference windows preserve design edits, recover failed requests and support keyboard navigation',async({page},info)=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-canvas-references-')),book=referenceBook(),f=await encryptedFixture(directory,book);
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().endsWith('/api/design-preview'))requests.push(request.postDataJSON());});
 try{
  await page.goto(app.url);await expect(page.locator('#main-navigation')).toBeVisible();await navigate(page,'Website editor');
  await chooseWebsitePage(page,'entries/'+book.entries[0].id+'.html');
  const frame=page.frameLocator('#website-draft-preview'),section=frame.locator('#record-references'),links=section.locator('.record-related a');
  const next=section.getByRole('link',{name:'Next references',exact:true}),previous=section.getByRole('link',{name:'Previous references',exact:true});
  await expect(links).toHaveCount(24);const first=await links.allTextContents(),saved=await page.locator('#save-status').textContent();
  await next.focus();await next.press('Enter');await expect(links.first()).toHaveText(book.entries[25].title);await expect(next).toBeFocused();
  const middle=await links.allTextContents();await expect(page.locator('#save-status')).toHaveText(saved);
  expect(requests.at(-1).referenceCursor).toEqual(expect.any(String));expect(requests.at(-1).draft).toBeUndefined();expect(requests.at(-1).websitePin).toBeDefined();expect(requests.at(-1).websiteDraft).toBeUndefined();
  await task(page,'Site');await page.getByLabel('Website title',{exact:true}).fill('Reference review design');
  await expect(frame.locator('.site-name')).toHaveText('Reference review design');expect(await links.allTextContents()).toEqual(middle);
  const editing=page.getByRole('navigation',{name:'Editing tools',exact:true}).getByRole('button',{name:'Site',exact:true});await expect(editing).toHaveAttribute('aria-current','page');
  const draft=await page.locator('#save-status').textContent();
  await page.route('**/api/design-preview',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Interrupted reference window'})}),{times:1});
  await next.click();await expect(page.locator('#website-preview-status')).toHaveText('Interrupted reference window');expect(await links.allTextContents()).toEqual(middle);
  // Retry from the still-visible window itself, including after preview state
  // has been cleared by the failure. It must keep the same source and draft.
  await next.click();await expect(links).toHaveCount(5);await expect(previous).toBeFocused();await expect(editing).toHaveAttribute('aria-current','page');
  await expect(frame.locator('.record-page > .prose')).toHaveText(book.entries[0].body);await expect(page.locator('#save-status')).toHaveText(draft);
  await previous.press('Enter');await expect(links).toHaveCount(24);expect(await links.allTextContents()).toEqual(middle);await expect(previous).toBeFocused();
  await previous.press('Enter');await expect(links.first()).toHaveText(book.entries[1].title);expect(await links.allTextContents()).toEqual(first);await expect(next).toBeFocused();
  await chooseWebsitePage(page,'entries/'+book.entries[1].id+'.html');await expect(frame.locator('body')).toHaveAttribute('data-page','entry:'+book.entries[1].id);await expect(section).toHaveCount(0);
  await chooseWebsitePage(page,'entries/'+book.entries[0].id+'.html');await expect(links.first()).toHaveText(book.entries[1].title);expect(requests.at(-1).referenceCursor).toBeNull();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await next.focus();await next.press('Enter');await expect(links.first()).toHaveText(book.entries[25].title);await expect(next).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await expect(page.locator('#website-draft-preview')).toHaveAttribute('sandbox','allow-same-origin');await page.screenshot({path:info.outputPath('canvas-reference-window-phone.png')});expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
