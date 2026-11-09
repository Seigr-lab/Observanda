import {test,expect} from '@playwright/test';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {WebsiteFileStore,websiteSourceId} from '../../src/website-file-store.js';
import {clearVault} from '../../src/encryption.js';
import {createNotebook} from '../../src/model.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test('name, reopen, compare and restore a website version with current permissions before a separate reviewed publication',async({page,browser})=>{
 test.setTimeout(120000);
 const root=await mkdtemp(path.join(os.tmpdir(),'website-version-browser-')),folder=path.join(root,'Edition'),database=process.env.OBSERVANDA_DATABASE_URL;
 let fixture,app,reader;
 try{
  fixture=await encryptedFixture(root,createNotebook('Station ledger'));await mkdir(folder);
  const store=new WebsiteFileStore(fixture.workspace),site=randomUUID(),sourceId=websiteSourceId({workspaceId:fixture.workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()});
  const put=(title,visible)=>store.beginSourceUpdate({sourceId}).then(token=>store.putSource({sourceId,title,html:visible?'<p>'+title+'</p>':'',visible},{token}));
  const source=await put('Restricted site coordinates',true);
  const v=await store.create({id:site,name:'Monitoring atlas',html:'<!doctype html><html lang="en"><head><title>Monitoring atlas</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Station summary</h1><p>Earlier observations</p></main></body></html>',css:'h1{color:navy}'});
  await store.insertSources(site,{expectedRevision:v.site.revision,sources:[{sourceId,sourceRevision:source.revision}],position:{before:0}});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/offline';
  const start=()=>testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'preferences.json'),port:0});
  app=await start();
  const go=()=>page.goto(app.origin+'/?view=website#'+app.launchToken),button=name=>page.getByRole('button',{name,exact:true});
  const canvas=page.frameLocator('#website-files-canvas');
  await go();await button('Version history').click();
  await page.getByLabel('Checkpoint name').fill('Site review');await button('Name current checkpoint').click();
  await expect(page.locator('[data-versions=version] option:checked')).toContainText('Site review');
  await button('Return to editing').click();await button('HTML').click();
  const html=page.getByRole('textbox',{name:'HTML',exact:true});
  await html.fill((await html.inputValue()).replace('Earlier observations','Later observations'));await button('Save website').click();
  await button('Publish to folder').click();await page.getByLabel('Destination folder',{exact:true}).fill(folder);
  const deliver=async()=>{await button('Review file changes').click();await page.locator('[data-website-file-folder-confirm]').check();await button('Write reviewed files').click();await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();};
  await deliver();expect(await readFile(path.join(folder,'index.html'),'utf8')).toContain('Later observations');
  await page.goto('about:blank');await app.close();app=null;
  await put('Restricted site coordinates',false);app=await start();await go();
  await button('Version history').click();
  const selected=page.locator('[data-versions=version]'),historical=selected.locator('option').filter({hasText:'Site review'});
  await selected.selectOption(await historical.getAttribute('value'));await button('Compare changes').click();
  await expect(page.locator('.website-version-diff pre').first()).toContainText('Earlier observations');
  await expect(page.locator('.website-version-diff pre').last()).toContainText('Later observations');
  await expect(page.locator('.website-version-panel')).not.toContainText('Restricted site coordinates');
  await button('Restore as new version').click();await expect(canvas.getByText('Earlier observations',{exact:true})).toBeVisible();
  expect(await readFile(path.join(folder,'index.html'),'utf8')).toContain('Later observations');
  await button('Preview saved website').click();await expect(page.frameLocator('#website-files-preview').getByText('Earlier observations',{exact:true})).toBeVisible();
  await button('Publish to folder').click();await page.getByLabel('Destination folder',{exact:true}).fill(folder);await deliver();
  reader=await browser.newPage();await reader.goto(pathToFileURL(path.join(folder,'index.html')).href);
  await expect(reader.getByText('Earlier observations',{exact:true})).toBeVisible();await expect(reader.locator('body')).not.toContainText('Restricted site coordinates');
  expect(await reader.locator('h1').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(0, 0, 128)');
 }finally{
  if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;
  await reader?.close();try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});
