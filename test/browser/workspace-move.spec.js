import {test,expect} from '@playwright/test';
import {mkdtemp,rm,access,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {preferences} from './preferences-helper.js';
import {readPreferences} from '../../src/preferences.js';
import {catalogueBinding} from '../../src/postgres-activation.js';
import {Workspace} from '../../src/storage.js';

test('Move starts from one action, survives a lost completion response, and leaves one usable workspace',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-move-browser-')),f=await encryptedFixture(directory,sampleNotebook()),destination=path.join(directory,'moved'),preferencesFile=path.join(directory,'preferences');
 const before=await catalogueBinding(f.workspace.root),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile});let transfers=0;
 try{
  await page.goto(app.url);await preferences(page,'Storage & access');
  await expect(page.getByRole('button',{name:'Copy workspace to another folder',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Move workspace to another folder',exact:true}).click();
  const dialog=page.locator('#dialog');await dialog.getByLabel('Workspace folder',{exact:true}).fill(destination);
  await expect(dialog.getByRole('button',{name:/Review/})).toHaveCount(0);await expect(dialog).toContainText('removes the original workspace folder');
  await expect(access(destination)).rejects.toMatchObject({code:'ENOENT'});
  await page.route('**/api/storage/move',async route=>{transfers++;const result=await route.fetch();expect(result.ok()).toBe(true);await route.abort('connectionreset');});
  await dialog.getByRole('button',{name:'Move and use this folder',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:45000});
  await expect(page.locator('.notice')).toContainText('Workspace moved and verified. The original folder has been removed.');
  expect(transfers).toBe(1);await expect(access(f.workspace.root)).rejects.toMatchObject({code:'ENOENT'});expect(await catalogueBinding(destination)).toEqual(before);
  const remembered=await readPreferences(preferencesFile);expect(remembered.workspace).toBe(destination);expect(remembered.recent.some(item=>item.path===f.workspace.root)).toBe(false);
  await preferences(page,'Storage & access');await expect(page.locator('.storage-path').first()).toHaveText(destination);await page.reload();await expect(page.locator('.workspace-name')).toHaveText('moved');
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('unfinished source cleanup is visible and retry completes without another transfer',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-move-retry-ui-')),f=await encryptedFixture(directory,sampleNotebook()),destination=path.join(directory,'moved'),original=path.join(f.workspace.root,'.observanda','evidence.bin');
 await writeFile(original,'Reviewed evidence');const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore}),outline=Workspace.prototype.outline;let changed=false,transfers=0;
 Workspace.prototype.outline=async function(...args){const result=await outline.apply(this,args);if(this.root===destination&&!changed){changed=true;await writeFile(original,'Changed source evidence');}return result;};
 try{
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/storage/move')transfers++;});
  await page.goto(app.url);await preferences(page,'Storage & access');await page.getByRole('button',{name:'Move workspace to another folder',exact:true}).click();
  const dialog=page.locator('#dialog');await dialog.getByLabel('Workspace folder',{exact:true}).fill(destination);await dialog.getByRole('button',{name:'Move and use this folder',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Finish removing the original workspace',exact:true})).toBeVisible({timeout:45000});await expect(dialog).toContainText('The original changed after it was copied');
  expect(await readFile(original,'utf8')).toBe('Changed source evidence');await writeFile(original,'Reviewed evidence');
  await dialog.getByRole('button',{name:'Retry original cleanup',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:30000});expect(transfers).toBe(1);await expect(access(f.workspace.root)).rejects.toMatchObject({code:'ENOENT'});
 }finally{Workspace.prototype.outline=outline;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('storage progress keeps dialog bounds stable across long paths, wrapped counters and unknown totals',async({page})=>{
 test.setTimeout(60000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-progress-layout-')),f=await encryptedFixture(directory,sampleNotebook()),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});
 try{
  await page.goto(app.url);await expect(page.locator('.workspace-name')).toHaveText(path.basename(f.workspace.root));
  for(const viewport of [{width:1440,height:1000,font:17},{width:760,height:900,font:24},{width:390,height:844,font:17}]){
   await page.setViewportSize(viewport);await page.evaluate(async font=>{
    document.documentElement.style.fontSize=font+'px';const dialog=document.querySelector('#dialog');dialog.innerHTML='<form><h2>Workspace transfer</h2><p>Source and destination</p><button type="submit">Continue</button></form>';dialog.showModal();
    const {storageProgress}=await import('/storage-progress.js');window.testProgress=storageProgress();
   },viewport.font);
   let first;
   for(const [i,stage] of ['copy-file','verify-file','database-inventory','verify-history','copy-workspace'].entries()){
    await page.evaluate(({stage,i})=>window.testProgress.update({stage,stages:['copy-workspace',stage],item:i%2?'nested/'.repeat(80)+'evidence.img':'',completed:57475072,unit:i%2?'rows':'bytes',...(i%2?{}:{total:67108900}),transfer:{phase:i%2?'verifying':'copying',files:19704,totalFiles:19904,bytes:11000000000,totalBytes:27110680000}}),{stage,i});
    const bounds=await page.locator('#dialog').boundingBox();if(first)expect(bounds).toEqual(first);else first=bounds;
    expect(await page.locator('.storage-progress').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await expect(page.locator('.storage-progress')).not.toContainText('Stored objects');await expect(page.locator('[data-wait]')).toHaveText('');
   }
   await page.evaluate(()=>window.testProgress.update({stage:'read-archive',stages:['preparing','copy-workspace','transfer-database','read-archive'],completed:26080000,total:8100000000,unit:'bytes',activity:{objects:432},observedAt:10000,advancedAt:10000}));
   const progress=page.locator('.storage-progress');await expect(progress.getByRole('heading')).toHaveText('Importing database records');
   await expect(progress.locator('[data-path]')).toContainText("Transferring records directly to this workspace's database");
   await expect(progress.locator('[data-count]')).toContainText('Database archive processed:');await expect(progress.locator('[data-detail]')).toHaveText('Database rows imported: 432');
   await expect(progress.getByRole('progressbar')).toHaveAttribute('max','8100000000');await expect(progress.getByRole('progressbar')).toHaveAttribute('value','26080000');
   await expect(progress).not.toContainText('Current file:');await expect(progress).not.toContainText('does not copy');expect(await page.locator('#dialog').boundingBox()).toEqual(first);
   await page.evaluate(()=>window.testProgress.update({stage:'verify-file',stages:['copy-workspace','verify-file'],completed:10,unit:'bytes',observedAt:30000,advancedAt:10000}));
   await expect(page.locator('[data-wait]')).toContainText('No progress reported for');expect(await page.locator('#dialog').boundingBox()).toEqual(first);
   await page.locator('[data-item]').focus();expect(await page.locator('[data-item]').evaluate(el=>el.scrollHeight>=el.clientHeight)).toBe(true);
   await page.evaluate(()=>{window.testProgress.close();document.querySelector('#dialog').close();});
  }
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
