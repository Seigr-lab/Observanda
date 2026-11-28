import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {beekeepingFixture} from '../beekeeping-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {navigate,preferences} from './preferences-helper.js';
import {documentRecord} from '../../src/web/record-activity.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {revealInEditor} from './record-editor-helper.js';
import {newRecordOpened,setNewRecordTitle,saveNewRecord,discardNewRecord,openRecordDetail,openTemplateValue,saveRecordValue} from './record-editing-helper.js';

test('inspection subject search pages only saved hives and colonies without loading their bodies',async({page})=>{
 const {book,inspection,record}=beekeepingFixture();
 for(let i=3;i<=63;i++)book.entries.push(record('hive','Hive '+String(i).padStart(2,'0')));
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-hive-picker-')),f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 const load=ResearchCatalogue.prototype.record,bodies=[],fullReads=[],errors=[];
 ResearchCatalogue.prototype.record=function(id,...args){bodies.push(id);return load.call(this,id,...args);};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/workspace/read/page')||r.url().endsWith('/api/notebook'))fullReads.push(r.url());});
 try{
  // The hive or colony an inspection is about is chosen from the record editor's activity and history area;
  // the saved inspection gains the link as one research link of its own values.
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+inspection.id);
  await (await revealInEditor(page,page.getByRole('button',{name:'Choose hive / colony',exact:true}),'Activity and history')).click();
  const dialog=page.getByRole('dialog',{name:'Link hive / colony',exact:true}),choices=dialog.locator('[data-action="research-target-choose"]');
  await expect(choices).toHaveCount(25);await expect(dialog).toContainText('of 64');await expect(dialog.getByRole('button',{name:/Autumn inspection/})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Next results',exact:true}).click();await expect(choices.first()).toBeFocused();await expect(dialog).toContainText('26–50 of 64');
  await dialog.getByLabel('Find in this workspace',{exact:true}).fill('Hive 63');await expect(choices).toHaveCount(1);
  // Searching reads neither the workspace nor any record body (the editor reads the inspection's values);
  // choosing saves the link without reading the subject, then refreshes the view as any saved value does.
  expect(fullReads).toEqual([]);expect(bodies).toEqual([]);
  await choices.first().click();await expect(dialog).not.toBeVisible({timeout:30000});expect(bodies).not.toContain(book.entries.at(-1).id);ResearchCatalogue.prototype.record=load;
  const saved=(await f.workspace.read()).book.entries.find(r=>r.id===inspection.id);expect(saved.relations).toHaveLength(3);expect(saved.relations.at(-1).target.id).toBe(book.entries.at(-1).id);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=load;await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('enable beekeeping, record distinct inspections, reopen hive history and retain a failed save',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(10000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-bee-ui-')),{book,notebook,hive,other,colony,inspection}=beekeepingFixture();
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const main=page.locator('main'),dialog=page.locator('#dialog'),history=()=>page.getByRole('region',{name:'Hive history',exact:true});
 const open=async id=>{await page.goto(app.origin+'/#/records/'+id+'/read');await expect(page.locator('.record-reader')).toBeVisible();};
 // A new record of a lab-book record type is written on the record page: each of its fields is edited in
 // its own dialog from Record details, where the fields are paged a few at a time.
 const value=(kind,key)=>openTemplateValue(page,key,notebook.configuration.sections.find(s=>s.key===kind).fields.findIndex(f=>f.key===key)+1);
 const choose=async(key,choice,{empty=false}={})=>{
  const edit=await value('inspection',key),selected=edit.locator('[data-custom-choice-selected]');if(empty)await expect(selected).toHaveValue('');
  await edit.locator('[data-custom-choice-results]').getByRole('button',{name:choice,exact:true}).click();await expect(selected).toHaveValue(choice);await saveRecordValue(edit);
 };
 try{
  await page.goto(app.url);await navigate(page,'Preferences');await preferences(page,'Templates');
  await expect(main.getByRole('switch',{name:'Enable Beekeeping',exact:true})).not.toBeChecked();
  const enabled=page.waitForResponse(r=>r.url().endsWith('/api/dashboard/pending')&&r.request().method()==='POST'&&r.ok());await main.getByRole('switch',{name:'Enable Beekeeping',exact:true}).check();await enabled;
  await open(hive.id);await expect(history().getByRole('link',{name:inspection.title,exact:true})).toBeVisible();
  // A new inspection of a lab-book record type opens on the record page as a draft; the hive it was
  // started from is linked when the record is seeded.
  await (await revealInEditor(page,history().getByRole('button',{name:'New inspection',exact:true}),'Activity and history')).focus();await page.keyboard.press('Enter');
  await newRecordOpened(page);await expect(page.locator('main h1').first()).toHaveText(/Hive inspection.*Hive 01/,{timeout:30000});
  await setNewRecordTitle(page,'First October inspection');
  await choose('queen','Not seen',{empty:true});await choose('eggs','Observed',{empty:true});await choose('extent','Partial internal');
  const health=await value('inspection','health');await health.locator('[data-record-value]').fill('Stopped before examining the lower box.');await saveRecordValue(health);
  const status=await openRecordDetail(page,'status');await status.locator('[data-record-value]').selectOption('incomplete');await saveRecordValue(status);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.setProperty('--app-font-size','24px'));
  await page.locator('main h1').first().scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:test.info().outputPath('inspection-narrow.png')});
  let lost=false;await page.context().route('**/api/research/drafts/review/apply',async route=>{if(lost)return route.continue();lost=true;await route.fulfill({status:503,json:{code:'IO',message:'Synthetic interrupted save'}});});
  await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('main [role=alert]').first()).toContainText('Synthetic interrupted save');
  expect((await f.workspace.read()).book.entries.find(e=>e.title==='First October inspection')).toBeUndefined();
  await saveNewRecord(page);
  await expect(page.locator('.record-editing h1')).toHaveText('First October inspection',{timeout:60000});
  // The colony is linked from the saved record's activity and history area.
  await (await revealInEditor(page,page.getByRole('button',{name:'Choose hive / colony',exact:true}),'Activity and history')).click();await dialog.getByRole('button',{name:new RegExp(colony.title)}).click();await expect(dialog).not.toBeVisible({timeout:30000});
  const saved=(await f.workspace.read()).book,created=saved.entries.find(e=>e.title==='First October inspection');
  expect(created.template.values).toEqual(expect.objectContaining({queen:'Not seen',eggs:'Observed',extent:'Partial internal',health:'Stopped before examining the lower box.'}));
  expect(created.relations.map(l=>l.target.id).sort()).toEqual([hive.id,colony.id].sort());expect(created.status).toBe('incomplete');expect(created.share).toBe(false);expect(saved.entries.find(e=>e.id===inspection.id)).toEqual(inspection);
  await open(other.id);await expect(history()).toContainText('No linked records yet.');
  await open(hive.id);await expect(history().getByRole('link',{name:created.title,exact:true})).toBeVisible();
  await page.reload();await expect(history().getByRole('link',{name:created.title,exact:true})).toBeVisible();
  await history().getByRole('link',{name:created.title,exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText(created.title);
  const fields=page.getByRole('navigation',{name:'Browse record fields',exact:true});await fields.getByRole('spinbutton',{name:'Go to item',exact:true}).fill(String(created.template.fields.findIndex(field=>field.key==='health')+1));await fields.getByRole('button',{name:'Go',exact:true}).click();await expect(page.locator('.record-reader')).toContainText('Stopped before examining the lower box.');
  await open(colony.id);await expect(page.getByRole('region',{name:'Colony history',exact:true}).getByRole('link',{name:created.title,exact:true})).toBeVisible();await open(hive.id);
  await expect(history().getByRole('link',{name:created.title,exact:true})).toBeVisible();await page.evaluate(()=>document.documentElement.style.setProperty('--app-font-size','24px'));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await history().scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('hive-history-narrow.png')});
  // Another new inspection starts with empty values.
  await (await revealInEditor(page,history().getByRole('button',{name:'New inspection',exact:true}),'Activity and history')).click();await newRecordOpened(page);
  const queen=await value('inspection','queen');await expect(queen.locator('[data-custom-choice-selected]')).toHaveValue('');await queen.getByRole('button',{name:'Close',exact:true}).click();await expect(queen).not.toBeVisible();
  const emptyHealth=await value('inspection','health');await expect(emptyHealth.locator('[data-record-value]')).toHaveValue('');await emptyHealth.getByRole('button',{name:'Close',exact:true}).click();await expect(emptyHealth).not.toBeVisible();
  await discardNewRecord(page);
  // Wait for the discard to finish before opening the next record.
  await expect(main.getByRole('heading',{name:'Apiary',exact:true})).toBeVisible();
  await page.setViewportSize({width:1440,height:1000});await open(hive.id);
  // Other record types are created from the linked-record chooser and entered value by value too.
  await (await revealInEditor(page,history().getByRole('button',{name:'Add linked record',exact:true}),'Activity and history')).click();
  await dialog.getByRole('button',{name:/^Create hive & equipment movement$/i}).click();
  await newRecordOpened(page);await expect(page.locator('main h1').first()).toHaveText(/Hive & equipment movement/,{timeout:30000});
  const to=await value('movement','to');await to.locator('[data-record-value]').fill('Synthetic upper apiary');await saveRecordValue(to);
  await saveNewRecord(page);await expect(page.locator('.record-editing h1')).toHaveText(/Hive & equipment movement/,{timeout:60000});
  await navigate(page,'Preferences');await preferences(page,'Templates');const disabled=page.waitForResponse(r=>r.url().endsWith('/api/dashboard/pending')&&r.request().method()==='POST'&&r.ok());await main.getByRole('switch',{name:'Enable Beekeeping',exact:true}).uncheck();await disabled;
  await open(hive.id);await expect(history().getByRole('button',{name:'New inspection',exact:true})).toHaveCount(0);await expect(history().getByRole('link',{name:created.title,exact:true})).toBeVisible();
  expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('hive history pages navigate backwards and recover a failed page request',async({page})=>{
 test.setTimeout(60000);page.setDefaultTimeout(10000);
 const {book,hive,record}=beekeepingFixture();
 for(let i=0;i<24;i++){const r=record('inspection','Visit '+i,'2026-09-'+String(i+1).padStart(2,'0'));documentRecord(book.id,r,hive);book.entries.push(r);}
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-bee-pages-')),f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 const history=page.getByRole('region',{name:'Hive history',exact:true}),links=history.locator('ol a');
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+hive.id+'/read');await expect(links).toHaveCount(10);
  const first=await links.allTextContents();await expect(history.getByRole('button',{name:'Previous records',exact:true})).toBeDisabled();
  await history.getByRole('button',{name:'Next records',exact:true}).focus();await page.keyboard.press('Enter');await expect(history.locator('[data-activity-status]')).toBeFocused();await expect(history).toContainText('11–20 of 25');
  const second=await links.allTextContents();await history.getByRole('button',{name:'Next records',exact:true}).click();await expect(links).toHaveCount(5);await expect(history).toContainText('21–25 of 25');
  await history.getByRole('button',{name:'Previous records',exact:true}).click();await expect(links).toHaveText(second);await history.getByRole('button',{name:'Previous records',exact:true}).click();await expect(links).toHaveText(first);
  await page.context().route('**/api/research/records/query',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic history unavailable'})}),{times:1});
  await history.getByRole('button',{name:'Next records',exact:true}).click();await expect(history.getByRole('alert')).toContainText('Synthetic history unavailable');await history.getByRole('button',{name:'Retry linked records',exact:true}).click();await expect(links).toHaveText(first);
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('ordinary records use the same linked history and dedicated creation workflow',async({page})=>{
 test.setTimeout(60000);page.setDefaultTimeout(10000);
 const {book,hive,inspection}=beekeepingFixture();hive.template=null;hive.title='A seasonal investigation';
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-linked-records-ui-')),f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 const history=page.getByRole('region',{name:'Linked records',exact:true}),dialog=page.locator('#dialog');
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+hive.id+'/read');
  await expect(history.getByRole('button',{name:'New inspection',exact:true})).toHaveCount(0);await history.getByRole('button',{name:'Show linked records',exact:true}).click();
  await expect(history.getByRole('link',{name:inspection.title,exact:true})).toBeVisible();
  // Linked records are added from the record editor's activity and history area; a free-form note opens the writing editor.
  await (await revealInEditor(page,history.getByRole('button',{name:'Add linked record',exact:true}),'Activity and history')).click();await dialog.getByRole('button',{name:'Create free-form note',exact:true}).click();
  await newRecordOpened(page);await setNewRecordTitle(page,'Interpretation after a second visit');await saveNewRecord(page);await expect(page.locator('.record-editing h1')).toHaveText('Interpretation after a second visit',{timeout:30000});
  const created=(await f.workspace.read()).book.entries.find(e=>e.title==='Interpretation after a second visit');expect(created.relations).toEqual([expect.objectContaining({type:'Documents',target:{workspaceId:book.id,kind:'record',id:hive.id}})]);
  await page.getByRole('button',{name:'Back to records',exact:true}).click();await expect(page.locator('#entry-results')).toBeVisible();
  await page.goto(app.origin+'/#/records/'+hive.id+'/read');await history.getByRole('button',{name:'Show linked records',exact:true}).click();await history.getByRole('link',{name:created.title,exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText(created.title);
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
