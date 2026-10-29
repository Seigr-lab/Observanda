import {builtAssets} from './built-assets-helper.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {queryFixture} from '../record-query-fixture.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {writeWorkspaceDashboard,readWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {workspaceModules} from '../../src/modules/index.js';
import {navigate} from './preferences-helper.js';

async function fixture(page,count){
 page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-timeline-ui-')),book=upgradeNotebook(queryFixture()),seeds=book.entries;
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seeds[i%6]),id:i===0?'aaaaaaaa-0000-4000-8000-000000000000':i===28?'bbbbbbbb-0000-4000-8000-000000000000':randomUUID(),title:'Take '+String(i).padStart(3,'0'),body:'PRIVATE_ORIGINAL_'+i,occurredOn:i===count-1?{kind:'unknown'}:'2026-06-'+String(1+i%28).padStart(2,'0')}));
 const f=await encryptedFixture(directory,book),settings=defaultDashboard();settings.views[0].panels=[];settings.enabledModules.push('timeline');
 await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json'),browserAssets:await builtAssets(directory)}),bodies=[],requests=[],contentReads=[],errors=[],original=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=function(id,...args){bodies.push(id);return original.call(this,id,...args);};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);if(r.url().endsWith('/api/workspace/read/record-content'))contentReads.push(r.postDataJSON().recordId);});
 return {...f,app,book,bodies,requests,contentReads,errors,async close(){ResearchCatalogue.prototype.record=original;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}};
}

