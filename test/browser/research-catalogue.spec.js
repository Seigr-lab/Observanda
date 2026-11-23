import setupMessages from '../../src/web/locales/en/setup.json' with {type:'json'};
import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {initializeLocation,workspaceManifest} from '../../src/locations.js';
import {testServer,TestDeviceStore} from '../device-fixture.js';
import {preferences} from './preferences-helper.js';
import {randomUUID} from 'node:crypto';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {WorkspaceEdits} from '../../src/workspace-edits.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {SnapshotIndex} from '../../src/snapshot-index.js';
import valueMessages from '../../src/web/locales/en/recordValues.json' with {type:'json'};
import historyMessages from '../../src/web/locales/en/recordHistory.json' with {type:'json'};

// A saved record opens in its editing view; each detail, such as the title,
// is edited and saved in its own dialog.
const recordHeading=page=>page.locator('.record-title-row h1');
async function editTitle(page,title){
 await page.getByRole('button',{name:valueMessages.edit_title,exact:true}).click();
 const editor=page.getByRole('dialog',{name:valueMessages.edit_title,exact:true});
 await editor.getByLabel(valueMessages.title,{exact:true}).fill(title);
 await expect(editor.locator('[data-writing-status]')).toHaveText(valueMessages.checkpointed);
 return editor;
}
const valueSave=response=>response.url().endsWith('/api/research/records/values/save')&&response.request().method()==='POST';
// Replies may stream progress lines before a final {result} line, and the page can move on before a
// finished body is readable, so read each reply as it passes through.
const replyResult=text=>{const lines=text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));return lines.some(line=>'result' in line||'progress' in line)?lines.find(line=>'result' in line)?.result:lines[0];};
const captureReply=(page,glob)=>new Promise(resolve=>page.context().route(glob,async route=>{const response=await route.fetch(),text=await response.text();resolve({status:response.status(),result:replyResult(text)});await route.fulfill({response,body:text});},{times:1}));
// Opening a workspace prepares its staging namespace and, once, indexes earlier
// website sources in the background (src/staging-reservation-files.js,
// src/website-feed-discovery.js). Every other file must stay unchanged.
const productControlFiles=new Set(['.observanda/staging-reservations/namespace','.observanda/website-files/feed-owner-upgrade/complete.json']);
const manifest=async root=>(await workspaceManifest(root)).filter(file=>!productControlFiles.has(file.path));
const historyRange=(first,last,total)=>historyMessages.range.replace('{first}',first).replace('{last}',last).replace('{total}',total);

// A workspace's folder is its name: the app shows the folder name once the workspace is open.
test('an older open editor saves alongside new and deleted records and keeps the edit during the reply',async({page})=>{
 test.setTimeout(90000);
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-old-editor-ui-')),root=path.join(parent,'workspace');
 const accessHeader=await createWorkspaceAccess('','synthetic concurrent editor password',new TestDeviceStore({file:path.join(parent,'device.key')})),vault=takeCreatedVault(accessHeader),book=upgradeNotebook(sampleNotebook());
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
  await expect(page.locator('.workspace-name')).toHaveText(path.basename(root));
  await page.evaluate(id=>location.hash='#/records/'+id,edited.id);
  const editor=await editTitle(page,'My first saved edit');
  // Opening the workspace adopts its folder name as a new metadata revision.
  let current=other,etag=(await workspace.read()).etag;
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
  let reply;const replied=new Promise(resolve=>reply=resolve);
  await page.context().route('**/api/research/records/values/save',async route=>{const response=await route.fetch(),text=await response.text();requested();await gate;reply({status:response.status(),result:replyResult(text)});await route.fulfill({response,body:text});});
  await editor.getByRole('button',{name:valueMessages.save,exact:true}).click();await started;
  // The server has answered; the guards cover only the save itself, not the reader refresh after it.
  Object.assign(ResearchCatalogue.prototype,prior);SnapshotIndex.prototype.members=members;
  // While the reply is held the edit stays in place and cannot be changed or lost.
  await expect(editor.locator('[data-writing-fields]')).toHaveAttribute('inert','');
  await expect(editor.getByLabel(valueMessages.title,{exact:true})).toHaveValue('My first saved edit');
  await expect(editor.locator('[data-writing-status]')).toHaveText(valueMessages.saving);
  release();
  const {status,result}=await replied;
  expect(status).toBe(200);expect(result.saved).toBe(true);expect(result.recordPatch).toBeUndefined();expect(result.book).toBeUndefined();
  await expect(editor).not.toBeVisible();await expect(recordHeading(page)).toHaveText('My first saved edit');
  await page.context().unroute('**/api/research/records/values/save');
  await page.evaluate(id=>location.hash='#/records/'+id,added.id);
  await expect(recordHeading(page)).toHaveText('A newly arrived record');
  await page.evaluate(id=>location.hash='#/records/'+id,other.id);
  await expect(recordHeading(page)).toHaveText('Concurrent take 69');
  const saved=await workspace.read();expect(saved.book.entries.some(r=>r.id===removed.id)).toBe(false);
  expect(saved.book.entries.find(r=>r.id===edited.id).title).toBe('My first saved edit');expect(errors).toEqual([]);
 }finally{
  release();Object.assign(ResearchCatalogue.prototype,prior);SnapshotIndex.prototype.members=members;
  await app.close();await clearVault(vault);await rm(parent,{recursive:true,force:true});
 }
});

