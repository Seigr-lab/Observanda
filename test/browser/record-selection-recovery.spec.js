import {sessionRequest} from './session-fixture.js';
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

const readerTitle=page=>page.locator('.record-reader h1');
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
 // A saved record opens for reading; a recovered record opens for reading once it is saved.
 await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);
 await expect(readerTitle(page)).toHaveText('Observation 00');
 return {...f,book,app,changes,draftId,drafts,errors,selections,saves,loaded,
  assertScoped(){expect(fullReads).toEqual([]);expect(selections.every(c=>c.ids.length<=20)).toBe(true);expect(errors).toEqual([]);},
  // Checks read the whole workspace directly, outside the application, and keep the guards in place.
  read:async()=>{const guarded={read:ResearchCatalogue.prototype.read,record:ResearchCatalogue.prototype.record};Object.assign(ResearchCatalogue.prototype,original);try{return await f.workspace.read();}finally{Object.assign(ResearchCatalogue.prototype,guarded);}},
  close:async()=>{Object.assign(ResearchCatalogue.prototype,original);await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
 };
}
const draftList=page=>page.getByRole('dialog',{name:'Recoverable record drafts',exact:true});
const checkpointRecords=page=>page.locator('dialog.record-draft-records[open]');
const preview=page=>page.locator('dialog.record-draft-preview[open]');
const review=page=>page.locator('dialog.record-draft-review[open]');
// A checkpoint that owns several records is recovered one record at a time; the others stay in it.
async function openCheckpoint(page){
 await page.getByRole('button',{name:'Review drafts',exact:true}).click();
 await draftList(page).getByRole('button',{name:'Review draft',exact:true}).click();
 await expect(checkpointRecords(page).locator('.record-draft-row')).toHaveCount(4);
}
const recordRow=(page,title)=>checkpointRecords(page).locator('.record-draft-row').filter({has:page.getByRole('heading',{name:title,exact:true})});
async function showRecord(page,title){
 for(let turn=0;turn<20&&!await recordRow(page,title).count();turn++){
  await checkpointRecords(page).getByRole('button',{name:'Next records',exact:true}).click();
  await expect(checkpointRecords(page).locator('.record-draft-row').first()).toBeVisible();
 }
 await expect(recordRow(page,title)).toBeVisible();
}
async function reviewRecord(page,title){
 await recordRow(page,title).getByRole('button',{name:'Review draft',exact:true}).click();
 await expect(preview(page).getByRole('button',{name:'Recover this draft',exact:true})).toBeEnabled();
 await preview(page).getByRole('button',{name:'Recover this draft',exact:true}).click();
 await expect(review(page).getByRole('button',{name:'Close review',exact:true})).toBeEnabled();
}
// Keep the author's draft for every overlapping change, then save the recovered record.
async function saveReview(page){
 const save=review(page).getByRole('button',{name:'Save recovered record',exact:true});
 for(let turn=0;turn<20&&await save.isDisabled();turn++){
  const mine=review(page).locator('.record-conflict-versions section').first().getByRole('button',{name:'Keep this version',exact:true});
  if(await mine.count())await mine.click();
  else await review(page).getByRole('button',{name:'Next change',exact:true}).click();
  await expect(review(page).getByRole('button',{name:'Close review',exact:true})).toBeEnabled();
 }
 await save.click();await expect(review(page)).toHaveCount(0);
}

