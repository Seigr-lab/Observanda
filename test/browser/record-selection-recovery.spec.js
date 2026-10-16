import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';

async function fixture(page,count=61){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-recovery-selection-ui-')),book=upgradeNotebook(sampleNotebook()),source=book.entries[2];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(source),id:randomUUID(),title:'Observation '+String(i).padStart(2,'0'),type:'note',body:'Original notes '+i,sections:[],relations:[],figures:[],attachments:[]}));
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const changes=book.entries.slice(0,25).map(base=>({base,record:{...base,title:'Recovered '+base.title},expectedRevision:recordRevision(base)})),draftId=randomUUID(),drafts=new ResearchDrafts(f.workspace);
 await drafts.write({id:draftId,workspaceId:book.id,expectedRevision:null,changes});
 const errors=[],fullReads=[],selections=[],saves=[],loaded=[],original={read:ResearchCatalogue.prototype.read,record:ResearchCatalogue.prototype.record};
 ResearchCatalogue.prototype.read=()=>{throw Error('Full workspace body read during recovery');};
 ResearchCatalogue.prototype.record=function(id,...args){expect(book.entries.slice(0,25).some(r=>r.id===id)).toBe(true);loaded.push(id);return original.record.call(this,id,...args);};
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{
  if(r.url().endsWith('/api/workspace/read/page')||r.url().endsWith('/api/notebook'))fullReads.push(r.url());
  if(r.url().endsWith('/api/workspace/read/selection'))selections.push(r.postDataJSON());
  if(r.url().endsWith('/api/research/records/save'))saves.push(r.postDataJSON());
 });
 await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);
 await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Observation 00');
 return {...f,book,app,changes,draftId,drafts,errors,selections,saves,loaded,
  assertScoped(){expect(fullReads).toEqual([]);expect(selections.every(c=>c.ids.length<=20)).toBe(true);expect(errors).toEqual([]);},
  read:async()=>{Object.assign(ResearchCatalogue.prototype,original);return f.workspace.read();},
  close:async()=>{Object.assign(ResearchCatalogue.prototype,original);await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
 };
}
const draftList=page=>page.getByRole('dialog',{name:'Recoverable record drafts',exact:true});
const loading=page=>page.getByRole('dialog',{name:'Loading selected records',exact:true});
const recovery=page=>page.getByRole('dialog',{name:'Recover record draft',exact:true});
async function reviewDraft(page){
 await page.getByRole('button',{name:'Review drafts',exact:true}).click();
 await draftList(page).getByRole('button',{name:'Review draft',exact:true}).click();
}
async function applyDraft(page){
 await reviewDraft(page);await expect(recovery(page).locator('.record-merge-summary section')).toHaveCount(25);
 await recovery(page).getByRole('button',{name:'Continue editing',exact:true}).click();
 await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Recovered Observation 00');
}

