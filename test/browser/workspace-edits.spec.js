import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {WorkspaceEdits} from '../../src/workspace-edits.js';
import {workspaceSaveRequest} from '../../src/web/workspace-edits.js';
import {recordRevisions} from '../../src/research.js';
import {preferences,navigate} from './preferences-helper.js';
import {task} from './composer-helper.js';

const click=(scope,name)=>scope.getByRole('button',{name,exact:true}).click();
async function fixture(page,{formatVersion=21}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-authoring-ui-')),book=sampleNotebook();
 book.formatVersion=formatVersion;
 const {workspace:ws,vault,deviceStore}=await encryptedFixture(directory,book);
 const app=await startServer({root:ws.root,deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.method()==='POST'&&['/api/workspace/save','/api/notebook/save'].some(p=>r.url().endsWith(p)))requests.push({url:r.url(),data:r.postDataJSON()});});
 await page.goto(app.url);
 return {book,ws,app,errors,requests,async close(){await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true});}};
}
async function save(page,name){
 const waiting=page.waitForResponse(r=>r.url().endsWith('/api/workspace/save')&&r.request().method()==='POST');
 await click(page,name);const response=await waiting;expect(response.ok()).toBe(true);
 const data=await response.json();if(response.request().postDataJSON().response==='outline'){expect(data.outline).toBe(true);expect(data.book.entries).toEqual([]);expect(data.recordRevisions).toEqual({});expect(data.recordPatch).toBeUndefined();}else{expect(data.book).toBeUndefined();expect(data.recordPatch.order).toBeNull();}return data;
}
test('encrypted general, appearance and SVG branding forms persist without resending records',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page);
 try{
  await preferences(page,'General');const form=page.locator('#workspace-name-form');
  await form.getByLabel('Workspace name',{exact:true}).fill('Creative research studio');
  await form.getByLabel('Workspace introduction',{exact:true}).fill('A place for field notes and sound');
  await save(page,'Save workspace');await expect(page.locator('.workspace-name')).toHaveText('Creative research studio');
  await preferences(page,'Appearance');await page.getByLabel('Header alignment').selectOption('right');
  await page.getByLabel('Logo and title order').selectOption('title-first');
  await page.getByRole('button',{name:/Studio Spacious cards/}).click();await save(page,'Save appearance');
  await expect(page.locator('#save-status')).toHaveText('Saved');await click(page,'Logos & branding');
  await page.getByLabel('Add logo',{exact:true}).setInputFiles({name:'studio.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="teal"/></svg>')});
  await expect(page.locator('.logo-editor img')).toBeVisible();await expect(page.getByLabel('Add logo',{exact:true})).toBeEnabled();
  await save(page,'Save branding');await expect(page.locator('#save-status')).toHaveText('Saved');
  await click(page,'Back to Appearance');await page.reload();await expect(page.getByLabel('Header alignment')).toHaveValue('right');
  await expect(page.locator('.workspace-logo')).toBeVisible();const stored=(await f.ws.read()).book;
  expect(stored.title).toBe('Creative research studio');expect(stored.entries).toEqual(f.book.entries);
  expect(f.requests).toHaveLength(3);for(const r of f.requests){expect(r.url).toContain('/api/workspace/save');expect(r.data.changes).toEqual([]);expect(r.data.book).toBeUndefined();}
  expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
