import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {openRecordDetail,openRecordWriting} from './record-editing-helper.js';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';

async function fixture(){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-selected-record-ui-')),book=upgradeNotebook(sampleNotebook()),source=book.entries[2];
 book.entries=Array.from({length:61},(_,i)=>({...structuredClone(source),id:randomUUID(),title:'Observation '+String(i).padStart(2,'0'),type:'note',body:'Original notes '+i,sections:[],relations:[],figures:[],attachments:[]}));
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 return {...f,book,app,close:async()=>{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}};
}
const openRecord=async(page,id)=>{await page.evaluate(id=>location.hash='#/records/'+id,id);await expect(page.locator('.record-editing h1')).toHaveText(/Observation/);};

test('relationship search pages summaries and exact method links survive later edits without loading the workspace',async({page},testInfo)=>{
 test.setTimeout(90000);
 const f=await fixture(),errors=[],fullReads=[],bodies=[],record=ResearchCatalogue.prototype.record;
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().endsWith('/api/workspace/read/page')||r.url().endsWith('/api/notebook'))fullReads.push(r.url());});
 ResearchCatalogue.prototype.record=function(id,...rest){bodies.push(id);return record.call(this,id,...rest);};
 try{
  await page.goto(f.app.url);await openRecord(page,f.book.entries[0].id);
  const titleEdit=await openRecordDetail(page);await titleEdit.getByLabel('Record title',{exact:true}).fill('Unfinished listening interpretation');await titleEdit.getByRole('button',{name:'Keep recovery checkpoint and close',exact:true}).click();await expect(titleEdit).not.toBeVisible();
  await page.getByRole('button',{name:'Add research link',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Edit Research link',exact:true}),choices=dialog.locator('[data-action="research-target-choose"]'),picker=dialog.locator('[data-research-picker]');
  await dialog.getByLabel('Relationship purpose',{exact:true}).selectOption('uses-method');await expect(dialog.getByLabel('Version to choose')).toHaveValue('exact');await expect(dialog.getByLabel('Version to choose')).toBeDisabled();await dialog.getByRole('button',{name:'Choose target',exact:true}).click();
  await expect(choices).toHaveCount(25);await expect(choices.first()).toContainText('Observation 01');expect(bodies).toEqual([]);
  await dialog.getByRole('button',{name:'Next results',exact:true}).focus();await page.keyboard.press('Enter');await expect(choices.first()).toBeFocused();await expect(choices.first()).toContainText('Observation 26');
  await dialog.getByRole('button',{name:'Previous results',exact:true}).click();await expect(choices.first()).toContainText('Observation 01');
  await page.route('**/api/research/records/query',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic search interruption'})}));
  await dialog.getByLabel('Find in this workspace',{exact:true}).fill('Observation 60');await expect(picker.getByRole('alert')).toHaveText('Synthetic search interruption');
  await page.unroute('**/api/research/records/query');await dialog.getByRole('button',{name:'Refresh results',exact:true}).click();await expect(choices).toHaveCount(1);
  const original=f.book.entries[60];
  const updated=await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:original.id,expectedRevision:recordRevision(original),record:{...original,body:'Changed listening method'}}]},{recordIds:[original.id]}),changed=updated.book.entries[0];
  await choices.first().click();await expect(picker.getByRole('alert')).toContainText('changed after this search');await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Refresh results',exact:true}).click();await expect(picker.getByRole('alert')).toHaveCount(0);await expect(choices).toHaveCount(1);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='20px');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:testInfo.outputPath('research-picker-narrow.png')});
  await choices.first().focus();await page.keyboard.press('Enter');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();await expect(titleEdit.getByLabel('Record title',{exact:true})).toHaveValue('Unfinished listening interpretation');await titleEdit.getByRole('button',{name:'Save changes',exact:true}).click();await expect(titleEdit).not.toBeVisible();
  expect(fullReads).toEqual([]);expect(bodies).not.toContain(f.book.entries[0].id);
  ResearchCatalogue.prototype.record=record;
  const saved=(await f.workspace.read()).book,relation=saved.entries[0].relations[0];expect(relation.role).toBe('uses-method');expect(relation.target.revision).toBe(recordRevision(changed));expect(saved.entries[60]).toEqual(changed);
  await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:changed.id,expectedRevision:recordRevision(changed),record:{...changed,body:'Later listening method'}}]});
  expect(await new ResearchMaterials(f.workspace).read(relation.target)).toEqual(changed);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=record;await f.close();}
});

