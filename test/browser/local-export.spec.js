import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {LocalExport} from '../../src/local-export.js';
import {clearVault} from '../../src/encryption.js';
import {navigate} from './preferences-helper.js';

async function review(page){await navigate(page,'Publishing');await page.getByRole('button',{name:'Review website',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible({timeout:20000});await page.getByLabel('I have reviewed this website and its media for sharing.').check();await page.getByRole('button',{name:'Export to local folder',exact:true}).click();await expect(page.locator('#local-export-folder')).toBeEnabled({timeout:30000});}
const confirm=dialog=>dialog.getByLabel('I have reviewed this pinned edition and approve these file additions, updates and removals in the selected folder.');

test('Publishing exports through folder review, preserves existing pages, and invalidates confirmation when the folder changes',async({page})=>{
 test.setTimeout(90000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-export-ui-')),destination=path.join(directory,'site'),book=sampleNotebook();book.entries[1].share=false;book.entries[1].title='PRIVATE_EXPORT_SENTINEL';
 const f=await encryptedFixture(directory,book);await mkdir(destination);await writeFile(path.join(destination,'unrelated.html'),'Unrelated page');
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),folderPicker:{capabilities:async()=>({mode:'native'}),choose:async()=>({folder:destination})}}),requests=[];
 page.on('request',request=>{if(request.url().includes('/api/workspace/read/page'))requests.push(request.url());});
 try{
  await page.goto(app.url);await review(page);const dialog=page.locator('#dialog');await dialog.getByRole('button',{name:'Choose folder',exact:true}).click();await expect(dialog.getByLabel('Destination folder')).toHaveValue(destination);
  await dialog.getByRole('button',{name:'Review file changes'}).click();await expect(dialog.getByRole('button',{name:'Write reviewed files'})).toBeEnabled({timeout:30000});await page.screenshot({path:test.info().outputPath('local-export-review.png')});
  await dialog.getByRole('button',{name:'Write reviewed files'}).click();await expect(dialog.getByRole('alert')).toContainText('Confirm the edition');
  await confirm(dialog).check();await dialog.getByLabel('Destination folder').fill(path.join(directory,'another'));await expect(dialog.getByRole('button',{name:'Write reviewed files'})).toHaveCount(0);
  await dialog.getByLabel('Destination folder').fill(destination);await dialog.getByRole('button',{name:'Review file changes'}).click();await expect(confirm(dialog)).not.toBeChecked();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');await confirm(dialog).check();await dialog.getByRole('button',{name:'Write reviewed files'}).click();await expect(dialog.getByText('Edition written and verified.',{exact:true})).toBeVisible({timeout:30000});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await expect(dialog.getByRole('button',{name:'Return to review'})).toBeInViewport();await page.screenshot({path:test.info().outputPath('local-export-narrow.png')});
  expect(await readFile(path.join(destination,'unrelated.html'),'utf8')).toBe('Unrelated page');expect(await readFile(path.join(destination,'index.html'),'utf8')).not.toContain('PRIVATE_EXPORT_SENTINEL');expect(requests).toEqual([]);
  await dialog.getByRole('button',{name:'Return to review'}).click();await page.reload();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible();await page.getByLabel('I have reviewed this website and its media for sharing.').check();await page.getByRole('button',{name:'Export to local folder'}).click();await expect(dialog.getByText('Edition written and verified.',{exact:true})).toBeVisible();
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('folder navigation returns to the export and file review pages remain bounded',async({page})=>{
 test.setTimeout(60000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-export-folder-ui-')),destination=path.join(directory,'site'),book=sampleNotebook();book.pages=Array.from({length:50},(_,i)=>({id:randomUUID(),title:'Field station '+i,body:'Synthetic field notes',share:true}));
 const f=await encryptedFixture(directory,book);await mkdir(destination);const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 try{
  await page.goto(app.url);await review(page);const dialog=page.locator('#dialog');await dialog.getByLabel('Destination folder').fill(destination);await dialog.getByRole('button',{name:'Choose folder',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Choose a folder on the server'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(dialog.getByRole('heading',{name:'Export to a local website folder'})).toBeVisible();await expect(dialog.getByLabel('Destination folder')).toHaveValue(destination);
  await dialog.getByRole('button',{name:'Choose folder',exact:true}).click();await dialog.getByRole('button',{name:'New folder',exact:true}).click();await dialog.getByLabel('New folder name').fill('lab-book');await dialog.getByRole('button',{name:'Create folder',exact:true}).click();await expect(dialog.locator('.folder-selection')).toContainText('lab-book');await dialog.getByRole('button',{name:'Use this folder'}).click();await expect(dialog.getByLabel('Destination folder')).toHaveValue(path.join(destination,'lab-book'));
  await dialog.getByRole('button',{name:'Review file changes'}).click();await expect(dialog.locator('.local-export-files li')).toHaveCount(50);await dialog.getByRole('button',{name:'Next files'}).click();await expect(dialog.getByText('Page 2',{exact:true})).toBeVisible();expect(await dialog.locator('.local-export-files li').count()).toBeLessThanOrEqual(50);await dialog.getByRole('button',{name:'Previous files'}).click();await expect(dialog.locator('.local-export-files li')).toHaveCount(50);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('an interrupted export reopens after server restart, finishes from its journal and exposes later manual conflicts',async({page})=>{
 test.setTimeout(150000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-export-recovery-ui-')),destination=path.join(directory,'site'),f=await encryptedFixture(directory,sampleNotebook());await mkdir(destination);
 const options={root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')};let app=await startServer(options),once=true;const original=LocalExport.prototype.apply;
 LocalExport.prototype.apply=function(command){this.checkpoint=async stage=>{if(stage==='installed'&&once){once=false;throw Error('Interrupted file switch');}};return original.call(this,command);};
 try{
  await page.goto(app.url);await review(page);const dialog=page.locator('#dialog');await dialog.getByLabel('Destination folder').fill(destination);await dialog.getByRole('button',{name:'Review file changes'}).click();await expect(confirm(dialog)).toBeEnabled({timeout:30000});await confirm(dialog).check();await dialog.getByRole('button',{name:'Write reviewed files'}).click();await expect(dialog.getByRole('button',{name:'Resume export'})).toBeEnabled({timeout:30000});
  await app.close();app=await startServer(options);await page.goto(app.url);await navigate(page,'Publishing');await page.getByRole('button',{name:'Website preparations'}).click();await dialog.getByRole('button',{name:'Open review'}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible();await page.getByLabel('I have reviewed this website and its media for sharing.').check();await page.getByRole('button',{name:'Export to local folder'}).click();await expect(dialog.getByRole('button',{name:'Resume export'})).toBeEnabled({timeout:30000});
  await confirm(dialog).check();await dialog.getByRole('button',{name:'Resume export'}).click();await expect(dialog.getByText('Edition written and verified.',{exact:true})).toBeVisible({timeout:30000});
  await writeFile(path.join(destination,'index.html'),'Manual homepage');await dialog.getByRole('button',{name:'Review file changes'}).click();await expect(dialog.getByText('Conflicts: 1',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Write reviewed files'})).toBeDisabled();expect(await readFile(path.join(destination,'index.html'),'utf8')).toBe('Manual homepage');
 }finally{LocalExport.prototype.apply=original;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('a delayed file review cannot reopen a closed dialog and its saved plan remains available',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-export-late-ui-')),destination=path.join(directory,'site'),f=await encryptedFixture(directory,sampleNotebook());await mkdir(destination);
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});let release;const waiting=new Promise(resolve=>release=resolve);let reached;const ready=new Promise(resolve=>reached=resolve);
 try{
  await page.goto(app.url);await review(page);const dialog=page.locator('#dialog');await dialog.getByLabel('Destination folder').fill(destination);
  await page.route('**/api/local-export/plan',async route=>{const response=await route.fetch();reached();await waiting;await route.fulfill({response});});
  await dialog.getByRole('button',{name:'Review file changes'}).click();await ready;await dialog.getByRole('button',{name:'Return to review'}).click();release();await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'Export to local folder'}).click();await expect(dialog.getByRole('button',{name:'Write reviewed files'})).toBeEnabled({timeout:30000});await expect(confirm(dialog)).not.toBeChecked();await expect(dialog.getByLabel('Destination folder')).toHaveValue(destination);
 }finally{release();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
