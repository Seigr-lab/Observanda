import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {referenceBook} from '../publication-reference-fixture.js';
import {buildPublication,verifyPublication} from '../../src/publication.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';

for(const scripts of [true,false])test('record references continue with the full record '+(scripts?'with scripts':'without scripts'),async({browser},info)=>{
 const book=referenceBook(),target=book.entries[0],output=buildPublication(book);verifyPublication(output);
 const context=await browser.newContext({javaScriptEnabled:scripts}),page=await context.newPage();
 await context.route('https://edition.invalid/books/**',route=>{
  const name=new URL(route.request().url()).pathname.slice('/books/'.length),value=output.files.get(name);
  return route.fulfill({status:value===undefined?404:200,contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'application/octet-stream',body:value??'Missing'});
 });
 try{
  if(scripts){
   await page.goto('https://edition.invalid/books/browse.html');await page.getByLabel('Search public records',{exact:true}).fill('refer');await page.getByRole('button',{name:'Apply filters',exact:true}).click();
   await page.getByRole('link',{name:target.title,exact:true}).click();
  }else await page.goto('https://edition.invalid/books/entries/'+target.id+'.html');
  const section=page.locator('#record-references'),links=section.locator('.record-related a'),next=section.getByRole('link',{name:'Next references',exact:true}),previous=section.getByRole('link',{name:'Previous references',exact:true}),seen=[];
  for(let part=0;part<3;part++){
   await expect(links).toHaveCount(part===2?5:24);seen.push(...await links.evaluateAll(nodes=>nodes.map(n=>n.textContent)));
   await expect(page.locator('.record-page > .prose')).toHaveText(target.body);await expect(page.locator('.site-footer')).toContainText(book.website.footer);
   if(scripts){await expect(page.locator('[data-book-next]')).toBeVisible();await expect(page.locator('[data-book-next]')).toContainText(book.entries[1].title);await expect(page.locator('[data-book-back]')).toHaveAttribute('href',/q=refer/);}
   if(part<2){if(scripts)await next.click();else await next.press('Enter');}
  }
  expect(new Set(seen).size).toBe(53);expect([...seen].sort()).toEqual(book.entries.slice(1).map(r=>r.title).sort());await expect(next).toHaveCount(0);
  await previous.press('Enter');await expect(links).toHaveCount(24);await page.reload();await expect(links.first()).toHaveText(book.entries[25].title);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('reference-navigation-phone.png')});
  await links.first().press('Enter');await expect(page.locator('header h1')).toHaveText(seen[24]);
 }finally{await context.close();}
});

test('appearance reference navigation survives theme edits and failed transfers',async({page})=>{
 test.setTimeout(120000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-reference-browser-')),book=referenceBook(),f=await encryptedFixture(directory,book);
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await expect(page.locator('#main-navigation')).toBeVisible();await page.evaluate(()=>location.hash='#/preferences/appearance');
  const choice=page.getByLabel('Preview page',{exact:true});await expect(choice).toBeEnabled();await choice.selectOption('entries/'+book.entries[0].id+'.html');
  const frame=page.frameLocator('#design-preview'),section=frame.locator('#record-references'),links=section.locator('.record-related a');
  await expect(links).toHaveCount(24);await section.getByRole('link',{name:'Next references',exact:true}).click();await expect(links.first()).toHaveText(book.entries[25].title);
  await page.getByLabel('Accent',{exact:true}).fill('#334455');await expect(frame.locator('html')).toHaveCSS('--accent','#334455');await expect(links.first()).toHaveText(book.entries[25].title);
  await page.route('**/appearance-preview/**/entries/*.html?references=*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Interrupted reference request'})}),{times:1});
  await section.getByRole('link',{name:'Next references',exact:true}).click();await expect(page.locator('[data-action="theme-preview-retry"]')).toBeVisible();
  await page.locator('[data-action="theme-preview-retry"]').click();await expect(links).toHaveCount(5);await expect(frame.locator('.record-page > .prose')).toHaveText(book.entries[0].body);
  await expect(page.locator('#design-preview')).toHaveAttribute('sandbox','allow-same-origin');expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
