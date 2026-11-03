import {test,expect} from '@playwright/test';
import {EventEmitter} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {websiteFilesHttp} from '../../src/website-files-http.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {mountFilesEditor} from './mount-files-editor.js';

test.use({screenshot:'off',trace:'off',video:'off'});
test('an author finds a public page by title or folder and saves the exact menu destination',async({page})=>{
 test.setTimeout(180000);
 const root=await mkdtemp(path.join(os.tmpdir(),'website-menu-choices-'));await mkdir(path.join(root,'.observanda'));
 try{
  const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace),id=randomUUID();
  workspace.openCatalogue=workspace.catalogue=()=>{throw Error('Menu search opened research storage');};
  const html=title=>'<!doctype html><html><head><title>'+title+'</title></head><body><main><h1>'+title+'</h1></main></body></html>';
  const pages=new Map([['index.html',html('Field handbook')],['style.css','body{color:#243b36}']]);
  for(let i=1;i<=90;i++)pages.set('stations/'+i+'.html',html('Sampling station '+i));
  const north='methods/north/summary.html',south='methods/south/summary.html';
  for(const name of [north,south])pages.set(name,html('Résumé des stations'));
  await store.importFiles(id,{name:'Field handbook',files:pages,draftFiles:new Map([['draft/secret.html',html('Private field summary')],['draft-styles.css','']])});
  const calls=[];
  await page.exposeFunction('filesAPI',async(route,data)=>{
   calls.push(route);let value;
   await websiteFilesHttp({method:'POST',headers:{}},new EventEmitter(),{url:new URL(route,'https://website.test'),workspace,contextId:'test',title:'Field handbook',body:async()=>data??{},json:result=>{value=result;},check:async()=>{},preparation:async()=>({state:'ready',defaultSiteId:id})});
   return value;
  });
  await mountFilesEditor(page);await page.getByRole('button',{name:'Website menu',exact:true}).click();
  const menu=page.getByRole('region',{name:'Website menu',exact:true});
  await menu.getByRole('button',{name:'Add menu item'}).press('Enter');
  await menu.getByLabel('Menu label',{exact:true}).fill('Southern protocol');
  await expect(menu.locator('.website-menu-pages option,[data-menu-path]')).toHaveCount(0);
  const choose=menu.getByRole('button',{name:'Choose a page'});await choose.press('Enter');
  const find=menu.locator('[data-menu-page-search]'),rows=menu.locator('[data-menu-path]');await expect(find).toBeFocused();
  await expect(rows).toHaveCount(40);await expect(menu.getByRole('status')).toHaveText('1–40 of 93 pages');
  await menu.getByRole('button',{name:'Next pages'}).press('Enter');await expect(rows.first()).toBeFocused();
  await menu.getByRole('button',{name:'Next pages'}).press('Enter');await expect(rows).toHaveCount(13);
  await menu.getByRole('button',{name:'Previous pages'}).press('Enter');await expect(menu.getByRole('status')).toHaveText('41–80 of 93 pages');
  await find.fill('private field');await expect(rows).toHaveCount(0);await expect(menu.getByRole('status')).toHaveText('No pages match this search.');
  await find.fill('resume methods/');await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(north);await expect(rows.nth(1)).toContainText(south);
  await rows.nth(1).press('Enter');await expect(choose).toBeFocused();await expect(menu.getByLabel('Link',{exact:true})).toHaveValue(south);
  await choose.press('Enter');await find.fill('north');await menu.getByRole('region',{name:'Choose a page'}).getByRole('button',{name:'Cancel'}).press('Enter');
  await expect(menu.getByLabel('Link',{exact:true})).toHaveValue(south);
  await menu.getByRole('button',{name:'Save menu'}).press('Enter');
  await expect.poll(()=>calls.filter(route=>route.endsWith('/menu')).length,{timeout:45000}).toBe(2);
  await expect(menu.getByRole('button',{name:'Save menu'})).toBeDisabled();
  const saved=await store.menu(id,{expectedRevision:await store.siteVersion(id)});expect(saved.items[0]).toMatchObject({label:'Southern protocol',href:south});
  const nested=await store.open(id,{path:north});expect(nested.html).toContain('href="../south/summary.html"');expect(nested.html).not.toContain('Private field summary');
  await page.reload();await page.getByRole('button',{name:'Website menu',exact:true}).click();await expect(menu.getByLabel('Link',{exact:true})).toHaveValue(south);
  expect(calls.every(route=>route.startsWith('/api/website-files/'))).toBe(true);expect(calls.filter(route=>route.endsWith('/menu/save'))).toHaveLength(1);
 }finally{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
