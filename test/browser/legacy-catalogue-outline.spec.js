import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {legacyCatalogueFixture} from '../legacy-catalogue-fixture.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
test('an older catalogue above the complete-document budget opens, reads, edits and reloads through bounded app routes',async({page})=>{
 test.setTimeout(240000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-legacy-app-')),read=ResearchCatalogue.prototype.read;
 let f,app;const errors=[],fullPages=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).pathname==='/api/workspace/read/page')fullPages.push(request.url());});
 try{
  f=await legacyCatalogueFixture(directory,{count:80,size:40000});
  ResearchCatalogue.prototype.read=()=>{throw Error('App attempted a complete legacy document');};
  app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  // Structure changes must also use the outline path while the catalogue still
  // has its old membership format, before a record save upgrades its indexes.
  await page.evaluate(id=>location.hash='#/projects/'+id,f.book.projects[0].id);
  await page.locator('main').getByRole('button',{name:'Settings',exact:true}).click();
  const dialog=page.locator('#dialog');await dialog.getByLabel('Name',{exact:true}).fill('Older project continued');
  const structure=page.waitForResponse(r=>r.url().endsWith('/api/workspace/structure')&&r.request().method()==='POST');
  await dialog.getByRole('button',{name:'Save project',exact:true}).click();
  expect((await structure).request().postDataJSON().response).toBe('outline');
  await expect(dialog).not.toBeVisible();await expect(page.locator('main h1')).toHaveText('Older project continued');
  const selected=f.records.at(-1);
  await page.evaluate(id=>location.hash='#/records/'+id+'/read',selected.id);
  await expect(page.getByRole('heading',{name:selected.title,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Edit record',exact:true}).click();
  const title=page.getByLabel('Record title',{exact:true});await expect(title).toHaveValue(selected.title);
  await title.fill('Edited from older catalogue');await page.getByRole('button',{name:'Save record',exact:true}).click();
  await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.reload();await expect(title).toHaveValue('Edited from older catalogue');
  await page.getByRole('button',{name:'Read record',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Edited from older catalogue',exact:true})).toBeVisible();
  expect(fullPages).toEqual([]);expect(errors).toEqual([]);
  const source=await f.workspace.catalogue(store=>store.recordSelection([selected.id]));
  expect(source.recordScope.total).toBe(80);expect(source.book.entries[0].body).toBe(selected.body);
 }finally{ResearchCatalogue.prototype.read=read;await app?.close();if(f)clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
