import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {notebookDirectoryBook} from '../publication-notebook-fixture.js';
import {buildPublication,verifyPublication} from '../../src/publication.js';
import {collectionPagePath} from '../../src/web/public-collection-pages.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';

for(const scripts of [true,false])test('project lab-book directories remain navigable '+(scripts?'with scripts':'without scripts'),async({browser},info)=>{
 const book=notebookDirectoryBook(),output=buildPublication(book);verifyPublication(output);
 const context=await browser.newContext({javaScriptEnabled:scripts}),page=await context.newPage();
 await context.route('https://edition.invalid/books/**',route=>{
  const name=new URL(route.request().url()).pathname.slice('/books/'.length),value=output.files.get(name);
  return route.fulfill({status:value===undefined?404:200,contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'application/octet-stream',body:value??'Missing'});
 });
 try{
  await page.goto('https://edition.invalid/books/'+collectionPagePath('project:'+book.notebooks[0].projectId,1));
  const directory=page.locator('.project-book-directory'),rows=directory.locator('[data-feed-item]'),next=directory.getByRole('link',{name:'Next lab books',exact:true}),previous=directory.getByRole('link',{name:'Previous lab books',exact:true});
  const recordIds=()=>page.locator('#page-records [data-record-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.recordId)),records=await recordIds(),seen=[];
  for(let part=0;part<3;part++){
   await expect(rows).toHaveCount(part===2?5:24);await expect(rows.first()).toHaveAttribute('data-feed-id',book.notebooks[part*24].id);seen.push(...await rows.evaluateAll(nodes=>nodes.map(n=>n.dataset.feedId)));
   expect(await recordIds()).toEqual(records);await expect(page.locator('.site-footer')).toContainText('Powered by Observanda');
   if(part<2){if(scripts)await next.click();else await next.press('Enter');}
  }
  expect(seen).toEqual(book.notebooks.slice(0,53).map(n=>n.id));await expect(next).toBeHidden();await previous.press('Enter');await expect(rows).toHaveCount(24);
  if(scripts){
   await page.reload();await expect(rows.first()).toHaveAttribute('data-feed-id',seen[24]);
   await directory.getByLabel('Search lab books',{exact:true}).fill('Lab book 0052');await directory.getByRole('button',{name:'Apply filters',exact:true}).click();await expect(rows).toHaveCount(1);await expect(rows).toHaveText('Lab book 0052');expect(await recordIds()).toEqual(records);
   await directory.getByLabel('Search lab books',{exact:true}).fill('not a lab book');await directory.getByRole('button',{name:'Apply filters',exact:true}).click();await expect(directory.locator('[data-feed-empty]')).toHaveText('No matching lab books.');await expect(rows).toHaveCount(0);
   await directory.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(rows).toHaveCount(24);
   await directory.getByLabel('Order',{exact:true}).selectOption('reverse-alphabetical');await expect(rows.first()).toHaveAttribute('data-feed-id',seen[52]);
  }
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('lab-books-phone.png')});
 }finally{await context.close();}
});

test('authenticated appearance preview searches and retries lab-book continuation without changing record cards',async({page})=>{
 test.setTimeout(120000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-directory-')),book=notebookDirectoryBook(),f=await encryptedFixture(directory,book);
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await expect(page.locator('#main-navigation')).toBeVisible();await page.evaluate(()=>location.hash='#/preferences/appearance');
  const choice=page.getByLabel('Preview page',{exact:true});await expect(choice).toBeEnabled();await choice.selectOption(collectionPagePath('project:'+book.notebooks[0].projectId));
  const frame=page.frameLocator('#design-preview'),feed=frame.locator('.project-book-directory'),rows=feed.locator('[data-feed-item]'),ids=()=>frame.locator('#page-records [data-record-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.recordId));
  await expect(rows).toHaveCount(24);const before=await ids();
  await page.route('**/appearance-preview/**/_assets/**/projects/feed-*-1.html',route=>route.fulfill({status:503,body:'Interrupted directory transfer'}),{times:1});
  await feed.getByRole('link',{name:'Next lab books',exact:true}).click();await expect(feed.getByRole('button',{name:'Retry',exact:true})).toBeVisible();await expect(rows.first()).toHaveText('Lab book 0000');
  await feed.getByRole('button',{name:'Retry',exact:true}).click();await expect(rows.first()).toHaveText('Lab book 0024');expect(await ids()).toEqual(before);
  await feed.getByLabel('Search lab books',{exact:true}).fill('Lab book 0052');await feed.getByRole('button',{name:'Apply filters',exact:true}).click();await expect(rows).toHaveCount(1);await expect(rows).toHaveText('Lab book 0052');expect(await ids()).toEqual(before);
  await expect(page.locator('#design-preview')).toHaveAttribute('sandbox','allow-same-origin');expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
