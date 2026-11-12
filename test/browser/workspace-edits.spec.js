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
import {preferences} from './preferences-helper.js';
import {openRecordActions,setRecordTitle} from './record-editing-helper.js';
import {readProgressStream} from '../../src/web/progress-stream.js';
import {Workspace} from '../../src/storage.js';
import {workspaceCreationPath} from '../../src/workspace-names.js';

const click=(scope,name)=>scope.getByRole('button',{name,exact:true}).click();
async function fixture(page,{formatVersion=21}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-authoring-ui-')),book=sampleNotebook();
 book.formatVersion=formatVersion;
 const {workspace:ws,vault,deviceStore}=await encryptedFixture(directory,book);
 const app=await startServer({root:ws.root,deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const errors=[],requests=[],designs=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.method()==='POST'&&['/api/workspace/save','/api/notebook/save'].some(p=>r.url().endsWith(p)))requests.push({url:r.url(),data:r.postDataJSON()});if(r.method()==='POST'&&r.url().endsWith('/websites/editor/change'))designs.push(r.postDataJSON());});
 await page.goto(app.url);
 // The workspace name is its folder name: saving a new name renames the folder.
 const renamed=name=>new Workspace(workspaceCreationPath(path.dirname(ws.root),name),vault);
 return {book,ws,app,errors,requests,designs,renamed,async close(){await app.close();await clearVault(vault);await rm(directory,{recursive:true,force:true});}};
}
async function appLayout(page){
 await preferences(page,'App appearance');const layout=page.locator('details[data-disclosure="app-layout"]');
 if(!await layout.evaluate(node=>node.open))await layout.locator(':scope > summary').click();
}
// Record operations answer with a progress stream that ends with the result. A service
// worker carries API requests, so the page's own response has no readable body; the
// result is read from the service worker's fetch at the context, then passed on unchanged.
async function acknowledgement(page,path){
 let settle,fail;const result=new Promise((resolve,reject)=>{settle=resolve;fail=reject;});
 await page.context().route('**/api'+path,async route=>{
  const response=await route.fetch(),body=await response.body();
  try{settle(await readProgressStream(new Response(body),()=>{}));}catch(error){fail(error);}
  await route.fulfill({response,body});
 },{times:1});
 return {result};
}
const designChange=page=>page.waitForResponse(r=>r.url().endsWith('/websites/editor/change')&&r.request().method()==='POST');
const websiteSave=page=>page.waitForResponse(r=>r.url().endsWith('/websites/editor/save')&&r.request().method()==='POST');
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
  // A new name renames the workspace folder and reopens the workspace there.
  const renaming=page.waitForResponse(r=>r.url().endsWith('/api/storage/rename')&&r.request().method()==='POST');
  await save(page,'Save workspace');expect((await renaming).ok()).toBe(true);
  await expect(page.locator('.workspace-name')).toHaveText('Creative research studio',{timeout:30000});await expect(page.locator('#workspace-name-form')).toBeVisible();
  await appLayout(page);await page.getByLabel('Header alignment').selectOption('right');
  await page.getByLabel('Logo and title order').selectOption('title-first');
  const interfaceSave=page.waitForResponse(r=>r.url().endsWith('/api/interface')&&r.request().method()==='POST');await click(page,'Save app settings');expect((await interfaceSave).ok()).toBe(true);
  // Website design and branding belong to the website and save as website editor changes.
  await preferences(page,'Appearance');let design=designChange(page);await page.getByRole('button',{name:/Studio Spacious cards/}).click();expect((await design).ok()).toBe(true);
  // The checkpoint keeps an unsaved website draft; Save appearance publishes it into the website.
  await expect(page.locator('#save-status')).toHaveText('Unsaved changes');let commit=websiteSave(page);await click(page,'Save appearance');expect((await commit).ok()).toBe(true);
  await expect(page.locator('#save-status')).toHaveText('Saved');await click(page,'Logos & branding');
  design=designChange(page);await page.getByLabel('Add logo',{exact:true}).setInputFiles({name:'studio.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="teal"/></svg>')});
  await expect(page.locator('.logo-editor img')).toBeVisible();await expect(page.getByLabel('Add logo',{exact:true})).toBeEnabled();
  expect((await design).ok()).toBe(true);commit=websiteSave(page);await click(page,'Save branding');expect((await commit).ok()).toBe(true);await expect(page.locator('#save-status')).toHaveText('Saved');
  await click(page,'Back to Appearance');await page.reload();await appLayout(page);await expect(page.getByLabel('Header alignment')).toHaveValue('right');
  await preferences(page,'Appearance');await click(page,'Logos & branding');await expect(page.locator('.logo-editor img')).toBeVisible();
  const stored=(await f.renamed('Creative research studio').read()).book;
  expect(stored.title).toBe('Creative research studio');expect(stored.entries).toEqual(f.book.entries);
  expect(f.requests).toHaveLength(1);for(const r of f.requests){expect(r.url).toContain('/api/workspace/save');expect(r.data.changes).toEqual([]);expect(r.data.book).toBeUndefined();}
  expect(f.designs.length).toBeGreaterThanOrEqual(2);for(const d of f.designs){expect(d.book).toBeUndefined();for(const e of f.book.entries)expect(JSON.stringify(d)).not.toContain(e.body);}
  expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