test('cancelled linking ignores late pin replies and malformed searches can be retried',async({page})=>{
 const f=await fixture(),errors=[],fullReads=[];let release;
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/workspace/read/page')||r.url().endsWith('/api/notebook'))fullReads.push(r.url());});
 try{
  await page.goto(f.app.url);await openRecord(page,f.book.entries[0].id);await page.getByRole('button',{name:'Add research link',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Edit Research link',exact:true}),choices=dialog.locator('[data-action="research-target-choose"]'),picker=dialog.locator('[data-research-picker]');
  await dialog.getByLabel('Version to choose').selectOption('exact');await dialog.getByRole('button',{name:'Choose target',exact:true}).click();await expect(choices).toHaveCount(25);
  const gate=new Promise(resolve=>release=resolve);let started;const pending=new Promise(resolve=>started=resolve);
  await page.route('**/api/research/materials/pin',async route=>{const response=await route.fetch();started();await gate;await route.fulfill({response}).catch(()=>{});});
  await choices.first().click();await pending;await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(picker).toHaveCount(0);
  await dialog.getByLabel('Version to choose').selectOption('current');await dialog.getByRole('button',{name:'Choose target',exact:true}).click();await expect(choices).toHaveCount(25);release();await page.unrouteAll({behavior:'wait'});
  await expect(dialog).toBeVisible();await expect(dialog.getByLabel('Observanda reference',{exact:true})).toHaveValue('');
  await page.route('**/api/research/records/query',async route=>{const response=await route.fetch(),body=await response.json();body.records[0].revision='invalid';await route.fulfill({response,json:body});});
  await dialog.getByRole('button',{name:'Refresh results',exact:true}).click();await expect(picker.getByRole('alert')).toContainText('response was incomplete');await expect(choices).toHaveCount(0);
  await page.unroute('**/api/research/records/query');await dialog.getByRole('button',{name:'Refresh results',exact:true}).click();await expect(choices).toHaveCount(25);
  await dialog.getByLabel('Look for',{exact:true}).selectOption('notebook');await expect(choices).toHaveCount(f.book.notebooks.length);await choices.first().click();
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  const saved=(await f.workspace.read()).book.entries[0];expect(saved.relations).toHaveLength(1);expect(saved.relations[0].target.kind).toBe('notebook');expect(saved.relations[0].target.revision).toBeUndefined();expect(fullReads).toEqual([]);expect(errors).toEqual([]);
 }finally{release?.();await page.unrouteAll({behavior:'wait'});await f.close();}
});

test('record bodies stay on demand while inline links search and page through summaries',async({page})=>{
 test.setTimeout(90000);
 const f=await fixture(),errors=[],fullReads=[],bodies=[],selections=[];
 const record=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=function(id,...rest){bodies.push(id);return record.call(this,id,...rest);};
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().endsWith('/api/workspace/read/page')||r.url().endsWith('/api/notebook'))fullReads.push(r.url());if(r.url().endsWith('/api/workspace/read/selection'))selections.push(r.postDataJSON().ids);});
 try{
  await page.goto(f.app.url);await openRecord(page,f.book.entries[0].id);
  const writing=await openRecordWriting(page),editor=writing.getByRole('textbox',{name:'Writing',exact:true}),field=writing.locator('.document-field');
  await editor.fill('Read another observation');await editor.press('ControlOrMeta+A');await field.getByRole('button',{name:'Link',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Link settings',exact:true}),destinations=dialog.locator('[data-rich-destination*="/record/"]');
  await expect(dialog.getByRole('button',{name:'Next destinations',exact:true})).toBeVisible();
  await expect(destinations).toHaveCount(25);
  const first=await destinations.locator('strong').allTextContents();
  await dialog.getByRole('button',{name:'Next destinations',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(dialog.getByRole('button',{name:'Previous destinations',exact:true})).toBeVisible();await expect(destinations).toHaveCount(25);
  expect(await destinations.locator('strong').allTextContents()).not.toEqual(first);await expect(destinations.first()).toBeFocused();
  await dialog.getByRole('button',{name:'Previous destinations',exact:true}).click();await expect(destinations.locator('strong')).toHaveText(first);
  await page.route('**/api/research/records/query',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic destination failure'})}));
  await dialog.getByLabel('Find link destination',{exact:true}).fill('Observation 60');await expect(dialog.getByRole('alert')).toHaveText('Synthetic destination failure');
  await page.unroute('**/api/research/records/query');await dialog.getByRole('button',{name:'Retry destinations',exact:true}).click();await expect(destinations).toHaveCount(1);
  await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await destinations.first().focus();await page.keyboard.press('Enter');await expect(dialog.getByRole('button',{name:'Apply link',exact:true})).toBeFocused();await page.keyboard.press('Enter');
  await expect(editor.locator('a')).toHaveAttribute('href',new RegExp(f.book.entries[60].id));
  await writing.getByRole('button',{name:'Save changes',exact:true}).click();await expect(writing).not.toBeVisible();
  expect(fullReads).toEqual([]);expect(bodies).toEqual([]);
  // An earlier record's undo tree must not reappear after visiting another one.
  await page.evaluate(id=>location.hash='#/records/'+id,f.book.entries[1].id);await expect(page.locator('.record-editing h1')).toHaveText('Observation 01');
  await page.evaluate(id=>location.hash='#/records/'+id,f.book.entries[0].id);await expect(page.locator('.record-editing h1')).toHaveText('Observation 00');await openRecordWriting(page);
  await expect(field.getByRole('button',{name:'Undo text',exact:true})).toBeDisabled();await expect(editor.locator('a')).toHaveAttribute('href',new RegExp(f.book.entries[60].id));
  expect(fullReads).toEqual([]);expect(selections).toEqual([]);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=record;await f.close();}
});

test('opening runs preserves a selected checkpoint and its conflict base without promoting the workspace',async({page})=>{
 const f=await fixture(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(f.app.url);
  await openRecord(page,f.book.entries[0].id);const titleEdit=await openRecordDetail(page),title=titleEdit.getByLabel('Record title',{exact:true});await title.fill('Local interpretation');await titleEdit.getByRole('button',{name:'Keep recovery checkpoint and close',exact:true}).click();await expect(titleEdit).not.toBeVisible();
  const original=f.book.entries[0];await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:original.id,expectedRevision:recordRevision(original),record:{...original,title:'Other writer interpretation'}}]});
  const fullReads=[];page.on('request',r=>{if(r.url().endsWith('/api/workspace/read/page')||r.url().endsWith('/api/workspace/read/selection'))fullReads.push(r.url());});
  const request=page.waitForRequest(r=>r.url().endsWith('/api/research/records/runs'));
  await page.getByText('Organize runs or takes',{exact:true}).click();await page.getByRole('button',{name:'View runs and comparisons',exact:true}).click();
  expect((await request).postDataJSON()).toMatchObject({workspaceId:f.book.id,recordId:f.book.entries[0].id});expect(fullReads).toEqual([]);
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();
  await expect(title).toHaveValue('Local interpretation');await titleEdit.getByRole('button',{name:'Save changes',exact:true}).click();await expect(titleEdit.locator('.record-writing-conflict')).toContainText('Other writer interpretation');await expect(title).toHaveValue('Local interpretation');expect(fullReads).toEqual([]);expect(errors).toEqual([]);
 }finally{await f.close();}
});

