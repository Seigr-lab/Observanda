import setupMessages from '../../src/web/locales/en/setup.json' with {type:'json'};
import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {createAccess,takeCreatedVault} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {initializeLocation,workspaceManifest} from '../../src/locations.js';
import {testServer} from '../device-fixture.js';
import {preferences} from './preferences-helper.js';
import {randomUUID} from 'node:crypto';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {WorkspaceEdits} from '../../src/workspace-edits.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {SnapshotIndex} from '../../src/snapshot-index.js';

test('an older open editor saves alongside new and deleted records and retains typing during the reply',async({page})=>{
 test.setTimeout(90000);
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-old-editor-ui-')),root=path.join(parent,'workspace');
 const accessHeader=await createAccess('','synthetic concurrent editor password'),vault=takeCreatedVault(accessHeader),book=upgradeNotebook(sampleNotebook());
 for(const record of book.entries)record.attachments=[];
 await initializeLocation(root,book,accessHeader,vault);
 const workspace=new Workspace(root,vault),service=new ResearchRecords(workspace,{}),base=await workspace.read();
 const [edited,other,removed]=base.book.entries;
 const app=await testServer({root,port:0,preferencesFile:path.join(parent,'preferences.json')}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const prior={manifest:ResearchCatalogue.prototype.manifest,read:ResearchCatalogue.prototype.read},members=SnapshotIndex.prototype.members;
 let release=()=>{};
 try{
  await page.goto(app.url);await page.getByLabel('Password',{exact:true}).fill('synthetic concurrent editor password');
  await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText(book.title);
  await page.evaluate(id=>location.hash='#/records/'+id,edited.id);
  await page.getByLabel('Record title',{exact:true}).fill('My first saved edit');
  await expect(page.locator('[data-record-checkpoint]')).toContainText('Record draft checkpointed');
  let current=other,etag=base.etag;
  for(let i=0;i<70;i++){
   const result=await service.save({workspaceId:book.id,baseEtag:etag,changes:[{id:current.id,expectedRevision:recordRevision(current),record:{...current,title:'Concurrent take '+i}}]},{compact:true});
   current=result.recordPatch.records[0];etag=result.etag;
  }
  const added={...structuredClone(edited),id:randomUUID(),title:'A newly arrived record',sections:[],relations:[],figures:[]};
  const insertion=await service.save({workspaceId:book.id,baseEtag:etag,changes:[{id:added.id,expectedRevision:null,record:added}]},{compact:true});
  await new WorkspaceEdits(workspace,{}).save({workspaceId:book.id,baseEtag:insertion.etag,metadata:{},projects:[],changes:[],removed:[{id:removed.id,expectedRevision:recordRevision(removed)}]});
  // These guards cover the real save endpoint, not a mocked response.
  ResearchCatalogue.prototype.manifest=ResearchCatalogue.prototype.read=()=>{throw Error('Full workspace assembled while saving the open editor');};
  SnapshotIndex.prototype.members=()=>{throw Error('Full membership scanned while saving the open editor');};
  let requested;const started=new Promise(resolve=>requested=resolve),gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/research/records/save',async route=>{const response=await route.fetch();requested();await gate;await route.fulfill({response});});
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/research/records/save'));
  await page.getByRole('button',{name:'Save record',exact:true}).click();await started;
  await page.getByLabel('Record title',{exact:true}).fill('Typing while the save returns');release();
  const response=await responsePromise,result=await response.json();
  expect(response.status()).toBe(200);expect(result.recordPatch).toBeUndefined();expect(result.recordScope.ids).toEqual([edited.id]);
  expect(result.book.entries.map(r=>r.id)).toEqual([edited.id]);expect(result.recordScope.total).toBe(book.entries.length);
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Typing while the save returns');
  await expect(page.locator('#save-status')).toHaveText('Unsaved changes');
  await page.unroute('**/api/research/records/save');
  await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  Object.assign(ResearchCatalogue.prototype,prior);SnapshotIndex.prototype.members=members;
  await page.evaluate(id=>location.hash='#/records/'+id,added.id);
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('A newly arrived record');
  await page.evaluate(id=>location.hash='#/records/'+id,other.id);
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Concurrent take 69');
  const saved=await workspace.read();expect(saved.book.entries.some(r=>r.id===removed.id)).toBe(false);
  expect(saved.book.entries.find(r=>r.id===edited.id).title).toBe('Typing while the save returns');expect(errors).toEqual([]);
 }finally{
  release();Object.assign(ResearchCatalogue.prototype,prior);SnapshotIndex.prototype.members=members;
  await app.close();clearVault(vault);await rm(parent,{recursive:true,force:true});
 }
});

test('default transactional workspace saves, reopens in the same folder and restores record history',async({page})=>{
 test.setTimeout(60000);
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-catalogue-ui-')),root=path.join(parent,'workspace');
 const access=await createAccess('','synthetic catalogue browser password'),vault=takeCreatedVault(access),book=upgradeNotebook(sampleNotebook());
 book.entries[0].attachments=[];book.entries[0].title='Initial creative take';
 await initializeLocation(root,book,access,vault);
 const workspace=new Workspace(root,vault),options={root,port:0,preferencesFile:path.join(parent,'preferences.json')};
 let app=await testServer(options);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 async function unlock(){
  await page.goto(app.url);await page.getByLabel('Password',{exact:true}).fill('synthetic catalogue browser password');
  await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText(book.title);
 }
 try{
  await unlock();
  expect(await workspace.storageKind()).toBe('catalogue');
  const initial=await workspaceManifest(root);
  await preferences(page,'Storage & access');
  await expect(page.getByRole('heading',{name:'Workspace storage',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Upgrade into a new copy',exact:true})).toHaveCount(0);
  expect(await workspaceManifest(root)).toEqual(initial);
  await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);
  await page.getByLabel('Record title',{exact:true}).fill('Revised creative take');
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/research/records/save'));
  await page.getByRole('button',{name:'Save record',exact:true}).click();
  const response=await responsePromise;
  expect(response.status()).toBe(200);const result=await response.json();expect(result.recordScope.ids).toEqual([book.entries[0].id]);expect(result.book.entries).toHaveLength(1);
  await expect(page.locator('#save-status')).toHaveText('Saved');
  const saved=await workspace.read(),files=await workspaceManifest(root);
  await app.close();app=await testServer(options);
  await unlock();
  expect(await workspace.read()).toEqual(saved);
  expect(await workspaceManifest(root)).toEqual(files);
  await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Revised creative take');
  await page.getByRole('button',{name:'History',exact:true}).click();
  const dialog=page.locator('#dialog');
  await dialog.getByRole('button',{name:'Review version',exact:true}).click();
  await expect(dialog).toContainText('Initial creative take');
  await page.setViewportSize({width:390,height:844});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await dialog.getByRole('button',{name:'Restore this version',exact:true}).click();
  await dialog.getByRole('button',{name:'Restore record',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Initial creative take');
  expect((await workspace.read()).book.entries[0].share).toBe(false);
  // A late settings response cannot remove the editor or its unsaved draft.
  await page.setViewportSize({width:1280,height:900});
  let release,requested;
  const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>requested=resolve);
  await page.route('**/api/storage',async route=>{
   const response=await route.fetch();requested();await gate;await route.fulfill({response});
  });
  try{
   await preferences(page,'Storage & access');await started;
   await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);
   await page.getByLabel('Record title',{exact:true}).fill('Draft survives late settings');
   const delivered=page.waitForResponse(r=>r.url().endsWith('/api/storage'));
   release();await (await delivered).finished();
   await page.getByRole('button',{name:'Save record',exact:true}).click();
   await expect(page.locator('#save-status')).toHaveText('Saved');
   expect((await workspace.read()).book.entries[0].title).toBe('Draft survives late settings');
  }finally{release();await page.unroute('**/api/storage');}
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(vault);await rm(parent,{recursive:true,force:true});}
});


test('encrypted PostgreSQL copies are verified, opened and edited independently through Storage',async({page})=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-pg-copy-ui-')),root=path.join(parent,'original'),destination=path.join(parent,'copy');
 const accessHeader=await createAccess('','synthetic PostgreSQL browser password'),vault=takeCreatedVault(accessHeader),book=upgradeNotebook(sampleNotebook());
 book.entries[0].attachments=[];await initializeLocation(root,book,accessHeader,vault);
 const original=new Workspace(root,vault),before=await original.read(),app=await testServer({root,port:0,preferencesFile:path.join(parent,'preferences.json')});
 try{
  await page.goto(app.url);await page.getByLabel('Password',{exact:true}).fill('synthetic PostgreSQL browser password');await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText(book.title);
  await preferences(page,'Storage & access');await expect(page.locator('main')).toContainText('PostgreSQL is connected.');
  await page.getByRole('button',{name:'Copy workspace to another folder',exact:true}).click();
  await page.getByLabel('Workspace folder',{exact:true}).fill(destination);
  await expect(page.getByRole('dialog')).toContainText('The original stays in its current folder');
  const copiedResponse=page.waitForResponse(response=>response.url().endsWith('/api/storage/copy')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Copy and use this folder',exact:true}).click();
  expect((await copiedResponse).ok()).toBe(true);await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.notice')).toContainText('Verified copy opened');
  const copied=new Workspace(destination,vault);expect(await copied.read()).toEqual(before);
  const binding=async folder=>JSON.parse(await readFile(path.join(folder,'.observanda','research.observanda'),'utf8'));
  expect((await binding(root)).id).not.toBe((await binding(destination)).id);
  await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);
  await page.getByLabel('Record title',{exact:true}).fill('Independent restored take');await page.getByRole('button',{name:'Save record',exact:true}).click();
  await expect(page.locator('#save-status')).toHaveText('Saved');
  expect((await copied.read()).book.entries[0].title).toBe('Independent restored take');expect(await original.read()).toEqual(before);
 }finally{await app.close();clearVault(vault);await rm(parent,{recursive:true,force:true});}
});

test('unconfigured PostgreSQL shows an actionable setup error and leaves the chosen folder untouched',async({page})=>{
 const previous=process.env.OBSERVANDA_DATABASE_URL;delete process.env.OBSERVANDA_DATABASE_URL;
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-pg-setup-ui-')),root=path.join(parent,'workspace');let app;
 try{
  app=await testServer({root,port:0,preferencesFile:path.join(parent,'preferences.json')});await page.goto(app.url);
  await page.getByLabel('Workspace name',{exact:true}).fill('Kept setup draft');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.locator('[data-setup-step]:visible')).toContainText(setupMessages.databaseUnavailable);
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();
  await expect(page.locator('.setup-error')).toContainText('OBSERVANDA_DATABASE_URL');
  await expect(page.getByRole('button',{name:'Create workspace',exact:true})).toBeEnabled();
  await expect(page.getByLabel('Workspace folder',{exact:true})).toHaveValue(root);
  await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('button',{name:'Back',exact:true}).click();await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue('Kept setup draft');
  await expect(access(root)).rejects.toMatchObject({code:'ENOENT'});
 }finally{if(previous===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=previous;await app?.close();await rm(parent,{recursive:true,force:true});}
});

test('record history pages are usable by keyboard, remain stable across saves and restore a single version',async({page})=>{
 test.setTimeout(60000);
 const {ResearchRecords,recordRevision}=await import('../../src/research.js');
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-history-pages-ui-')),root=path.join(parent,'workspace');
 const accessHeader=await createAccess('','synthetic history browser password'),vault=takeCreatedVault(accessHeader),book=upgradeNotebook(sampleNotebook());
 book.entries[0].title='Material study 0';book.entries[0].attachments=[];
 await initializeLocation(root,book,accessHeader,vault);
 const workspace=new Workspace(root,vault),service=new ResearchRecords(workspace,{});let saved=await workspace.read(),record=saved.book.entries[0],etag=saved.etag;
 for(let i=1;i<45;i++){
  const result=await service.save({workspaceId:book.id,baseEtag:etag,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Material study '+i}}]},{compact:true});
  record=result.recordPatch.records[0];etag=result.etag;
 }
 const app=await testServer({root,port:0,preferencesFile:path.join(parent,'preferences.json')}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await page.getByLabel('Password',{exact:true}).fill('synthetic history browser password');await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText(book.title);
  await page.evaluate(id=>location.hash='#/records/'+id,record.id);
  await page.getByRole('button',{name:'History',exact:true}).click();const dialog=page.locator('#dialog');
  await expect(dialog).toContainText('Versions 1-20 of 45');await expect(dialog.locator('.record-history-list li')).toHaveCount(20);
  await expect(dialog.getByRole('button',{name:'Newer versions',exact:true})).toBeDisabled();
  // A second writer must neither reorder the open history nor lose its edit on restore.
  const other=(await workspace.read()).book.entries[1];
  await service.save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Latest material study'}},{id:other.id,expectedRevision:recordRevision(other),record:{...other,title:'Concurrent field record'}}]});
  await dialog.getByRole('button',{name:'Older versions',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(dialog).toContainText('Versions 21-40 of 45');await expect(dialog).toContainText('Newer changes have been saved.');
  await expect(dialog.getByRole('heading',{name:'Record history',exact:true})).toBeFocused();
  await dialog.getByRole('button',{name:'Review version',exact:true}).first().click();await expect(dialog).toContainText('Material study 24');
  await dialog.getByRole('button',{name:'Back to history',exact:true}).click();await expect(dialog).toContainText('Versions 21-40 of 45');
  await dialog.getByRole('button',{name:'Newer versions',exact:true}).click();await expect(dialog).toContainText('Versions 1-20 of 45');
  await dialog.getByRole('button',{name:'Refresh history',exact:true}).click();await expect(dialog).toContainText('Versions 1-20 of 46');
  await expect(dialog.getByRole('button',{name:'View current',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await dialog.getByRole('button',{name:'Older versions',exact:true}).click();await expect(dialog).toContainText('Versions 21-40 of 46');
  await dialog.getByRole('button',{name:'Older versions',exact:true}).click();await expect(dialog).toContainText('Versions 41-46 of 46');
  await expect(dialog.getByRole('button',{name:'Older versions',exact:true})).toBeDisabled();
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await dialog.getByRole('button',{name:'Review version',exact:true}).last().click();await expect(dialog).toContainText('Material study 0');
  await dialog.getByRole('button',{name:'Restore this version',exact:true}).click();
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/research/records/history/restore'));
  await dialog.getByRole('button',{name:'Restore record',exact:true}).click();const response=await responsePromise,result=await response.json();
  expect(response.status()).toBe(200);expect(result.recordPatch).toBeUndefined();expect(result.recordScope.ids).toEqual([record.id]);expect(result.book.entries.map(r=>r.id)).toEqual([record.id]);
  await expect(dialog).not.toBeVisible();await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Material study 0');
  saved=await workspace.read();expect(saved.book.entries[0].share).toBe(false);expect(saved.book.entries[1].title).toBe('Concurrent field record');
  await page.evaluate(id=>location.hash='#/records/'+id,other.id);await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Concurrent field record');
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(vault);await rm(parent,{recursive:true,force:true});}
});