for(const count of [62,620])test('timeline pages, combined sources and saved settings load no '+count+'-record corpus',async({page})=>{
 test.setTimeout(150000);const f=await fixture(page,count),main=page.locator('main'),results=main.locator('[data-timeline-results]');
 try{
  await page.goto(f.app.url);await navigate(page,'Timeline');await main.getByRole('button',{name:'New timeline',exact:true}).click();await main.getByLabel('Name',{exact:true}).fill('Field and studio chronology');
  await expect(main.locator('.tool-branch li')).toHaveCount(50);await expect(results.locator('[data-timeline-status]')).toHaveText(count+' matching records / showing 1 to 50');
  await page.route('**/api/projects/timeline-collection/query',route=>route.fulfill({status:503,json:{message:'Synthetic page interruption'}}),{times:1});
  await results.getByRole('button',{name:'Next records',exact:true}).click();await expect(results.getByRole('alert')).toContainText('Synthetic page interruption');await expect(main.locator('.tool-branch li')).toHaveCount(50);
  await results.getByRole('button',{name:'Retry records',exact:true}).focus();await page.keyboard.press('Enter');await expect(results.locator('[data-timeline-status]')).toContainText('showing 51 to');await expect(results.locator('[data-timeline-status]')).toBeFocused();
  const second=await main.locator('.tool-branch li button').allTextContents();await results.getByRole('button',{name:'Previous records',exact:true}).click();await expect(results.locator('[data-timeline-status]')).toContainText('showing 1 to 50');
  if(!await main.getByText('Sources and display',{exact:true}).evaluate(node=>node.parentElement.open))await main.getByText('Sources and display',{exact:true}).click();await main.getByLabel('Branches',{exact:true}).selectOption('project');await expect.poll(async()=> (await main.locator('.tool-branch h2').allTextContents()).sort()).toEqual(f.book.projects.filter(p=>f.book.notebooks.some(n=>n.projectId===p.id)).map(p=>p.title).sort());
  await main.getByLabel('Title or tag',{exact:true}).fill('Take 061');await expect(main.locator('.tool-branch li')).toHaveCount(1);await main.getByLabel('Newest first',{exact:true}).check();await expect(main.locator('.tool-branch li button')).toHaveText('Take 061');
  await main.getByLabel('Title or tag',{exact:true}).fill('');await main.getByLabel('Newest first',{exact:true}).uncheck();await expect(main.locator('.tool-branch li')).toHaveCount(50);
  const sources=main.locator('details').filter({has:page.locator('[data-timeline-source]')});await sources.getByLabel(f.book.projects[0].title,{exact:true}).check();await sources.getByLabel(f.book.notebooks[1].title,{exact:true}).check();
  const expected=f.book.entries.filter(r=>r.notebookId!==f.book.notebooks[2].id).length;await expect(results.locator('[data-timeline-status]')).toContainText(expected+' matching records');
  await page.route('**/api/modules/command*',route=>route.fulfill({status:503,json:{message:'Synthetic timeline save interruption'}}),{times:1});
  await main.getByRole('button',{name:'Save timeline',exact:true}).click();await expect(main.getByRole('alert')).toContainText('Synthetic timeline save interruption');await expect(main.getByLabel('Name',{exact:true})).toHaveValue('Field and studio chronology');
  await main.getByRole('button',{name:'Save timeline',exact:true}).click();await expect(main.locator('.module-subtabs [aria-current=page]')).toHaveText('Timeline');await page.reload();await expect(results.locator('[data-timeline-status]')).toContainText(expected+' matching records');
  const saved=(await workspaceModules(f.workspace).current()).entities.find(e=>e.type==='timeline-view');expect(saved.data.projects).toEqual([f.book.projects[0].id]);expect(saved.data.books).toEqual([f.book.notebooks[1].id]);expect(saved.data.groupBy).toBe('project');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='20px');await page.screenshot({path:test.info().outputPath('timeline-phone.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(f.bodies).toEqual([]);expect(f.requests.filter(p=>p==='/api/workspace/read/page')).toEqual([]);expect(f.errors).toEqual([]);expect(second.length).toBe(Math.min(50,count-50));
  await results.getByRole('button',{name:'Next records',exact:true}).click();await expect(results.locator('[data-timeline-status]')).toContainText('showing 51 to');const reopened=await main.locator('.tool-branch li button').allTextContents();
  const selected=await main.locator('.tool-branch li button').first().getAttribute('data-id');await main.locator('.tool-branch li button').first().click();await expect(main.getByRole('button',{name:'New timeline',exact:true})).toHaveCount(0);await expect(main.getByRole('heading',{name:f.book.entries.find(record=>record.id===selected).title,exact:true})).toBeVisible();await expect(main.getByText(f.book.entries.find(record=>record.id===selected).body,{exact:true})).toBeVisible();expect([...new Set(f.contentReads)]).toEqual([selected]);expect(f.bodies).toEqual([]);
  await page.goBack();await expect(results.locator('[data-timeline-status]')).toContainText('showing 51 to');expect(await main.locator('.tool-branch li button').allTextContents()).toEqual(reopened);
 }finally{await f.close();}
});

test('timeline ignores stale replies, rejects malformed pages and explicitly refreshes after concurrent edits',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page,62),main=page.locator('main'),results=main.locator('[data-timeline-results]');let release;
 try{
  await page.goto(f.app.url);await navigate(page,'Timeline');await main.getByRole('button',{name:'New timeline',exact:true}).click();await main.getByLabel('Name',{exact:true}).fill('Live view');await expect(main.locator('.tool-branch li')).toHaveCount(50);
  await page.route('**/api/projects/timeline-collection/query',route=>route.fulfill({json:{workspaceId:f.book.id,records:[]}}),{times:1});await results.getByRole('button',{name:'Next records',exact:true}).click();await expect(results.getByRole('alert')).toContainText('The timeline response was incomplete');await results.getByRole('button',{name:'Retry records',exact:true}).click();await expect(main.locator('.tool-branch li')).toHaveCount(12);
  const titles=await main.locator('.tool-branch li button').allTextContents(),record=f.book.entries[61];
  await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Latest visit'}}]},{recordIds:[record.id]});f.bodies.length=0;
  await results.getByRole('button',{name:'Previous records',exact:true}).click();await expect(results).toContainText('Records changed while you were browsing');await results.getByRole('button',{name:'Next records',exact:true}).click();await expect(main.locator('.tool-branch li')).toHaveCount(12);expect(await main.locator('.tool-branch li button').allTextContents()).toEqual(titles);
  await main.locator('.module-heading').getByRole('button',{name:'Refresh',exact:true}).click();await expect(results.locator('[data-timeline-status]')).toContainText('showing 1 to 50');await expect(results).not.toContainText('Records changed while you were browsing');
  let arrived;const held=new Promise(r=>release=r),received=new Promise(r=>arrived=r);await page.route('**/api/projects/timeline-collection/query',async route=>{const response=await route.fetch();arrived();await held;await route.fulfill({response}).catch(()=>{});},{times:1});
  await results.getByRole('button',{name:'Next records',exact:true}).click();await received;if(!await main.getByText('Sources and display',{exact:true}).evaluate(node=>node.parentElement.open))await main.getByText('Sources and display',{exact:true}).click();await main.getByLabel('Title or tag',{exact:true}).fill('Latest visit');await expect(main.locator('.tool-branch li')).toHaveCount(1);release();await expect(main.locator('.tool-branch li button')).toHaveText('Latest visit');
  await main.getByLabel('From',{exact:true}).fill('2026-01-01');await expect(results).toContainText('No records match');await main.getByLabel('Through',{exact:true}).fill('2025-01-01');await expect(results.getByRole('alert')).toContainText('Choose valid dates');await main.getByLabel('Through',{exact:true}).fill('');await main.getByLabel('From',{exact:true}).fill('');await expect(main.locator('.tool-branch li')).toHaveCount(1);
  expect(f.bodies).toEqual([]);expect(f.errors).toEqual([]);
 }finally{release?.();await f.close();}
});
