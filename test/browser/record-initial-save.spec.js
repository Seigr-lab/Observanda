import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {withRecordDocument} from '../../src/record-document.js';
import {proseText} from '../../src/web/prose-model.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {openRecordWriting} from './record-editing-helper.js';

async function create(page,notebookId,title){
 await page.evaluate(id=>location.hash='#/notebooks/'+id,notebookId);await page.getByRole('button',{name:'New record',exact:true}).click();
 const dialog=page.locator('#dialog'),general=dialog.locator('details').filter({hasText:'General record types'});if(!await general.evaluate(element=>element.open))await dialog.getByText('General record types',{exact:true}).click();await dialog.getByRole('button',{name:'Create free-form note',exact:true}).click();
 await page.getByLabel('Record title',{exact:true}).fill(title);return new URL(page.url()).hash.split('/')[2];
}
async function writeLarge(page){
 const sections=[];
 for(let i=0;i<12;i++){
  await page.getByRole('button',{name:'Add section',exact:true}).click();const section=page.locator('.record-section').last(),title='Initial observation '+(i+1),body='Exact acquisition '+i+' '+('\u754c'.repeat(59900));
  await section.getByLabel('Section heading',{exact:true}).fill(title);await section.locator('[contenteditable=true]').fill(body);sections.push({id:await section.getAttribute('data-writing-section'),title,body});
 }
 return sections;
}
async function inspect(workspace,id){return workspace.catalogue(async store=>{const snapshot=await store.snapshot(),row=await store.member(snapshot,id);return {count:snapshot.count,row};});}

