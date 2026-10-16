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

test('inspection subject search pages only saved hives and colonies without loading their bodies',async({page})=>{
 const {book,inspection,record}=beekeepingFixture();
 for(let i=3;i<=63;i++)book.entries.push(record('hive','Hive '+String(i).padStart(2,'0')));
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-hive-picker-')),f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 const load=ResearchCatalogue.prototype.record,bodies=[],fullReads=[],errors=[];
 ResearchCatalogue.prototype.record=function(id,...args){bodies.push(id);return load.call(this,id,...args);};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/workspace/read/page')||r.url().endsWith('/api/notebook'))fullReads.push(r.url());});
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+inspection.id);await page.getByLabel('Record title',{exact:true}).fill('Inspection with unfinished notes');
  await page.getByRole('button',{name:'Choose hive / colony',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Link hive / colony',exact:true}),choices=dialog.locator('[data-action="research-target-choose"]');
  await expect(choices).toHaveCount(25);await expect(dialog).toContainText('of 64');await expect(dialog.getByRole('button',{name:/Autumn inspection/})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Next results',exact:true}).click();await expect(choices.first()).toBeFocused();await expect(dialog).toContainText('26–50 of 64');
  await dialog.getByLabel('Find in this workspace',{exact:true}).fill('Hive 63');await expect(choices).toHaveCount(1);await choices.first().click();
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Inspection with unfinished notes');await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  expect(fullReads).toEqual([]);expect(new Set(bodies)).toEqual(new Set([inspection.id]));ResearchCatalogue.prototype.record=load;
  const saved=(await f.workspace.read()).book.entries.find(r=>r.id===inspection.id);expect(saved.relations).toHaveLength(3);expect(saved.relations.at(-1).target.id).toBe(book.entries.at(-1).id);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=load;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('enable beekeeping, record distinct inspections, reopen hive history and retain a failed save',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(10000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-bee-ui-')),{book,hive,other,colony,inspection}=beekeepingFixture();
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const main=page.locator('main'),dialog=page.locator('#dialog'),history=()=>page.getByRole('region',{name:'Hive history',exact:true});
 const open=async id=>{await page.goto(app.origin+'/#/records/'+id+'/read');await expect(page.locator('.record-reader')).toBeVisible();};
 const save=async()=>{await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');};
 try{
  await page.goto(app.url);await navigate(page,'Preferences');await preferences(page,'Modules');
  await expect(main.getByRole('switch',{name:'Enable Beekeeping',exact:true})).not.toBeChecked();
  const enabled=page.waitForResponse(r=>r.url().endsWith('/api/dashboard')&&r.request().method()==='POST'&&r.ok());await main.getByRole('switch',{name:'Enable Beekeeping',exact:true}).check();await enabled;
  await open(hive.id);await expect(history().getByRole('link',{name:inspection.title,exact:true})).toBeVisible();
  await history().getByRole('button',{name:'New inspection',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue(/Hive inspection.*Hive 01/);
  await expect(page.getByLabel('Queen observation',{exact:true})).toHaveValue('');await expect(page.getByLabel('Eggs',{exact:true})).toHaveValue('');
  await page.getByLabel('Record title',{exact:true}).fill('First October inspection');
  await page.getByLabel('Queen observation',{exact:true}).selectOption('Not seen');await page.getByLabel('Eggs',{exact:true}).selectOption('Observed');
  await page.getByLabel('Inspection extent',{exact:true}).selectOption('Partial internal');
  await page.getByRole('button',{name:'Choose hive / colony',exact:true}).click();await dialog.getByRole('button',{name:new RegExp(colony.title)}).click();
  await page.getByLabel('Abnormal signs / suspected causes / unexamined areas',{exact:true}).fill('Stopped before examining the lower box.');
  await page.getByLabel('Progress',{exact:true}).selectOption('incomplete');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.setProperty('--app-font-size','24px'));
  await page.getByLabel('Queen observation',{exact:true}).scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:test.info().outputPath('inspection-narrow.png')});
  await page.route('**/api/research/records/save',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic interrupted save'})}),{times:1});
  await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#notice')).toContainText('Synthetic interrupted save');
  await expect(page.getByLabel('Queen observation',{exact:true})).toHaveValue('Not seen');expect((await f.workspace.read()).book.entries).toHaveLength(4);
  await page.locator('#notice').getByRole('button',{name:'Dismiss',exact:true}).click();await save();const saved=(await f.workspace.read()).book,created=saved.entries.find(e=>e.title==='First October inspection');
  expect(created.relations.map(l=>l.target.id).sort()).toEqual([hive.id,colony.id].sort());expect(created.status).toBe('incomplete');expect(created.share).toBe(false);expect(saved.entries.find(e=>e.id===inspection.id)).toEqual(inspection);
  await open(other.id);await expect(history()).toContainText('No linked records yet.');
  await open(hive.id);await expect(history().getByRole('link',{name:created.title,exact:true})).toBeVisible();
  await page.reload();await expect(history().getByRole('link',{name:created.title,exact:true})).toBeVisible();
  await history().getByRole('link',{name:created.title,exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText(created.title);
  const fields=page.getByRole('navigation',{name:'Browse record fields',exact:true});await fields.getByRole('spinbutton',{name:'Go to item',exact:true}).fill(String(created.template.fields.findIndex(field=>field.key==='health')+1));await fields.getByRole('button',{name:'Go',exact:true}).click();await expect(page.locator('.record-reader')).toContainText('Stopped before examining the lower box.');
  await open(colony.id);await expect(page.getByRole('region',{name:'Colony history',exact:true}).getByRole('link',{name:created.title,exact:true})).toBeVisible();await open(hive.id);
  await expect(history().getByRole('link',{name:created.title,exact:true})).toBeVisible();await page.evaluate(()=>document.documentElement.style.setProperty('--app-font-size','24px'));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await history().scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('hive-history-narrow.png')});
  await history().getByRole('button',{name:'New inspection',exact:true}).click();await expect(page.getByLabel('Queen observation',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('Abnormal signs / suspected causes / unexamined areas',{exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'Discard changes',exact:true}).click();
  // Wait for the discard to finish before opening the next record.
  await expect(main.getByRole('heading',{name:'Apiary',exact:true})).toBeVisible();
  await page.setViewportSize({width:1440,height:1000});await open(hive.id);
  await history().getByRole('button',{name:'Add linked record',exact:true}).click();await expect(dialog.getByLabel('Record template')).toBeVisible();
  await dialog.getByLabel('Record template').selectOption({label:'Hive & equipment movement'});await dialog.getByRole('button',{name:'Create record',exact:true}).click();
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue(/Hive & equipment movement/);await page.getByLabel('Destination apiary / address',{exact:true}).fill('Synthetic upper apiary');await save();
  await navigate(page,'Preferences');await preferences(page,'Modules');const disabled=page.waitForResponse(r=>r.url().endsWith('/api/dashboard')&&r.request().method()==='POST'&&r.ok());await main.getByRole('switch',{name:'Enable Beekeeping',exact:true}).uncheck();await disabled;
  await open(hive.id);await expect(history().getByRole('button',{name:'New inspection',exact:true})).toHaveCount(0);await expect(history().getByRole('link',{name:created.title,exact:true})).toBeVisible();
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
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
  await history.getByRole('button',{name:'Next records',exact:true}).focus();await page.keyboard.press('Enter');await expect(history.locator('[data-activity-status]')).toBeFocused();await expect(history).toContainText('11-20 of 25');
  const second=await links.allTextContents();await history.getByRole('button',{name:'Next records',exact:true}).click();await expect(links).toHaveCount(5);await expect(history).toContainText('21-25 of 25');
  await history.getByRole('button',{name:'Previous records',exact:true}).click();await expect(links).toHaveText(second);await history.getByRole('button',{name:'Previous records',exact:true}).click();await expect(links).toHaveText(first);
  await page.route('**/api/research/records/query',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic history unavailable'})}),{times:1});
  await history.getByRole('button',{name:'Next records',exact:true}).click();await expect(history.getByRole('alert')).toContainText('Synthetic history unavailable');await history.getByRole('button',{name:'Retry linked records',exact:true}).click();await expect(links).toHaveText(first);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
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
  await history.getByRole('button',{name:'Add linked record',exact:true}).click();await dialog.getByLabel('Record template').selectOption('type:note');await dialog.getByRole('button',{name:'Create record',exact:true}).click();
  await page.getByLabel('Record title',{exact:true}).fill('Interpretation after a second visit');await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  const created=(await f.workspace.read()).book.entries.find(e=>e.title==='Interpretation after a second visit');expect(created.relations).toEqual([expect.objectContaining({type:'Documents',target:{workspaceId:book.id,kind:'record',id:hive.id}})]);
  await page.getByRole('button',{name:'Back to records',exact:true}).click();await expect(page.locator('#entry-results')).toBeVisible();
  await page.goto(app.origin+'/#/records/'+hive.id+'/read');await history.getByRole('button',{name:'Show linked records',exact:true}).click();await history.getByRole('link',{name:created.title,exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText(created.title);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