test('default transactional workspace saves, reopens in the same folder and restores record history',async({page})=>{
 test.setTimeout(60000);
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-catalogue-ui-')),root=path.join(parent,'workspace');
 const access=await createWorkspaceAccess('','synthetic catalogue browser password',new TestDeviceStore({file:path.join(parent,'device.key')})),vault=takeCreatedVault(access),book=upgradeNotebook(sampleNotebook());
 book.entries[0].attachments=[];book.entries[0].title='Initial creative take';
 await initializeLocation(root,book,access,vault);
 const workspace=new Workspace(root,vault),options={root,port:0,preferencesFile:path.join(parent,'preferences.json')};
 let app=await testServer(options);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 async function unlock(){
  await page.goto(app.url);await page.getByLabel('Password',{exact:true}).fill('synthetic catalogue browser password');
  await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText(path.basename(root));
 }
 try{
  await unlock();
  const initial=await manifest(root);
  await preferences(page,'Storage & access');
  await expect(page.getByRole('heading',{name:'Workspace storage',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Upgrade into a new copy',exact:true})).toHaveCount(0);
  expect(await manifest(root)).toEqual(initial);
  await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);
  const editor=await editTitle(page,'Revised creative take');
  const reply=captureReply(page,'**/api/research/records/values/save');
  await editor.getByRole('button',{name:valueMessages.save,exact:true}).click();
  const {status,result}=await reply;
  expect(status).toBe(200);expect(result.saved).toBe(true);expect(result.book).toBeUndefined();
  await expect(editor).not.toBeVisible();await expect(recordHeading(page)).toHaveText('Revised creative take');
  const saved=await workspace.read(),files=await manifest(root);
  await app.close();app=await testServer(options);
  await unlock();
  expect(await workspace.read()).toEqual(saved);
  expect(await manifest(root)).toEqual(files);
  await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);
  await expect(recordHeading(page)).toHaveText('Revised creative take');
  await page.getByRole('button',{name:historyMessages.button,exact:true}).click();
  const dialog=page.locator('#dialog');
  await dialog.getByRole('button',{name:historyMessages.review,exact:true}).click();
  await expect(dialog).toContainText('Initial creative take');
  await page.setViewportSize({width:390,height:844});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await dialog.getByRole('button',{name:historyMessages.restoreVersion,exact:true}).click();
  await dialog.getByRole('button',{name:historyMessages.restore,exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await expect(recordHeading(page)).toHaveText('Initial creative take');
  expect((await workspace.read()).book.entries[0].share).toBe(false);
  // A late settings response cannot remove the editor or its unsaved draft.
  await page.setViewportSize({width:1280,height:900});
  let release,requested;
  const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>requested=resolve);
  await page.context().route('**/api/storage',async route=>{
   const response=await route.fetch();requested();await gate;await route.fulfill({response});
  });
  try{
   await preferences(page,'Storage & access');await started;
   await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);
   const lateEditor=await editTitle(page,'Draft survives late settings');
   const delivered=page.waitForResponse(r=>r.url().endsWith('/api/storage'));
   release();await (await delivered).finished();
   await expect(lateEditor.getByLabel(valueMessages.title,{exact:true})).toHaveValue('Draft survives late settings');
   await lateEditor.getByRole('button',{name:valueMessages.save,exact:true}).click();
   await expect(lateEditor).not.toBeVisible();await expect(recordHeading(page)).toHaveText('Draft survives late settings');
   expect((await workspace.read()).book.entries[0].title).toBe('Draft survives late settings');
  }finally{release();await page.context().unroute('**/api/storage');}
  expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(vault);await rm(parent,{recursive:true,force:true});}
});


test('encrypted PostgreSQL copies are verified, opened and edited independently through Storage',async({page})=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-pg-copy-ui-')),root=path.join(parent,'original'),destination=path.join(parent,'copy');
 const accessHeader=await createWorkspaceAccess('','synthetic PostgreSQL browser password',new TestDeviceStore({file:path.join(parent,'device.key')})),vault=takeCreatedVault(accessHeader),book=upgradeNotebook(sampleNotebook());
 book.entries[0].attachments=[];await initializeLocation(root,book,accessHeader,vault);
 const original=new Workspace(root,vault),app=await testServer({root,port:0,preferencesFile:path.join(parent,'preferences.json')});
 try{
  await page.goto(app.url);await page.getByLabel('Password',{exact:true}).fill('synthetic PostgreSQL browser password');await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText(path.basename(root));
  // Opening adopts the folder name as the workspace name, so the baseline is the opened original.
  const before=await original.read();
  await preferences(page,'Storage & access');await expect(page.locator('main')).toContainText('PostgreSQL is connected.');
  await page.getByRole('button',{name:'Copy workspace to another folder',exact:true}).click();
  await page.getByLabel('Workspace folder',{exact:true}).fill(destination);
  await expect(page.getByRole('dialog')).toContainText('The original stays in its current folder');
  const copiedResponse=page.waitForResponse(response=>response.url().endsWith('/api/storage/copy')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Copy and use this folder',exact:true}).click();
  // The response streams while the copy backs up, restores and verifies its own database.
  expect((await copiedResponse).ok()).toBe(true);await expect(page.getByRole('dialog')).not.toBeVisible({timeout:60000});
  await expect(page.locator('.notice')).toContainText('Verified copy opened');
  // The opened copy takes its folder's name as a new metadata revision; its records and content are the original's.
  const copied=new Workspace(destination,vault),copy=await copied.read(),content=({title,revision,updatedAt,...rest})=>rest;
  expect(copy.book.title).toBe(path.basename(destination));expect(content(copy.book)).toEqual(content(before.book));
  const binding=async folder=>JSON.parse(await readFile(path.join(folder,'.observanda','research.observanda'),'utf8'));
  expect((await binding(root)).id).not.toBe((await binding(destination)).id);
  await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);
  const editor=await editTitle(page,'Independent restored take');await editor.getByRole('button',{name:valueMessages.save,exact:true}).click();
  await expect(editor).not.toBeVisible();await expect(recordHeading(page)).toHaveText('Independent restored take');
  expect((await copied.read()).book.entries[0].title).toBe('Independent restored take');expect(await original.read()).toEqual(before);
 }finally{await app.close();await clearVault(vault);await rm(parent,{recursive:true,force:true});}
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
  // Setup asks where to create the workspace; its folder takes the workspace's name.
  await expect(page.getByLabel(setupMessages.parentFolder,{exact:true})).toHaveValue(parent);
  await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('button',{name:'Back',exact:true}).click();await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue('Kept setup draft');
  await expect(access(root)).rejects.toMatchObject({code:'ENOENT'});
 }finally{if(previous===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=previous;await app?.close();await rm(parent,{recursive:true,force:true});}
});

