import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createNotebook} from '../../src/model.js';
import {sampleNotebook} from '../../src/sample.js';
import {MediaImports} from '../../src/media-imports.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {navigate} from './preferences-helper.js';
import {task,sectionTools,editorTab} from './composer-helper.js';
const canvas=page=>page.frameLocator('#website-draft-preview');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('author original downloads, recover a library file, style each action, and download exact bytes from the prepared website',async({page},info)=>{
 test.setTimeout(150000);page.setDefaultTimeout(20000);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-download-ui-')),f=await encryptedFixture(root,createNotebook('Studio',''));
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(root,'preferences.json')}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const bytes=Buffer.alloc(1024*256+23,0xb5),name='Données α.img';Buffer.from('exact experiment original').copy(bytes);
 try{
  await page.goto(app.url);await navigate(page,'Website editor');await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('Experiment downloads');const target=await page.getByLabel('Page',{exact:true}).inputValue();
  await task(page,'Page');await page.locator('[data-palette-kind=download]').click();await canvas(page).locator('.section-download>.canvas-section-edit').click();
  await page.getByLabel('Upload an original file',{exact:true}).setInputFiles({name,mimeType:'application/octet-stream',buffer:bytes});await expect(page.locator('.website-file-name')).toContainText(name);await expect(canvas(page).locator('.section-download a[download]')).toHaveText(name);
  await page.getByLabel('Download label',{exact:true}).fill('Get recording');await page.getByLabel('Download description',{exact:true}).fill('Original capture for independent analysis.');await page.getByText('File size and SHA-256',{exact:true}).click();await expect(page.locator('.website-file-hash')).toContainText(hash(bytes));
  const identity=await page.locator('[data-website-media-select]').inputValue();
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await editorTab(page,'Media');await page.getByLabel('Upload an original file',{exact:true}).setInputFiles({name:'private-notes.txt',mimeType:'text/plain',buffer:Buffer.from('LIBRARY_ONLY_FILE')});await expect(page.locator('.website-file-name').filter({hasText:'private-notes.txt'})).toBeVisible();
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await task(page,'Page');await page.locator('[data-palette-kind=download]').click();await expect(canvas(page).locator('.section-download')).toHaveCount(2);await canvas(page).locator('.section-download>.canvas-section-edit').last().click();await page.getByRole('button',{name:'File imports',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.locator('[data-media-import-row="'+identity+'"]')).toBeVisible();await dialog.locator('[data-media-import-row="'+identity+'"]').getByRole('button',{name:'Use file',exact:true}).click();await expect(dialog).toBeHidden();
  await page.getByLabel('Download label',{exact:true}).fill('Recording as a button');await page.locator('[data-action-key=appearance]').selectOption('button');await sectionTools(page,'Style');const radius=page.locator('[data-action-style-key=radius]');const shape=radius.locator('xpath=ancestor::details[1]');if(!await shape.evaluate(el=>el.open))await shape.locator(':scope>summary').click();await radius.fill('12');await page.locator('[data-action-style-key=background]').fill('#173f3a');await page.locator('[data-action-style-key=color]').fill('#ffffff');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await expect(canvas(page).locator('.section-download')).toHaveCount(2);await expect(canvas(page).getByRole('link',{name:'Get recording',exact:true})).toHaveClass(/site-action--link/);
  await page.getByRole('button',{name:'Prepare edition',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible({timeout:45000});await page.getByLabel('Preview page',{exact:true}).selectOption(target);
  const href=await page.locator('#full-public-preview').getAttribute('href'),visitor=await page.context().newPage();
  try{
   await visitor.goto(new URL(href,app.origin).href);await expect(visitor.getByRole('link',{name:'Get recording',exact:true})).toHaveClass(/site-action--link/);const button=visitor.getByRole('link',{name:'Recording as a button',exact:true});await expect(button).toHaveCSS('border-radius','12px');await expect(button).toHaveCSS('background-color','rgb(23, 63, 58)');
   const pending=visitor.waitForEvent('download');await visitor.getByRole('link',{name:'Get recording',exact:true}).click();const download=await pending;expect(download.suggestedFilename()).toBe(name);expect(hash(await readFile(await download.path()))).toBe(hash(bytes));
   const link=await button.getAttribute('href'),response=await visitor.request.get(new URL(link,visitor.url()).href,{headers:{Range:'bytes=10-39'}});expect(response.status()).toBe(206);expect(response.headers()['content-type']).toBe('application/octet-stream');expect(await response.body()).toEqual(bytes.subarray(10,40));
   const manifest=await visitor.request.get(new URL('../publication.json',visitor.url()).href);const entries=(await manifest.json()).files;expect(entries.filter(entry=>entry.path.startsWith('downloads/'))).toHaveLength(1);
   await visitor.screenshot({path:info.outputPath('downloads-desktop.png')});await visitor.setViewportSize({width:390,height:844});await visitor.evaluate(()=>document.documentElement.style.fontSize='24px');expect(await visitor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await visitor.screenshot({path:info.outputPath('downloads-mobile.png')});
  }finally{await visitor.close();}
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('completion after a website switch stays private until explicitly placed in that website',async({page})=>{
 test.setTimeout(90000);const root=await mkdtemp(path.join(os.tmpdir(),'observanda-download-switch-')),book=sampleNotebook(),f=await encryptedFixture(root,book);
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(root,'preferences.json')});
 const prepare=MediaImports.prototype.prepare;let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 MediaImports.prototype.prepare=async function(...args){entered();await gate;return prepare.apply(this,args);};
 try{
  await page.goto(app.url);await navigate(page,'Website editor');await editorTab(page,'Media');await page.getByLabel('Upload an original file',{exact:true}).setInputFiles({name:'delayed.img',mimeType:'application/octet-stream',buffer:Buffer.from('only explicitly placed')});await started;
  await page.locator('.website-site-context').getByRole('button',{name:'Websites',exact:true}).click();await page.getByRole('button',{name:'New website',exact:true}).click();await page.getByLabel('Website name',{exact:true}).fill('Another site');await page.getByRole('button',{name:'Create website',exact:true}).click();await expect(page.locator('.website-site-context')).toContainText('Another site');await editorTab(page,'Media');
  release();await expect(page.locator('#notice')).toContainText('Media is ready');await expect(page.locator('[data-library-asset]')).toHaveCount(0);await expect(page.getByRole('button',{name:'Save website',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'File imports',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:'Use file',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Use file',exact:true}).click();await expect(page.locator('.website-file-name')).toContainText('delayed.img');await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  const sites=new WebsiteSites(f.workspace),named=(await sites.list()).sites.find(site=>site.name==='Another site');expect((await sites.read(null)).book.website.assets).toHaveLength(0);expect((await sites.read(named.id)).book.website.assets.map(a=>a.name)).toEqual(['delayed.img']);
 }finally{release();MediaImports.prototype.prepare=prepare;await app.close();clearVault(f.vault);await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