test('a large checkpoint retries its record page, cancels without losing the checkpoint and remains usable on a phone',async({page},testInfo)=>{
 test.setTimeout(90000);
 const f=await fixture(page,400),offsets=[];
 try{
  let interrupted=false;
  await page.context().route('**/api/research/drafts/review/records',async route=>{
   const command=route.request().postDataJSON();offsets.push(command.offset);
   if(command.offset===4&&!interrupted){interrupted=true;await route.fulfill({status:503,json:{code:'IO',message:'Synthetic recovery interruption'}});}
   else await route.continue();
  });
  // On a phone with large text, a failed page brings its message and retry into reach.
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='20px');
  await openCheckpoint(page);
  await checkpointRecords(page).getByRole('button',{name:'Next records',exact:true}).click();
  await expect(checkpointRecords(page).getByRole('alert')).toHaveText('Synthetic recovery interruption');
  expect(await checkpointRecords(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await expect(checkpointRecords(page).getByRole('button',{name:'Retry drafts',exact:true})).toBeInViewport();
  await page.screenshot({path:testInfo.outputPath('checkpoint-records-retry-phone.png')});
  const target=f.book.entries[24];
  await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:target.id,expectedRevision:recordRevision(target),record:{...target,title:'Changed in another window'}}]},{receipt:true});
  await checkpointRecords(page).getByRole('button',{name:'Retry drafts',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(recordRow(page,'Recovered Observation 04')).toBeVisible();expect(offsets).toEqual([0,4,4]);
  await page.keyboard.press('Escape');await expect(checkpointRecords(page)).toHaveCount(0);await expect(draftList(page)).toBeVisible();
  expect(await f.drafts.read(f.draftId)).not.toBeNull();
  await draftList(page).getByRole('button',{name:'Close',exact:true}).click();await expect(readerTitle(page)).toHaveText('Observation 00');
  await page.context().unroute('**/api/research/drafts/review/records');
  // The record changed in another window shows its overlapping change; the author's draft is kept.
  await openCheckpoint(page);await showRecord(page,'Recovered Observation 24');await reviewRecord(page,'Recovered Observation 24');
  await expect(review(page).locator('.record-conflict-versions')).toContainText('Changed in another window');
  await saveReview(page);await expect(readerTitle(page)).toHaveText('Recovered Observation 24');
  const saved=await f.read();expect(saved.book.entries[24].title).toBe('Recovered Observation 24');
  expect(saved.book.entries.slice(0,24)).toEqual(f.book.entries.slice(0,24));expect(saved.book.entries.slice(25)).toEqual(f.book.entries.slice(25));
  expect(await f.drafts.read(f.draftId)).not.toBeNull();f.assertScoped();
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await f.close();}
});

test('a lost save acknowledgement shows the record as recovered without saving it twice',async({page})=>{
 test.setTimeout(90000);
 const f=await fixture(page);const applies=[];
 try{
  await page.context().route('**/api/research/drafts/review/apply',async route=>{
   applies.push(route.request().postDataJSON());
   const response=await route.fetch();
   if(applies.length===1)await route.fulfill({status:503,json:{code:'IO',message:'Synthetic lost acknowledgement'}});else await route.fulfill({response});
  });
  await openCheckpoint(page);await reviewRecord(page,'Recovered Observation 00');
  await review(page).getByRole('button',{name:'Save recovered record',exact:true}).click();
  await expect(review(page).getByRole('alert')).toHaveText('Synthetic lost acknowledgement');
  const committed=(await f.workspace.outline()).etag;
  await review(page).getByRole('button',{name:'Close review',exact:true}).click();await expect(review(page)).toHaveCount(0);
  // Reopening the checkpoint reports the durable save instead of offering it again.
  await openCheckpoint(page);
  await expect(recordRow(page,'Recovered Observation 00').getByRole('button',{name:'Recovered',exact:true})).toBeDisabled();
  await expect(recordRow(page,'Recovered Observation 01').getByRole('button',{name:'Review draft',exact:true})).toBeEnabled();
  expect(applies).toHaveLength(1);expect((await f.workspace.outline()).etag).toBe(committed);
  await reviewRecord(page,'Recovered Observation 01');await saveReview(page);await expect(readerTitle(page)).toHaveText('Recovered Observation 01');
  expect(applies).toHaveLength(2);
  const saved=await f.read();expect(saved.book.entries.slice(0,2).map(r=>r.title)).toEqual(['Recovered Observation 00','Recovered Observation 01']);
  expect(saved.book.entries.slice(2)).toEqual(f.book.entries.slice(2));f.assertScoped();
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await f.close();}
});