test('large recovery retries its pinned batch, cancels without losing the source and remains usable on a phone',async({page},testInfo)=>{
 test.setTimeout(90000);
 const f=await fixture(page,400),calls=[];
 try{
  let interrupted=false;
  await page.route('**/api/workspace/read/selection',async route=>{
   const command=route.request().postDataJSON();calls.push(command);
   if(command.ids.length===5&&!interrupted){interrupted=true;await route.fulfill({status:503,json:{code:'IO',message:'Synthetic recovery interruption'}});}
   else await route.continue();
  });
  await reviewDraft(page);await expect(loading(page).getByRole('alert')).toHaveText('Synthetic recovery interruption');
  await expect(loading(page).getByRole('status')).toHaveText('Loaded 20 of 25 records');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='20px');
  expect(await loading(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await expect(loading(page).getByRole('button',{name:'Cancel loading',exact:true})).toBeInViewport();
  await page.screenshot({path:testInfo.outputPath('selected-recovery-retry-phone.png')});
  const target=f.book.entries[24];
  await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:target.id,expectedRevision:recordRevision(target),record:{...target,title:'Changed in another window'}}]},{receipt:true});
  await loading(page).getByRole('button',{name:'Retry loading',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(recovery(page)).toBeVisible();expect(calls.map(c=>c.ids.length)).toEqual([20,5,5]);expect(calls[2]).toEqual(calls[1]);
  await expect(recovery(page).locator('.record-conflict')).toHaveCount(0);
  await recovery(page).getByRole('button',{name:'Cancel',exact:true}).click();await expect(draftList(page)).toBeVisible();
  await page.unroute('**/api/workspace/read/selection');
  await page.route('**/api/workspace/read/selection',route=>route.fulfill({status:503,json:{code:'IO',message:'Synthetic interrupted read'}}));
  await draftList(page).getByRole('button',{name:'Review draft',exact:true}).click();await expect(loading(page).getByRole('alert')).toBeVisible();
  await page.keyboard.press('Escape');await expect(draftList(page)).toBeVisible();expect(await f.drafts.read(f.draftId)).not.toBeNull();
  await draftList(page).getByRole('button',{name:'Close',exact:true}).click();await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Observation 00');
  await page.unroute('**/api/workspace/read/selection');
  await reviewDraft(page);await expect(recovery(page).locator('.record-conflict')).toHaveCount(1);await expect(recovery(page)).toContainText('Changed in another window');
  await recovery(page).getByLabel('Your version',{exact:false}).check();await recovery(page).getByRole('button',{name:'Continue editing',exact:true}).click();
  await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  expect(f.saves).toHaveLength(1);expect(f.saves[0].receipt).toBe(true);expect(f.saves[0].recordIds).toBeUndefined();
  const saved=await f.read();expect(saved.book.entries.slice(0,25).map(r=>r.title)).toEqual(f.changes.map(c=>c.record.title));expect(saved.book.entries.slice(25)).toEqual(f.book.entries.slice(25));f.assertScoped();
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await f.close();}
});

test('a committed large save retries loading without resubmitting and preserves edits typed while saving',async({page})=>{
 test.setTimeout(90000);
 const f=await fixture(page);let release=()=>{};
 try{
  await applyDraft(page);
  const gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/research/records/save',async route=>{await gate;await route.continue();});
  const request=page.waitForRequest(r=>r.url().endsWith('/api/research/records/save'));
  await page.getByRole('button',{name:'Save record',exact:true}).click();await request;
  await page.getByLabel('Summary / context',{exact:true}).fill('Typed during the large save');
  let failed=false;const batches=[];
  await page.route('**/api/workspace/read/selection',async route=>{
   const command=route.request().postDataJSON();batches.push(command);
   if(command.ids.length===5&&!failed){failed=true;await route.fulfill({status:503,json:{code:'IO',message:'Synthetic saved-version interruption'}});}
   else await route.continue();
  });
  release();await expect(loading(page).getByRole('alert')).toHaveText('Synthetic saved-version interruption');
  await expect(loading(page)).toContainText('Your records were saved.');expect(f.saves).toHaveLength(1);
  const committed=(await f.workspace.outline()).etag;
  await loading(page).getByRole('button',{name:'Retry loading',exact:true}).click();await expect(loading(page)).not.toBeVisible();
  expect(f.saves).toHaveLength(1);expect(batches.map(c=>c.ids.length)).toEqual([20,5,5]);expect(batches.every(c=>c.snapshotId===committed)).toBe(true);
  await expect(page.locator('#save-status')).toHaveText('Unsaved changes');await expect(page.getByLabel('Summary / context',{exact:true})).toHaveText('Typed during the large save');
  await page.unrouteAll({behavior:'wait'});await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  expect(f.saves).toHaveLength(2);expect(f.saves[1].changes).toHaveLength(1);
  const saved=await f.read();expect(saved.book.entries.slice(0,25).map(r=>r.title)).toEqual(f.changes.map(c=>c.record.title));expect(JSON.stringify(saved.book.entries[0].body)).toContain('Typed during the large save');expect(saved.book.entries.slice(25)).toEqual(f.book.entries.slice(25));f.assertScoped();
 }finally{release();await page.unrouteAll({behavior:'ignoreErrors'});await f.close();}
});