test('stale preferences retain the draft and record deletion uses an explicit selected-record transaction',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page);
 try{
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='150%');
  await preferences(page,'General');await page.getByLabel('Workspace name',{exact:true}).fill('My pending title');await page.getByLabel('Workspace introduction',{exact:true}).fill('My pending introduction');
  const base=await f.ws.read(),draft=structuredClone(base.book);draft.description='Concurrent saved introduction';
  await new WorkspaceEdits(f.ws,{}).save({...workspaceSaveRequest(base.book,draft,recordRevisions(base.book)),baseEtag:base.etag});
  const waiting=page.waitForResponse(r=>r.url().endsWith('/api/workspace/save'));await click(page,'Save workspace');
  expect((await waiting).status()).toBe(409);await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue('My pending title');
  expect((await f.ws.read()).book.description).toBe('Concurrent saved introduction');
  await page.reload();await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue(path.basename(f.ws.root));
  await page.evaluate(id=>location.hash='#/records/'+id,f.book.entries[0].id);
  await expect(page.locator('main').getByRole('heading',{level:1,name:f.book.entries[0].title,exact:true})).toBeVisible();
  const remove=page.locator('.record-toolbar').getByRole('button',{name:'Remove record',exact:true});await openRecordActions(page);
  if(!await remove.isVisible()){await page.locator('main').getByRole('button',{name:'Edit record',exact:true}).click();await openRecordActions(page);}
  await remove.click();const removing=page.getByRole('dialog',{name:'Remove record',exact:true});
  const removal=await acknowledgement(page,'/research/records/remove');await removing.getByRole('button',{name:'Remove record',exact:true}).click();
  const deleted=await removal.result;expect(deleted.recordScope.missing).toEqual([f.book.entries[0].id]);expect(deleted.book.entries).toEqual([]);
  await page.reload();expect((await f.ws.read()).book.entries.some(e=>e.id===f.book.entries[0].id)).toBe(false);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('creating and reopening a record retains a bounded selection across record-only saves',async({page})=>{
 test.setTimeout(60000);const f=await fixture(page);
 try{
  await page.evaluate(id=>location.hash='#/notebooks/'+id,f.book.notebooks[0].id);
  await click(page,'New record');const choices=page.locator('#dialog'),general=choices.locator('details').filter({hasText:'General record types'});
  if(!await general.evaluate(element=>element.open))await choices.getByText('General record types',{exact:true}).click();await click(choices,'Create observation');
  await page.getByLabel('Record title',{exact:true}).fill('A first field observation');
  const waiting=page.waitForResponse(r=>r.url().endsWith('/api/research/drafts/review/apply')),applied=await acknowledgement(page,'/research/drafts/review/apply');
  await click(page,'Save record');const response=await waiting;expect(response.ok()).toBe(true);
  const data=await applied.result;expect(data.recordPatch).toBeUndefined();expect(data.book).toBeUndefined();expect(data.recordId).toBeTruthy();
  await expect(page.locator('main').getByRole('heading',{level:1,name:'A first field observation',exact:true})).toBeVisible();
  expect((await f.ws.read()).book.entries).toHaveLength(f.book.entries.length+1);
  await page.reload();await expect(page.locator('main').getByRole('heading',{level:1,name:'A first field observation',exact:true})).toBeVisible();
  const edit=page.locator('main').getByRole('button',{name:'Edit record',exact:true});if(await edit.isVisible())await edit.click();
  const again=await acknowledgement(page,'/research/records/values/save');await setRecordTitle(page,'Reviewed field observation');
  const revised=await again.result;expect(revised.book).toBeUndefined();expect(revised.recordPatch).toBeUndefined();
  expect((await f.ws.read()).book.entries.at(-1).title).toBe('Reviewed field observation');
  expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('an older catalogue saves its upgrade in place before using sparse authoring commands',async({page})=>{
 test.setTimeout(60000);const f=await fixture(page,{formatVersion:20});
 try{
  const initial=await f.ws.outline();expect(initial.metadata.formatVersion).toBe(20);
  await preferences(page,'General');await page.getByLabel('Workspace name',{exact:true}).fill('Existing research studio');await page.getByLabel('Workspace introduction',{exact:true}).fill('Upgraded in place');
  const waiting=page.waitForResponse(r=>r.url().endsWith('/api/notebook/save')),renaming=page.waitForResponse(r=>r.url().endsWith('/api/storage/rename')&&r.request().method()==='POST');
  await click(page,'Save workspace');expect((await waiting).ok()).toBe(true);expect((await renaming).ok()).toBe(true);
  await expect(page.locator('.workspace-name')).toHaveText('Existing research studio',{timeout:30000});await expect(page.locator('#workspace-name-form')).toBeVisible();const ws=f.renamed('Existing research studio');
  expect((await ws.outline()).metadata.formatVersion).toBe(21);
  expect((await ws.catalogue(s=>s.read(initial.etag))).book.formatVersion).toBe(20);
  await page.getByLabel('Workspace introduction',{exact:true}).fill('Now using changes-only saves');
  const saved=await save(page,'Save workspace');expect(saved.outline?saved.book.entries:saved.recordPatch.records).toEqual([]);
  expect(f.requests).toHaveLength(2);expect(f.requests[0].url).toContain('/api/notebook/save');expect(f.requests[1].url).toContain('/api/workspace/save');
  expect((await ws.read()).book.description).toBe('Now using changes-only saves');
  await page.reload();await expect(page.getByLabel('Workspace introduction',{exact:true})).toHaveValue('Now using changes-only saves');
  expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
