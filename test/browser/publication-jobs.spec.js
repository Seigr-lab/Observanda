import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {PublicationJobs} from '../../src/publication-jobs.js';
import {clearVault} from '../../src/encryption.js';
import {navigate} from './preferences-helper.js';

test('website preparation can be cancelled, reopened after restart, reviewed and downloaded without publishing private work',async({page})=>{
 test.setTimeout(60000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-publication-ui-')),book=sampleNotebook();book.entries[1].share=false;book.entries[1].title='PRIVATE_UNRELEASED_TAKE';
 const f=await encryptedFixture(directory,book),options={root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')};let app=await startServer(options),first=true;
 const prepare=PublicationJobs.prototype.prepare;PublicationJobs.prototype.prepare=async function(...args){if(first){first=false;await delay(30000,null,{signal:args[1].signal});}return prepare.apply(this,args);};
 try{
  await page.goto(app.url);await navigate(page,'Website editor');await page.getByRole('button',{name:'Preview & export',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();const dialog=page.locator('#dialog');
  await expect(dialog.getByRole('heading',{name:'Preparing website'})).toBeVisible();await expect.poll(()=>first).toBe(false);await dialog.getByRole('button',{name:'Cancel preparation'}).click();await expect(dialog).toContainText('cancelled');await dialog.getByRole('button',{name:'Continue working'}).click();
  await app.close();app=await startServer(options);await page.goto(app.url);await navigate(page,'Publishing');await page.getByRole('button',{name:'Website preparations'}).click();await expect(dialog).toContainText('cancelled');
  await dialog.getByRole('button',{name:'Retry preparation'}).click();await expect(dialog.getByRole('button',{name:'Open review'})).toBeVisible({timeout:15000});await dialog.getByRole('button',{name:'Open review'}).click();
  await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible();await expect(page.locator('iframe[title="Publication preview"]')).toBeVisible();const url=page.url(),preview=await page.locator('#full-public-preview').getAttribute('href');
  expect((await fetch(new URL(preview,app.url))).status).toBe(401);await page.reload();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible();expect(page.url()).toBe(url);
  await page.getByLabel('I have reviewed this website and its media for sharing.').check();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download website ZIP'}).click();const download=await downloading,bytes=await readFile(await download.path());
  expect(bytes.includes(Buffer.from('PRIVATE_UNRELEASED_TAKE'))).toBe(false);expect(bytes.includes(Buffer.from(f.workspace.root))).toBe(false);expect(bytes.includes(Buffer.from('publication.json'))).toBe(true);
  const latest=await f.workspace.read();latest.book.entries[0].title='Changed after review';await f.workspace.save(latest.book,latest.etag);await page.reload();await expect(page.getByText('The workspace or publishing destination has changed since this edition was prepared.',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Download website ZIP'})).toBeDisabled();
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }finally{PublicationJobs.prototype.prepare=prepare;await page.close();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('a new prepared edition opens automatically and keeps review confirmation explicit after reload',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-publication-ready-')),f=await encryptedFixture(directory,sampleNotebook()),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 try{
  await page.goto(app.url);await navigate(page,'Website editor');await page.getByRole('button',{name:'Preview & export',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible({timeout:15000});
  const previewPage=page.getByLabel('Preview page',{exact:true});await expect(previewPage).toBeVisible();const selectedPage=await previewPage.locator('option').last().getAttribute('value');await previewPage.selectOption(selectedPage);expect(new URL(await page.locator('#full-public-preview').getAttribute('href'),app.url).pathname.endsWith(selectedPage)).toBe(true);
  await expect(page.getByLabel('I have reviewed this website and its media for sharing.')).not.toBeChecked();await page.getByRole('button',{name:'Download website ZIP'}).click();await expect(page.locator('#notice')).toContainText('Please review');
  await page.reload();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible();await expect(page.getByLabel('I have reviewed this website and its media for sharing.')).not.toBeChecked();
 }finally{await page.close();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('prepared edition pages expose older cancelled work and preserve its page during retry',async({page})=>{
 test.setTimeout(60000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-edition-pages-')),f=await encryptedFixture(directory,sampleNotebook()),releases=new PublicationJobs(f.workspace),{workspaceJobs}=await import('../../src/workspace-jobs.js'),jobs=workspaceJobs(f.workspace),current=await releases.workspace.outline();let oldest;
 for(let i=0;i<22;i++){const job=await releases.start(current,jobs.queue);if(i===0)oldest=job;await jobs.queue.control(job.id,'cancel');}
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 try{
  await page.goto(app.url);await navigate(page,'Publishing');await page.getByRole('button',{name:'Website preparations'}).click();const dialog=page.locator('#dialog');await expect(dialog.getByRole('button',{name:'Retry preparation'})).toHaveCount(20);
  const older=dialog.getByRole('button',{name:'Older editions'});await older.focus();await page.keyboard.press('Enter');await expect(dialog).toContainText('Page 2');await expect(dialog.getByRole('button',{name:'Retry preparation'})).toHaveCount(2);await expect(older).toBeDisabled();
  await dialog.locator('[data-action="publication-jobs-retry"][data-id="'+oldest.id+'"]').click();await expect(dialog.getByRole('button',{name:'Open review'})).toBeVisible({timeout:15000});await expect(dialog).toContainText('Page 2');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await expect(dialog.getByRole('button',{name:'Continue working',exact:true})).toBeInViewport();await page.screenshot({path:test.info().outputPath('edition-pages-narrow.png')});
  await dialog.getByRole('button',{name:'Open review'}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible();
 }finally{await page.close();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