test('initial record Save streams large authoring, replays lost acknowledgements and preserves newer work and recovery',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-initial-record-')),book=upgradeNotebook(sampleNotebook());book.entries=[];
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),drafts=new ResearchDrafts(f.workspace),original=ResearchCatalogue.prototype.record;
 const errors=[],requests=[],applyCommands=[];let releaseCheckpoint,releaseApply;
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());page.on('request',request=>{const route=new URL(request.url()).pathname;if(route.startsWith('/api/'))requests.push({route,body:request.method()==='POST'?request.postDataJSON():null});});
 try{
  await page.goto(app.url);await expect(page.locator('.brand[data-action=workspace-refresh]')).toBeVisible();
  ResearchCatalogue.prototype.record=()=>{throw Error('Initial creation reconstructed a saved record');};
  const cancelled=await create(page,book.notebooks[0].id,'Cancelled before Save');await expect(page.locator('[data-record-checkpoint]')).toContainText('Record draft checkpointed');await page.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(page.getByLabel('Record title',{exact:true})).toHaveCount(0);
  expect((await inspect(f.workspace,cancelled)).row).toBe(null);expect((await drafts.list({workspaceId:book.id})).drafts).toEqual([]);
  const id=await create(page,book.notebooks[0].id,'Initial growing record');let checkpointEntered;const checkpointHeld=new Promise(resolve=>checkpointEntered=resolve);let lostCheckpoint=false;
  await page.route('**/api/research/drafts/transfer/finish',async route=>{
   if(lostCheckpoint)return route.continue();lostCheckpoint=true;await route.fetch();checkpointEntered();await new Promise(resolve=>releaseCheckpoint=resolve);await route.fulfill({status:503,json:{code:'IO',message:'Synthetic lost checkpoint acknowledgement'}});
  });
  const sections=await writeLarge(page);await checkpointHeld;await page.getByLabel('Record title',{exact:true}).fill('Typed while checkpoint was streaming');releaseCheckpoint();releaseCheckpoint=null;
  await expect(page.locator('[data-record-checkpoint]')).toContainText('not checkpointed');expect((await inspect(f.workspace,id)).row).toBe(null);
  let applyEntered;const applyHeld=new Promise(resolve=>applyEntered=resolve);let lostApply=false;
  await page.route('**/api/research/drafts/review/apply',async route=>{
   applyCommands.push(route.request().postDataJSON());if(lostApply)return route.continue();lostApply=true;await route.fetch();applyEntered();await new Promise(resolve=>releaseApply=resolve);await route.fulfill({status:503,json:{code:'IO',message:'Synthetic lost creation acknowledgement'}});
  });
  await page.getByRole('button',{name:'Save record',exact:true}).click();await applyHeld;
  const first=await inspect(f.workspace,id);expect(first.count).toBe(1);expect(first.row.bytes).toBeGreaterThan(2*1024*1024);
  await page.getByLabel('Record title',{exact:true}).fill('Typed while initial Save was committing');releaseApply();releaseApply=null;await expect(page.locator('#notice')).toContainText('Synthetic lost creation acknowledgement');
  await expect.poll(async()=>{const items=await drafts.list({workspaceId:book.id});return items.drafts.some(item=>item.titles.includes('Typed while initial Save was committing'));}).toBe(true);
  // This click retries the identical already-committed plan. Newer typing is
  // retained as unsaved work; it cannot become a second record or disappear.
  const replay=page.waitForResponse(response=>response.url().endsWith('/api/research/drafts/review/apply')&&response.ok());await page.getByRole('button',{name:'Save record',exact:true}).click();await replay;await expect(page.getByRole('button',{name:'Save record',exact:true})).toBeEnabled();await expect(page.locator('#save-status')).toHaveText('Unsaved changes');await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Typed while initial Save was committing');expect(applyCommands).toHaveLength(2);expect(applyCommands[1]).toEqual(applyCommands[0]);expect((await inspect(f.workspace,id)).count).toBe(1);
  const continuation=page.waitForResponse(response=>response.url().endsWith('/api/research/drafts/review/apply')&&response.ok());await page.getByRole('button',{name:'Save record',exact:true}).click();await continuation;await expect(page.locator('.record-editing h1')).toHaveText('Typed while initial Save was committing');await expect(page.locator('dialog.record-draft-review[open]')).toHaveCount(0);
  await f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),id);expect(row.bytes).toBeGreaterThan(2*1024*1024);await withRecordDocument(store,id,row.revision,async document=>{for(let i=0;i<sections.length;i++){const saved=(await document.field(['sections',String(i)])).value;expect(saved.id).toBe(sections[i].id);expect(saved.title).toBe(sections[i].title);expect(proseText(saved.body)).toBe(sections[i].body);}});});
  await page.reload();await expect(page.locator('.record-editing h1')).toHaveText('Typed while initial Save was committing');const writing=await openRecordWriting(page);await writing.locator('.ProseMirror').fill('Continued through the normal selected editor');await writing.getByRole('button',{name:'Save changes',exact:true}).click();await expect(writing).not.toBeVisible();
  await page.getByRole('button',{name:'Read record',exact:true}).click();await expect(page.locator('.record-reader')).toContainText('Continued through the normal selected editor');
  await page.getByRole('button',{name:'Back to records',exact:true}).click();const recovered=await create(page,book.notebooks[0].id,'Reloadable initial checkpoint');await page.locator('.document-field').first().locator('[contenteditable=true]').fill('Exact unsaved initial writing');await expect(page.locator('[data-record-checkpoint]')).toContainText('Record draft checkpointed');await page.reload();
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();const row=page.locator('.record-draft-row').filter({hasText:'Reloadable initial checkpoint'});await row.getByRole('button',{name:'Review draft',exact:true}).click();await expect(page.locator('.record-draft-preview')).toContainText('Exact unsaved initial writing');await page.locator('.record-draft-preview [data-preview-recover]').click();
  const review=page.locator('.record-draft-review');await expect(review).toContainText('This draft has not been saved as a record.');await review.getByRole('button',{name:'Save recovered record',exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText('Reloadable initial checkpoint');expect((await inspect(f.workspace,recovered)).count).toBe(2);
  expect(requests.some(request=>request.route==='/api/research/records/save'||request.route==='/api/workspace/read/page'||request.route.includes('/drafts/transfer/read'))).toBe(false);expect(errors).toEqual([]);
 }finally{releaseCheckpoint?.();releaseApply?.();ResearchCatalogue.prototype.record=original;await page.unrouteAll({behavior:'wait'});await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