test('an incomplete outline cannot fall back to loading all records when opening editing',async({page})=>{
 const f=await fixture(),fullReads=[];
 try{
  await page.goto(f.app.url);await openRecord(page,f.book.entries[0].id);
  page.on('request',r=>{if(r.url().endsWith('/api/workspace/read/page')||r.url().endsWith('/api/workspace/read/selection'))fullReads.push(r.url());});
  await page.route('**/api/workspace/read/start',async route=>{const response=await route.fetch(),body=await response.json();delete body.notebookCounts;await route.fulfill({response,json:body});});
  await page.evaluate(id=>location.hash='#/records/'+id,f.book.entries[1].id);await expect(page.locator('#notice')).toContainText('workspace response was incomplete');await expect(page.locator('.record-editing h1')).toHaveText('Observation 00');expect(fullReads).toEqual([]);
  await page.unroute('**/api/workspace/read/start');await page.reload();await expect(page.locator('.record-editing h1')).toHaveText('Observation 01');expect(fullReads).toEqual([]);
 }finally{await f.close();}
});

test('a larger recovered draft reaches its last record and retains the other pending edits',async({page})=>{
 test.setTimeout(120000);
 const f=await fixture();
 try{
  const changes=f.book.entries.slice(0,25).map(base=>({base,record:{...base,title:'Recovered '+base.title},expectedRevision:recordRevision(base)}));
  await new ResearchDrafts(f.workspace).write({id:randomUUID(),workspaceId:f.book.id,expectedRevision:null,changes});
  await page.goto(f.app.url);await openRecord(page,f.book.entries[0].id);
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();
  const picker=page.locator('.record-draft-records');for(let i=0;i<6;i++){await expect(picker.locator('.record-draft-row')).toHaveCount(4);await picker.getByRole('button',{name:'Next records',exact:true}).click();}
  await expect(picker.locator('.record-draft-row')).toHaveCount(1);await picker.getByRole('button',{name:'Review draft',exact:true}).click();await expect(page.locator('.record-draft-preview')).toContainText('Recovered Observation 24');await page.locator('[data-preview-recover]').click();
  const review=page.locator('.record-draft-review');await review.getByRole('button',{name:'Save recovered record',exact:true}).click();await expect(review).toHaveCount(0);await expect(page.locator('.record-reader > h1')).toHaveText('Recovered Observation 24');
  const saved=(await f.workspace.read()).book;expect(saved.entries[24]).toEqual({...changes[24].record,updatedAt:saved.entries[24].updatedAt});expect(saved.entries[24].updatedAt).not.toBe(changes[24].record.updatedAt);expect(saved.entries.filter((_,i)=>i!==24)).toEqual(f.book.entries.filter((_,i)=>i!==24));
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();await expect(picker.getByRole('button',{name:'Review draft',exact:true})).toHaveCount(4);
  for(let i=0;i<6;i++)await picker.getByRole('button',{name:'Next records',exact:true}).click();await expect(picker.getByRole('button',{name:'Recovered',exact:true})).toBeDisabled();
 }finally{await f.close();}
});