test('cancelling a saved selection reload retains the checkpoint and retry compares without a duplicate commit',async({page})=>{
 test.setTimeout(90000);
 const f=await fixture(page);
 try{
  await applyDraft(page);
  await page.route('**/api/workspace/read/selection',route=>route.fulfill({status:503,json:{code:'IO',message:'Synthetic reload interruption'}}));
  await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(loading(page).getByRole('alert')).toBeVisible();
  const committed=(await f.workspace.outline()).etag;
  await loading(page).getByRole('button',{name:'Cancel loading',exact:true}).click();await expect(page.locator('#notice')).toContainText('Your records were saved, but loading them was cancelled');
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Recovered Observation 00');await expect(page.locator('#save-status')).toHaveText('Unsaved changes');
  expect((await f.drafts.list({workspaceId:f.book.id})).drafts).toHaveLength(1);
  await page.unroute('**/api/workspace/read/selection');
  await page.getByRole('button',{name:'Save record',exact:true}).click();
  const review=page.getByRole('dialog',{name:'Review record changes',exact:true});await expect(review).toBeVisible();await expect(review.locator('.record-conflict')).toHaveCount(0);
  await review.getByRole('button',{name:'Continue editing',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  expect((await f.workspace.outline()).etag).toBe(committed);expect(f.saves).toHaveLength(2);
  // With all recovered records saved, history needs only its selected subject.
  await page.getByRole('button',{name:'History',exact:true}).click();
  const history=page.locator('#dialog');
  await history.getByRole('button',{name:'Review version',exact:true}).click();await history.getByRole('button',{name:'Restore this version',exact:true}).click();
  const restoreRequest=page.waitForRequest(r=>r.url().endsWith('/api/research/records/history/restore'));
  await history.getByRole('button',{name:'Restore record',exact:true}).click();
  expect((await restoreRequest).postDataJSON().recordIds).toEqual([f.book.entries[0].id]);await expect(history).not.toBeVisible();
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Observation 00');
  const saved=await f.read();expect(saved.book.entries[0].title).toBe('Observation 00');expect(saved.book.entries.slice(1,25).map(r=>r.title)).toEqual(f.changes.slice(1).map(c=>c.record.title));expect(saved.book.entries.slice(25)).toEqual(f.book.entries.slice(25));f.assertScoped();
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await f.close();}
});

test('cancelling an in-flight recovery ignores its late response and a locked selection closes the editor',async({page})=>{
 test.setTimeout(90000);
 const f=await fixture(page);let release=()=>{};
 try{
  const gate=new Promise(resolve=>release=resolve);let started;const pending=new Promise(resolve=>started=resolve);
  await page.route('**/api/workspace/read/selection',async route=>{
   if(route.request().postDataJSON().ids.length!==5){await route.continue();return;}
   const response=await route.fetch();started();await gate;await route.fulfill({response});
  });
  await reviewDraft(page);await pending;await expect(loading(page).getByRole('status')).toHaveText('Loaded 20 of 25 records');
  await loading(page).getByRole('button',{name:'Cancel loading',exact:true}).click();await expect(draftList(page)).toBeVisible();
  release();await page.unrouteAll({behavior:'wait'});await expect(recovery(page)).not.toBeVisible();await expect(draftList(page)).toBeVisible();
  expect(await f.drafts.read(f.draftId)).not.toBeNull();
  await page.route('**/api/workspace/read/selection',async route=>{
   if(route.request().postDataJSON().ids.length===5){
    const locked=await page.request.post(f.app.origin+'/api/access/lock',{data:{},headers:{Origin:f.app.origin}});expect(locked.ok()).toBe(true);
   }
   await route.continue();
  });
  await draftList(page).getByRole('button',{name:'Review draft',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();await expect(page.getByLabel('Record title',{exact:true})).toHaveCount(0);
  await expect(loading(page)).not.toBeVisible();await expect(recovery(page)).not.toBeVisible();f.assertScoped();
 }finally{release();await page.unrouteAll({behavior:'ignoreErrors'});await f.close();}
});
