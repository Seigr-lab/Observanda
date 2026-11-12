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
import {websiteUpgradeStatus} from '../../src/website-files-migration.js';
import {navigate} from './preferences-helper.js';

// Signing in prepares the workspace's saved website as its own activity. Once it
// is ready, Publishing opens that website's publishing destination; the folder
// export is a publication tool of the website files editor.
async function signedIn(page,app,f){
 await page.goto(app.url);await page.getByRole('button',{name:'Menu',exact:true}).waitFor({state:'visible'});
 await expect.poll(async()=>(await websiteUpgradeStatus(f.workspace)).state,{timeout:60000}).toBe('ready');
}
async function folderExport(page){
 await navigate(page,'Publishing');const files=page.locator('#main[data-website-files-app]');
 await files.getByRole('button',{name:'Return to editing',exact:true}).click({timeout:60000});
 await files.getByRole('button',{name:'Publish to folder',exact:true}).click({timeout:60000});
 const panel=files.locator('[data-folder-review-panel]');await expect(panel).toBeVisible();return panel;
}
const confirm=panel=>panel.getByLabel('I have reviewed this pinned edition and approve these file additions, updates and removals in the selected folder.');
const control=(panel,name)=>panel.getByRole('button',{name,exact:true});

test('Publishing exports through folder review, preserves existing pages, and invalidates confirmation when the folder changes',async({page})=>{
 test.setTimeout(150000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-export-ui-')),destination=path.join(directory,'site'),book=sampleNotebook();book.entries[1].share=false;book.entries[1].title='PRIVATE_EXPORT_SENTINEL';
 const f=await encryptedFixture(directory,book);await mkdir(destination);await writeFile(path.join(destination,'unrelated.html'),'Unrelated page');
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),folderPicker:{capabilities:async()=>({mode:'native'}),choose:async()=>({folder:destination})}}),requests=[];
 page.on('request',request=>{if(request.url().includes('/api/workspace/read/page'))requests.push(request.url());});
 try{
  await signedIn(page,app,f);const panel=await folderExport(page),folder=panel.getByLabel('Destination folder',{exact:true}),write=control(panel,'Write reviewed files');
  await control(panel,'Choose folder').click();await expect(folder).toHaveValue(destination);
  await control(panel,'Review file changes').click();await expect(confirm(panel)).toBeEnabled({timeout:60000});await page.screenshot({path:test.info().outputPath('local-export-review.png')});
  // Writing stays unavailable until the author confirms this review.
  await expect(write).toBeDisabled();await confirm(panel).check();await expect(write).toBeEnabled();
  await folder.fill(path.join(directory,'another'));await expect(write).toHaveCount(0);
  await folder.fill(destination);await control(panel,'Review file changes').click();await expect(confirm(panel)).not.toBeChecked({timeout:60000});await expect(write).toBeDisabled();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');await confirm(panel).check();await write.click();await expect(panel.getByText('Edition written and verified.',{exact:true})).toBeVisible({timeout:60000});
  expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await expect(page.getByRole('button',{name:'Return to editing',exact:true})).toBeVisible();await page.screenshot({path:test.info().outputPath('local-export-narrow.png')});
  expect(await readFile(path.join(destination,'unrelated.html'),'utf8')).toBe('Unrelated page');expect(await readFile(path.join(destination,'index.html'),'utf8')).not.toContain('PRIVATE_EXPORT_SENTINEL');expect(requests).toEqual([]);
  // After a reload, publishing the update returns to the recorded folder, whose
  // receipt now matches every reviewed file.
  await page.getByRole('button',{name:'Return to editing',exact:true}).click();await expect(panel).toHaveCount(0);
  await page.setViewportSize({width:1280,height:720});await page.evaluate(()=>document.documentElement.style.fontSize='');await page.reload();
  await page.getByRole('button',{name:'Publish update',exact:true}).click({timeout:60000});await expect(folder).toHaveValue(destination,{timeout:60000});
  await expect(panel.getByText('Conflicts: 0',{exact:true})).toBeVisible({timeout:60000});await expect(panel.getByText(/^Unchanged: \d+$/)).toBeVisible();await expect(panel.getByText(/^Add: \d+$/)).toHaveCount(0);await expect(panel.getByText('No completed publication recorded',{exact:true})).toHaveCount(0);
  expect(await readFile(path.join(destination,'unrelated.html'),'utf8')).toBe('Unrelated page');
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('folder choice returns to the export and file review pages remain bounded',async({page})=>{
 test.setTimeout(150000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-export-folder-ui-')),destination=path.join(directory,'site'),chosen=path.join(destination,'lab-book'),book=sampleNotebook();book.pages=Array.from({length:50},(_,i)=>({id:randomUUID(),title:'Field station '+i,body:'Synthetic field notes',share:true}));
 const f=await encryptedFixture(directory,book);await mkdir(chosen,{recursive:true});let choices=0;
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),folderPicker:{capabilities:async()=>({mode:'native'}),choose:async()=>++choices===1?{cancelled:true}:{cancelled:false,folder:chosen}}});
 try{
  await signedIn(page,app,f);const panel=await folderExport(page),folder=panel.getByLabel('Destination folder',{exact:true}),rows=panel.locator('.website-folder-files li');
  // Leaving the folder chooser keeps the typed destination; choosing a folder replaces it.
  await folder.fill(destination);await control(panel,'Choose folder').click();await expect.poll(()=>choices).toBe(1);await expect(folder).toHaveValue(destination);
  await control(panel,'Choose folder').click();await expect(folder).toHaveValue(chosen);
  // The review shows six files at a time, whatever the size of the edition.
  await control(panel,'Review file changes').click();await expect(rows).toHaveCount(6,{timeout:60000});await expect(panel.getByText(/^Files 1.6 of \d+$/)).toBeVisible();
  await control(panel,'Next files').click();await expect(panel.getByText(/^Files 7.12 of \d+$/)).toBeVisible();expect(await rows.count()).toBeLessThanOrEqual(6);
  await control(panel,'Previous files').click();await expect(panel.getByText(/^Files 1.6 of \d+$/)).toBeVisible();await expect(rows).toHaveCount(6);
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('an interrupted export reopens after server restart, finishes from its journal and exposes later manual conflicts',async({page})=>{
 test.setTimeout(240000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-export-recovery-ui-')),destination=path.join(directory,'site'),f=await encryptedFixture(directory,sampleNotebook());await mkdir(destination);
 const options={root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')};let app=await startServer(options),once=true;const original=LocalExport.prototype.apply;
 LocalExport.prototype.apply=function(command){this.checkpoint=async stage=>{if(stage==='installed'&&once){once=false;throw Error('Interrupted file switch');}};return original.call(this,command);};
 try{
  await signedIn(page,app,f);let panel=await folderExport(page);
  await panel.getByLabel('Destination folder',{exact:true}).fill(destination);await control(panel,'Review file changes').click();await expect(confirm(panel)).toBeEnabled({timeout:60000});await confirm(panel).check();await control(panel,'Write reviewed files').click();
  await expect.poll(()=>once,{timeout:60000}).toBe(false);await expect(control(panel,'Write reviewed files')).toHaveCount(0);
  // Reviewing the folder again finds the journal of the interrupted edition.
  await control(panel,'Review file changes').click();await expect(control(panel,'Resume export')).toBeVisible({timeout:60000});
  await app.close();app=await startServer(options);await signedIn(page,app,f);panel=await folderExport(page);
  await panel.getByLabel('Destination folder',{exact:true}).fill(destination);await control(panel,'Review file changes').click();await expect(control(panel,'Resume export')).toBeDisabled({timeout:60000});
  await confirm(panel).check();await control(panel,'Resume export').click();await expect(panel.getByText('Edition written and verified.',{exact:true})).toBeVisible({timeout:60000});
  await writeFile(path.join(destination,'index.html'),'Manual homepage');await control(panel,'Review file changes').click();await expect(panel.getByText('Conflicts: 1',{exact:true})).toBeVisible({timeout:60000});
  // A conflicting review offers no approval or write; the manual page stays.
  await expect(confirm(panel)).toHaveCount(0);await expect(control(panel,'Write reviewed files')).toHaveCount(0);expect(await readFile(path.join(destination,'index.html'),'utf8')).toBe('Manual homepage');
 }finally{LocalExport.prototype.apply=original;await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('a delayed file review holds the editor until it arrives and a later review of the folder remains available',async({page})=>{
 test.setTimeout(150000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-export-late-ui-')),destination=path.join(directory,'site'),f=await encryptedFixture(directory,sampleNotebook());await mkdir(destination);
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});let release;const waiting=new Promise(resolve=>release=resolve);let reached;const ready=new Promise(resolve=>reached=resolve);
 try{
  await signedIn(page,app,f);let panel=await folderExport(page);await panel.getByLabel('Destination folder',{exact:true}).fill(destination);
  await page.context().route('**/api/website-files/folder/plan',async route=>{const response=await route.fetch();reached();await waiting;await route.fulfill({response});});
  // While the review is on its way the editor is busy: it cannot be closed under it.
  await control(panel,'Review file changes').click();await ready;await expect(page.getByRole('button',{name:'Return to editing',exact:true})).toBeDisabled();
  release();await expect(confirm(panel)).toBeEnabled({timeout:60000});await expect(confirm(panel)).not.toBeChecked();await expect(control(panel,'Write reviewed files')).toBeDisabled();await expect(panel.getByLabel('Destination folder',{exact:true})).toHaveValue(destination);
  await page.context().unroute('**/api/website-files/folder/plan');
  await page.getByRole('button',{name:'Return to editing',exact:true}).click();await expect(panel).toHaveCount(0);
  await page.getByRole('button',{name:'Publish to folder',exact:true}).click();panel=page.locator('[data-folder-review-panel]');await panel.getByLabel('Destination folder',{exact:true}).fill(destination);
  await control(panel,'Review file changes').click();await expect(control(panel,'Write reviewed files')).toBeDisabled({timeout:60000});await expect(confirm(panel)).not.toBeChecked();await expect(panel.getByLabel('Destination folder',{exact:true})).toHaveValue(destination);
 }finally{release();await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
