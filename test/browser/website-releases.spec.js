import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createNotebook} from '../../src/model.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {clearVault} from '../../src/encryption.js';
import {withdrawalNotice} from '../../src/website-withdrawal-edition.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test('the release view tracks a folder edition, withdraws it after review and reopens the released version',async({page})=>{
 test.setTimeout(150000);
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-releases-')),out=path.join(dir,'Publication'),db=process.env.OBSERVANDA_DATABASE_URL;
 let app,fixture;
 try{
  await mkdir(out);await writeFile(path.join(out,'notes.txt'),'Kept by the site owner');
  fixture=await encryptedFixture(dir,createNotebook('Survey'));const id=randomUUID();
  const html=title=>'<!doctype html><html lang="en"><head><title>'+title+'</title><link rel="stylesheet" href="style.css"></head><body><main><h1>'+title+'</h1><p>Sampling began in March.</p></main></body></html>';
  await new WebsiteFileStore(fixture.workspace).importFiles(id,{name:'Estuary survey',files:new Map([['index.html',html('Estuary survey')],['methods.html',html('Methods')],['style.css','main{max-width:40rem}']])});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(dir,'preferences.json'),port:0});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const canvas=page.frameLocator('#website-files-canvas'),status=page.locator('[data-website-files-status]');
  await expect(canvas.getByRole('heading',{name:'Estuary survey'})).toBeVisible();
  const tools=page.getByRole('navigation',{name:'Website'}),panel=page.locator('[data-website-releases]');
  const openReleases=async()=>{await tools.getByRole('button',{name:'Releases',exact:true}).click();await expect(panel.getByRole('heading',{name:'Releases',exact:true})).toBeFocused();};

  await openReleases();
  await expect(panel).toContainText('No destination chosen');await expect(panel).toContainText('Choose a folder or a remote destination');
  await panel.getByRole('button',{name:'Return to editing'}).click();

  // Publish the website to a folder through the ordinary review.
  await tools.getByRole('button',{name:'Publish to folder',exact:true}).click();await page.getByLabel('Destination folder',{exact:true}).fill(out);
  await page.getByRole('button',{name:'Review file changes'}).click();await page.locator('[data-website-file-folder-confirm]').check();
  await page.getByRole('button',{name:'Write reviewed files'}).click();await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Return to editing'}).click();
  await openReleases();
  await expect(panel.locator('[data-release-current]')).toHaveText('The destination has the current saved website.');
  await expect(panel).toContainText(out);await expect(panel).toContainText('Written and verified in the folder');
  await expect(panel.locator('[data-release-entry]')).toHaveCount(1);
  await panel.getByRole('button',{name:'Return to editing'}).click();

  // A saved edit is outstanding until the next reviewed update.
  const heading=canvas.getByRole('heading',{name:'Estuary survey'});await heading.click();await page.keyboard.press('End');await page.keyboard.type(' 2026');
  await expect(canvas.getByRole('heading',{name:'Estuary survey 2026'})).toBeVisible();
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(status).toHaveText('Website saved.');
  await openReleases();
  await expect(panel.locator('[data-release-outstanding]')).toContainText('change');
  await expect(panel.locator('[data-release-kind="changed"]')).toContainText('index.html');

  // Withdrawal is reviewed like any other folder update and keeps unrelated files.
  const withdraw=panel.getByRole('button',{name:'Withdraw publication'});await withdraw.focus();await withdraw.press('Enter');
  const review=page.locator('[data-folder-withdrawal]');
  await expect(review.getByRole('heading',{name:'Withdraw from folder'})).toBeVisible();
  await expect(review).toContainText('Only files it wrote and that are unchanged are removed');
  await page.locator('[data-website-file-folder-confirm]').check();await page.getByRole('button',{name:'Write reviewed files'}).click();
  await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();
  expect((await readdir(out)).sort()).toEqual(['index.html','notes.txt','publication.json']);
  expect(await readFile(path.join(out,'index.html'),'utf8')).toBe(withdrawalNotice());
  expect(await readFile(path.join(out,'notes.txt'),'utf8')).toBe('Kept by the site owner');
  expect(await readFile(path.join(out,'publication.json'),'utf8')).not.toMatch(/Estuary|Methods|Sampling/);
  await page.getByRole('button',{name:'Return to editing'}).click();

  await openReleases();
  await expect(panel).toContainText('Last delivered edition');await expect(panel.locator('.website-release-facts').nth(1)).toContainText('Withdrawal notice');
  const entries=panel.locator('[data-release-entry]');await expect(entries).toHaveCount(2);
  await expect(entries.first()).toContainText('Withdrawal notice');await expect(entries.last()).toContainText('Website');
  await entries.last().getByRole('button',{name:'Open this version'}).click();
  await expect(page.getByRole('heading',{name:'Version history'})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Version history'})).toBeVisible();
  expect(errors).toEqual([]);
 }finally{
  if(db===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=db;
  try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(dir,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});
