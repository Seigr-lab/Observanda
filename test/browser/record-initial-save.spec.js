import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {withRecordDocument} from '../../src/record-document.js';
import {proseText} from '../../src/web/prose-model.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {openRecordDetail,openRecordWriting} from './record-editing-helper.js';
import {revealInEditor} from './record-editor-helper.js';

// A new record is written on the record page as a draft: nothing is added to the lab book
// until Save record, and Discard record leaves nothing behind.
async function create(page,notebookId){
 await page.evaluate(id=>location.hash='#/notebooks/'+id,notebookId);await page.getByRole('button',{name:'New record',exact:true}).click();
 const dialog=page.locator('#dialog'),general=dialog.locator('details').filter({hasText:'General record types'});if(!await general.evaluate(element=>element.open))await dialog.getByText('General record types',{exact:true}).click();await dialog.getByRole('button',{name:'Create free-form note',exact:true}).click();
 await expect(page.getByRole('button',{name:'Save record',exact:true})).toBeVisible();return new URL(page.url()).hash.split('/')[2];
}
async function setTitle(page,title){
 const dialog=await openRecordDetail(page);await dialog.getByLabel('Record title',{exact:true}).fill(title);await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.locator('main h1').first()).toHaveText(title);
}
async function addSection(page,title,body){
 await page.getByRole('button',{name:'Add writing section',exact:true}).click();
 const dialog=page.locator('dialog.record-writing[open]');await expect(dialog.locator('.ProseMirror')).toBeVisible();
 await dialog.getByLabel('Section heading',{exact:true}).fill(title);await dialog.locator('.ProseMirror').fill(body);
 await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.locator('main')).toContainText(title);await expect(page.locator('main')).toContainText(body.slice(0,20));
}
const inspect=(workspace,id)=>workspace.catalogue(async store=>{const snapshot=await store.snapshot(),row=await store.member(snapshot,id);return {count:snapshot.count,row};});

test('a new record is written on the record page as a draft, saved once with a replayed acknowledgement, discarded or recovered',async({page})=>{
 test.setTimeout(240000);page.setDefaultTimeout(20000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-initial-record-')),book=upgradeNotebook(sampleNotebook());book.entries=[];
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),drafts=new ResearchDrafts(f.workspace);
 const errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{const route=new URL(request.url()).pathname;if(route.startsWith('/api/'))requests.push(route);});
 try{
  await page.goto(app.url);await expect(page.locator('.brand[data-action=workspace-refresh]')).toBeVisible();
  // Discard record removes the draft; the lab book never held the record.
  const cancelled=await create(page,book.notebooks[0].id);await setTitle(page,'Cancelled before Save');
  expect((await inspect(f.workspace,cancelled)).row).toBe(null);
  const discard=page.getByRole('button',{name:'Discard record',exact:true});await discard.click();await page.getByRole('button',{name:'Discard this new record?',exact:true}).click();
  await expect(page.getByRole('button',{name:'Save record',exact:true})).toHaveCount(0);
  expect((await inspect(f.workspace,cancelled)).row).toBe(null);expect((await drafts.list({workspaceId:book.id})).drafts).toEqual([]);

  // Title, sections and tags are written on the record page into the draft.
  const id=await create(page,book.notebooks[0].id);await setTitle(page,'River bank survey');
  // The draft being written is open, not waiting for recovery.
  await expect(page.getByRole('button',{name:'Review drafts',exact:true})).toHaveCount(0);
  const sections=[['Transect one','Eroded bank '+'界'.repeat(2000)],['Transect two','Stable bank '+'界'.repeat(2000)],['Transect three','Reed bed '+'界'.repeat(2000)]];
  for(const [title,body] of sections)await addSection(page,title,body);
  await (await revealInEditor(page,page.getByLabel('New tag',{exact:true}),'Record details')).fill('river');await page.getByRole('button',{name:'Add tag',exact:true}).click();await expect(page.locator('.record-tags')).toContainText('river');
  expect((await inspect(f.workspace,id)).row).toBe(null);

  // The first Save's acknowledgement is lost; Save again replays the same save, never a second record.
  let lost=false;
  await page.context().route('**/api/research/drafts/review/apply',async route=>{if(lost)return route.continue();lost=true;await route.fetch();await route.fulfill({status:503,json:{code:'IO',message:'Synthetic lost creation acknowledgement'}});});
  await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('main [role=alert]').first()).toContainText('Synthetic lost creation acknowledgement');
  expect((await inspect(f.workspace,id)).count).toBe(1);
  await page.getByRole('button',{name:'Save record',exact:true}).click();
  await expect(page.getByRole('button',{name:'Read record',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Save record',exact:true})).toHaveCount(0);
  const saved=await inspect(f.workspace,id);expect(saved.count).toBe(1);
  await f.workspace.catalogue(async store=>withRecordDocument(store,id,saved.row.revision,async document=>{
   expect((await document.field(['title'])).value).toBe('River bank survey');expect((await document.field(['tags'])).value).toEqual(['river']);
   const total=await document.tree.arrayLength(document.root,['sections']),written=[];
   for(let i=total-3;i<total;i++)written.push([(await document.field(['sections',String(i),'title'])).value,proseText((await document.field(['sections',String(i),'body'])).value)]);
   expect(written).toEqual(sections);
  }));
  expect((await drafts.list({workspaceId:book.id})).drafts).toEqual([]);

  // A draft left by a reload is kept and saved from Review drafts.
  await page.getByRole('button',{name:'Back to records',exact:true}).click();const recovered=await create(page,book.notebooks[0].id);await setTitle(page,'Reloadable new record');
  const writing=await openRecordWriting(page);await writing.locator('.ProseMirror').fill('Exact unsaved summary');await writing.getByRole('button',{name:'Save changes',exact:true}).click();await expect(writing).not.toBeVisible();
  page.on('dialog',dialog=>dialog.accept());await page.reload();await expect(page.locator('.brand[data-action=workspace-refresh]')).toBeVisible();
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();const row=page.locator('.record-draft-row').filter({hasText:'Reloadable new record'});await row.getByRole('button',{name:'Review draft',exact:true}).click();
  const preview=page.locator('.record-draft-preview');await expect(preview.locator('h2')).toHaveText('Reloadable new record');await expect(preview).toContainText('Exact unsaved summary');await preview.getByRole('button',{name:'Recover this draft',exact:true}).click();
  const review=page.locator('.record-draft-review');await expect(review).toContainText('This draft has not been saved as a record.');await review.getByRole('button',{name:'Save recovered record',exact:true}).click();
  await expect(page.locator('.record-reader h1')).toHaveText('Reloadable new record');await expect(page.locator('.record-reader')).toContainText('Exact unsaved summary');
  expect((await inspect(f.workspace,recovered)).row).not.toBe(null);
  expect(requests.filter(route=>route==='/api/research/records/save')).toEqual([]);expect(errors).toEqual([]);
 }finally{await page.unrouteAll({behavior:'wait'});await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