test('leaving a recovery before saving keeps the checkpoint, and history restores only the selected record',async({page})=>{
 test.setTimeout(90000);
 const f=await fixture(page);
 try{
  await openCheckpoint(page);
  await recordRow(page,'Recovered Observation 00').getByRole('button',{name:'Review draft',exact:true}).click();
  await expect(preview(page).getByRole('button',{name:'Recover this draft',exact:true})).toBeEnabled();
  await preview(page).getByRole('button',{name:'Back to drafts',exact:true}).click();await expect(preview(page)).toHaveCount(0);
  await expect(draftList(page)).toBeVisible();expect(await f.drafts.read(f.draftId)).not.toBeNull();
  await draftList(page).getByRole('button',{name:'Review draft',exact:true}).click();await expect(checkpointRecords(page).locator('.record-draft-row')).toHaveCount(4);
  await reviewRecord(page,'Recovered Observation 00');
  await review(page).getByRole('button',{name:'Close review',exact:true}).click();await expect(review(page)).toHaveCount(0);
  expect((await f.drafts.list({workspaceId:f.book.id})).drafts).toHaveLength(1);
  const unchanged=await f.read();expect(unchanged.book.entries).toEqual(f.book.entries);
  await openCheckpoint(page);await reviewRecord(page,'Recovered Observation 00');await saveReview(page);
  await expect(readerTitle(page)).toHaveText('Recovered Observation 00');
  // With the recovered record saved, history needs only its selected subject.
  await page.getByRole('button',{name:'History',exact:true}).click();
  const history=page.locator('#dialog');
  await history.getByRole('button',{name:'Review version',exact:true}).click();await history.getByRole('button',{name:'Restore this version',exact:true}).click();
  const restoreRequest=page.waitForRequest(r=>r.url().endsWith('/api/research/records/history/restore'));
  await history.getByRole('button',{name:'Restore record',exact:true}).click();
  const restored=(await restoreRequest).postDataJSON();expect(restored.recordId).toBe(f.book.entries[0].id);expect(restored.recordIds??[restored.recordId]).toEqual([f.book.entries[0].id]);await expect(history).not.toBeVisible();
  await expect(readerTitle(page)).toHaveText('Observation 00');
  const saved=await f.read();expect(saved.book.entries[0].title).toBe('Observation 00');expect(saved.book.entries.slice(1)).toEqual(f.book.entries.slice(1));f.assertScoped();
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await f.close();}
});

test('cancelling an in-flight record page ignores its late response and a locked workspace closes the record',async({page})=>{
 test.setTimeout(90000);
 const f=await fixture(page);let release=()=>{};
 try{
  const gate=new Promise(resolve=>release=resolve);let started;const pending=new Promise(resolve=>started=resolve);
  await page.context().route('**/api/research/drafts/review/records',async route=>{
   const response=await route.fetch();started();await gate;await route.fulfill({response});
  });
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();
  await draftList(page).getByRole('button',{name:'Review draft',exact:true}).click();await pending;
  await expect(checkpointRecords(page).getByRole('status')).toBeVisible();
  await checkpointRecords(page).getByRole('button',{name:'Close',exact:true}).click();await expect(checkpointRecords(page)).toHaveCount(0);await expect(draftList(page)).toBeVisible();
  release();await page.unrouteAll({behavior:'wait'});await expect(checkpointRecords(page)).toHaveCount(0);await expect(preview(page)).toHaveCount(0);await expect(draftList(page)).toBeVisible();
  expect(await f.drafts.read(f.draftId)).not.toBeNull();
  await page.context().route('**/api/research/drafts/review/records',async route=>{
   const locked=await sessionRequest(page,'post',f.app.origin+'/api/access/lock',{data:{},headers:{Origin:f.app.origin}});expect(locked.ok()).toBe(true);
   await route.continue();
  });
  await draftList(page).getByRole('button',{name:'Review draft',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();await expect(readerTitle(page)).toHaveCount(0);
  await expect(preview(page)).toHaveCount(0);await expect(review(page)).toHaveCount(0);f.assertScoped();
 }finally{release();await page.unrouteAll({behavior:'ignoreErrors'});await f.close();}
});