test('record history pages are usable by keyboard, remain stable across saves and restore a single version',async({page})=>{
 test.setTimeout(60000);
 const {ResearchRecords,recordRevision}=await import('../../src/research.js');
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-history-pages-ui-')),root=path.join(parent,'workspace');
 const accessHeader=await createWorkspaceAccess('','synthetic history browser password',new TestDeviceStore({file:path.join(parent,'device.key')})),vault=takeCreatedVault(accessHeader),book=upgradeNotebook(sampleNotebook());
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
  await expect(page.locator('.workspace-name')).toHaveText(path.basename(root));
  await page.evaluate(id=>location.hash='#/records/'+id,record.id);
  await page.getByRole('button',{name:historyMessages.button,exact:true}).click();const dialog=page.locator('#dialog');
  await expect(dialog).toContainText(historyRange(1,20,45));await expect(dialog.locator('.record-history-list li')).toHaveCount(20);
  await expect(dialog.getByRole('button',{name:historyMessages.newer,exact:true})).toBeDisabled();
  // A second writer must neither reorder the open history nor lose its edit on restore.
  const other=(await workspace.read()).book.entries[1];
  await service.save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Latest material study'}},{id:other.id,expectedRevision:recordRevision(other),record:{...other,title:'Concurrent field record'}}]});
  await dialog.getByRole('button',{name:historyMessages.older,exact:true}).focus();await page.keyboard.press('Enter');
  await expect(dialog).toContainText(historyRange(21,40,45));await expect(dialog).toContainText(historyMessages.changed);
  await expect(dialog.getByRole('heading',{name:historyMessages.title,exact:true})).toBeFocused();
  await dialog.getByRole('button',{name:historyMessages.review,exact:true}).first().click();await expect(dialog).toContainText('Material study 24');
  await dialog.getByRole('button',{name:historyMessages.back,exact:true}).click();await expect(dialog).toContainText(historyRange(21,40,45));
  await dialog.getByRole('button',{name:historyMessages.newer,exact:true}).click();await expect(dialog).toContainText(historyRange(1,20,45));
  await dialog.getByRole('button',{name:historyMessages.refresh,exact:true}).click();await expect(dialog).toContainText(historyRange(1,20,46));
  await expect(dialog.getByRole('button',{name:historyMessages.viewCurrent,exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await dialog.getByRole('button',{name:historyMessages.older,exact:true}).click();await expect(dialog).toContainText(historyRange(21,40,46));
  await dialog.getByRole('button',{name:historyMessages.older,exact:true}).click();await expect(dialog).toContainText(historyRange(41,46,46));
  await expect(dialog.getByRole('button',{name:historyMessages.older,exact:true})).toBeDisabled();
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await dialog.getByRole('button',{name:historyMessages.review,exact:true}).last().click();await expect(dialog).toContainText('Material study 0');
  await dialog.getByRole('button',{name:historyMessages.restoreVersion,exact:true}).click();
  const reply=captureReply(page,'**/api/research/records/history/restore');
  await dialog.getByRole('button',{name:historyMessages.restore,exact:true}).click();const {status,result}=await reply;
  // The open reader restores with a receipt: only this record is written and no workspace is returned.
  expect(status).toBe(200);expect(result.historyReceipt).toBe(true);expect(result.saved).toBe(true);expect(result.recordPatch).toBeUndefined();expect(result.book).toBeUndefined();
  await expect(dialog).not.toBeVisible();await expect(recordHeading(page)).toHaveText('Material study 0');
  saved=await workspace.read();expect(saved.book.entries[0].share).toBe(false);expect(saved.book.entries[1].title).toBe('Concurrent field record');
  await page.evaluate(id=>location.hash='#/records/'+id,other.id);await expect(recordHeading(page)).toHaveText('Concurrent field record');
  expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(vault);await rm(parent,{recursive:true,force:true});}
});
