import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {queryFixture} from '../record-query-fixture.js';
import {Workspace} from '../../src/storage.js';
import {testServer} from '../device-fixture.js';
test('combined browsing survives reading, back/forward and reload, and resets when changing scope',async({page})=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-query-')),book=queryFixture(),ws=new Workspace(root);book.title=path.basename(root);await ws.create(book);
 const before=await ws.read(),app=await testServer({root,port:0,headless:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/projects/'+id+'/records',book.projects[0].id);
  await page.getByText('Filters',{exact:true}).click();
  await page.getByLabel('Tags',{exact:true}).fill('sound, summer');
  await page.getByLabel('From date',{exact:true}).fill('2026-06-01');await page.getByLabel('Through date',{exact:true}).fill('2026-06-30');
  await page.getByLabel('Lab type',{exact:true}).selectOption('arts-creative');
  await page.getByLabel('Sort records',{exact:true}).selectOption('date-asc');
  const rows=page.locator('.records-table tbody tr');
  await expect(rows).toHaveCount(2);await expect(rows.first()).toContainText('Summer take 1');await expect(rows.last()).toContainText('Summer take 2');
  await mkdir('.local/ux-review',{recursive:true});await page.screenshot({path:'.local/ux-review/record-browse-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'Summer take 2',exact:true}).click();
  await expect(page.locator('.record-reader')).toContainText('Recorder stopped early');
  await page.getByRole('button',{name:'Back to records',exact:true}).click();
  await expect(page.getByLabel('Tags',{exact:true})).toHaveValue('sound, summer');await expect(rows).toHaveCount(2);
  await page.reload();await expect(page.getByLabel('Lab type',{exact:true})).toHaveValue('arts-creative');await expect(rows).toHaveCount(2);
  await page.getByRole('button',{name:'Summer take 1',exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText('Summer take 1');await page.goBack();await expect(rows).toHaveCount(2);
  await page.getByLabel('Progress',{exact:true}).selectOption('incomplete');await expect(rows).toHaveCount(1);
  await page.getByRole('searchbox',{name:'Search records',exact:true}).fill('Recorder stopped');await expect(rows).toHaveCount(1);
  await page.getByLabel('From date',{exact:true}).fill('2026-07-01');await expect(page.getByRole('alert')).toContainText('start date');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.documentElement.style.fontSize='20px';});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await page.getByRole('searchbox',{name:'Search records',exact:true}).boundingBox()).width).toBeGreaterThan(180);
  await page.screenshot({path:'.local/ux-review/record-browse-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(rows).toHaveCount(5);
  await page.getByText('Filters',{exact:true}).click();await page.getByLabel('Tags',{exact:true}).fill('unknown tag');await expect(page.getByRole('heading',{name:'No records match these filters'})).toBeVisible();
  await page.locator('.workspace-empty').getByRole('button',{name:'Clear filters',exact:true}).click();await expect(rows).toHaveCount(5);
  // New scope starts clean; history filters never become workspace content.
  await page.evaluate(id=>location.hash='#/notebooks/'+id,book.notebooks[1].id);await expect(rows).toHaveCount(3);
  expect((await ws.read()).etag).toBe(before.etag);expect(errors).toEqual([]);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