test('website selections, page creation and later drafts survive failed and in-flight sparse saves',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page);
 try{
  await navigate(page,'Website editor');await click(page,'Add page');
  await page.getByLabel('Page title',{exact:true}).fill('Public introduction');await page.getByLabel('Page introduction',{exact:true}).fill('Approved explanation');
  await task(page,'Content');const project=page.locator('[data-project-share]').first(),record=page.locator('[data-publish-entry]').first();
  await project.setChecked(!await project.isChecked());await record.setChecked(!await record.isChecked());
  await page.route('**/api/workspace/save',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic write failure'})}));
  await click(page,'Save website');await expect(page.locator('#notice')).toContainText('Synthetic write failure');
  expect((await f.ws.read()).book.pages).toEqual(f.book.pages);await page.unroute('**/api/workspace/save');
  let release;const waiting=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/workspace/save',async route=>{await waiting;await route.continue();});
  const response=page.waitForResponse(r=>r.url().endsWith('/api/workspace/save'));
  await click(page,'Save website');await expect(page.getByRole('button',{name:'Save website',exact:true})).toBeDisabled();
  await task(page,'Page');await page.getByLabel('Editing area',{exact:true}).selectOption('footer');await page.getByLabel('Footer text').fill('Typed while saving');release();
  expect((await response).ok()).toBe(true);await expect(page.locator('#save-status')).toHaveText('Unsaved changes');
  await page.unroute('**/api/workspace/save');await save(page,'Save website');await expect(page.locator('#save-status')).toHaveText('Saved');
  let stored=(await f.ws.read()).book;expect(stored.pages).toHaveLength(1);expect(stored.pages[0].title).toBe('Public introduction');expect(stored.website.footer).toBe('Typed while saving');
  expect(stored.projects[0].share).toBe(!f.book.projects[0].share);expect(stored.entries[0].share).toBe(!f.book.entries[0].share);
  const sent=f.requests[1].data;expect(sent.projects).toHaveLength(1);expect(sent.changes).toHaveLength(1);expect(sent.changes[0].id).toBe(f.book.entries[0].id);expect(sent.book).toBeUndefined();
  await page.reload();await expect(page.getByLabel('Footer text')).toHaveValue('Typed while saving');
  expect(f.requests.every(r=>r.url.endsWith('/api/workspace/save'))).toBe(true);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
test('stale preferences retain the draft and record deletion uses an explicit selected-record transaction',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page);
 try{
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='150%');
  await preferences(page,'General');await page.getByLabel('Workspace name',{exact:true}).fill('My pending title');
  const base=await f.ws.read(),draft=structuredClone(base.book);draft.description='Concurrent saved introduction';
  await new WorkspaceEdits(f.ws,{}).save({...workspaceSaveRequest(base.book,draft,recordRevisions(base.book)),baseEtag:base.etag});
  const waiting=page.waitForResponse(r=>r.url().endsWith('/api/workspace/save'));await click(page,'Save workspace');
  expect((await waiting).status()).toBe(409);await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue('My pending title');
  expect((await f.ws.read()).book.description).toBe('Concurrent saved introduction');
  await page.reload();await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue(f.book.title);
  await page.evaluate(id=>location.hash='#/records/'+id,f.book.entries[0].id);
  await expect(page.getByLabel('Record title',{exact:true})).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());
  const removal=page.waitForResponse(r=>r.url().endsWith('/api/research/records/remove'));await click(page,'Remove record');
  const deleted=await(await removal).json();expect(deleted.recordScope.missing).toEqual([f.book.entries[0].id]);expect(deleted.book.entries).toEqual([]);
  await page.reload();expect((await f.ws.read()).book.entries.some(e=>e.id===f.book.entries[0].id)).toBe(false);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('creating and reopening a record retains a bounded selection across record-only saves',async({page})=>{
 test.setTimeout(60000);const f=await fixture(page);
 try{
  await page.evaluate(id=>location.hash='#/notebooks/'+id,f.book.notebooks[0].id);
  await click(page,'New record');await click(page,'Create observation');
  await page.getByLabel('Record title',{exact:true}).fill('A first field observation');
  const waiting=page.waitForResponse(r=>r.url().endsWith('/api/research/records/save'));
  await click(page,'Save record');const response=await waiting;expect(response.ok()).toBe(true);
  const data=await response.json();expect(data.recordPatch).toBeUndefined();expect(data.book.entries).toHaveLength(1);
  expect(data.recordScope.ids).toEqual([data.book.entries[0].id]);await expect(page.locator('#save-status')).toHaveText('Saved');
  expect((await f.ws.read()).book.entries).toHaveLength(f.book.entries.length+1);
  await page.reload();await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('A first field observation');
  await page.getByLabel('Record title',{exact:true}).fill('Reviewed field observation');
  const again=page.waitForResponse(r=>r.url().endsWith('/api/research/records/save'));await click(page,'Save record');
  const revised=await(await again).json();expect(revised.recordScope.ids).toEqual(data.recordScope.ids);expect(revised.book.entries).toHaveLength(1);expect(revised.recordPatch).toBeUndefined();
  await expect(page.locator('#save-status')).toHaveText('Saved');expect((await f.ws.read()).book.entries.at(-1).title).toBe('Reviewed field observation');
  expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('an older catalogue saves its upgrade in place before using sparse authoring commands',async({page})=>{
 test.setTimeout(60000);const f=await fixture(page,{formatVersion:20});
 try{
  const initial=await f.ws.outline();expect(initial.metadata.formatVersion).toBe(20);
  await preferences(page,'General');await page.getByLabel('Workspace name',{exact:true}).fill('Existing research studio');
  const waiting=page.waitForResponse(r=>r.url().endsWith('/api/notebook/save'));
  await click(page,'Save workspace');expect((await waiting).ok()).toBe(true);
  await expect(page.locator('.workspace-name')).toHaveText('Existing research studio');
  expect((await f.ws.outline()).metadata.formatVersion).toBe(21);
  expect((await f.ws.catalogue(s=>s.read(initial.etag))).book.formatVersion).toBe(20);
  await page.getByLabel('Workspace introduction',{exact:true}).fill('Now using changes-only saves');
  const saved=await save(page,'Save workspace');expect(saved.outline?saved.book.entries:saved.recordPatch.records).toEqual([]);
  expect(f.requests).toHaveLength(2);expect(f.requests[0].url).toContain('/api/notebook/save');expect(f.requests[1].url).toContain('/api/workspace/save');
  expect((await f.ws.read()).book.description).toBe('Now using changes-only saves');
  await page.reload();await expect(page.getByLabel('Workspace introduction',{exact:true})).toHaveValue('Now using changes-only saves');
  expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
