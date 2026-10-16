import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ModuleCatalogue} from '../../src/modules/catalogue.js';
import {ProjectModuleReader} from '../../src/project-module-reader.js';
import {workspaceModules} from '../../src/modules/index.js';
import {seedModuleCurrent} from '../module-current-fixture.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {writeWorkspaceDashboard,readWorkspaceDashboard} from '../../src/security/dashboard-storage.js';

test('reader connected work pages, retries and refreshes without loading records or unrelated module bodies',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(10000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-connected-reader-')),book=sampleNotebook(),record=book.entries[0];
 record.sections=Array.from({length:67},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Retained experiment '.repeat(40)}));
 const f=await encryptedFixture(directory,book),settings=defaultDashboard();settings.views[0].panels=[];settings.enabledModules=[...new Set([...settings.enabledModules,'planning','resources'])];await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const now=new Date().toISOString(),entities=Array.from({length:27},(_,i)=>({id:randomUUID(),type:'task',revision:1,createdAt:now,updatedAt:now,data:{title:i===26?'Other record task':'Linked work '+String(i).padStart(2,'0'),description:'Private working details '.repeat(40),status:'todo',priority:'normal',dueOn:null,assignees:[],checklist:[],dependencies:[],links:[{workspaceId:book.id,type:'record',id:book.entries[i===26?1:0].id}]}}));
 await seedModuleCurrent(f.workspace,book.id,entities);
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),original=ResearchCatalogue.prototype.record,read=ModuleCatalogue.prototype.read,selected=ModuleCatalogue.prototype.selected,errors=[],requests=[],loaded=[];
 ResearchCatalogue.prototype.record=()=>{throw Error('Connected work reconstructed a record');};ModuleCatalogue.prototype.read=()=>{throw Error('Connected work loaded every module');};ModuleCatalogue.prototype.selected=function(head,id){loaded.push(id);return selected.call(this,head,id);};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{const route=new URL(r.url()).pathname;if(/^\/api\/workspace\/read\/(selection|page)$/.test(route))requests.push(route);});
 const panel=page.locator('[data-module-links]');let release;
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');await expect(panel.getByRole('status')).toHaveText('Items 1–25 of 26');await expect(panel.getByRole('button',{name:'Other record task',exact:true})).toHaveCount(0);
  await page.route('**/api/modules/references/incoming',route=>route.fulfill({status:503,json:{message:'Interrupted connected-work page'}}),{times:1});await panel.getByRole('button',{name:'Next items',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('Interrupted connected-work page');await expect(panel.locator('.module-collection > p')).toHaveCount(25);
  await panel.getByRole('button',{name:'Retry connected work',exact:true}).click();await expect(panel.getByRole('status')).toHaveText('Items 26–26 of 26');expect(loaded).toEqual([]);expect(requests).toEqual([]);
  const extra={...entities[0].data,title:'Newly connected task'};await workspaceModules(f.workspace).execute({workspaceId:book.id,commandId:randomUUID(),action:'task.save',payload:{id:randomUUID(),expectedRevision:null,data:extra}},{compact:true});loaded.length=0;
  await panel.getByRole('button',{name:'Refresh connected work',exact:true}).click();await expect(panel.getByRole('status')).toHaveText('Items 1–25 of 27');await panel.getByRole('button',{name:'Next items',exact:true}).click();await expect(panel.getByRole('status')).toHaveText('Items 26–27 of 27');expect(loaded).toEqual([]);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');await panel.scrollIntoViewIfNeeded();expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('reader-connected-phone.png')});await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>document.documentElement.style.fontSize='');
  let ready;const started=new Promise(resolve=>ready=resolve),gate=new Promise(resolve=>release=resolve);await page.route('**/api/modules/references/incoming',async route=>{const response=await route.fetch();ready();await gate;await route.fulfill({response}).catch(()=>{});},{times:1});await panel.getByRole('button',{name:'Previous items',exact:true}).click();await started;
  await page.goto(app.origin+'/#/records/'+book.entries[1].id+'/read');release();await page.unrouteAll({behavior:'wait'});await expect(panel.getByRole('status')).toHaveText('Items 1–1 of 1');await expect(panel.getByRole('button',{name:'Other record task',exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'Linked work 00',exact:true})).toHaveCount(0);expect(loaded).toEqual([]);
  await panel.getByRole('button',{name:'Other record task',exact:true}).click();await expect(page.getByLabel('Task title',{exact:true})).toHaveValue('Other record task');expect(new Set(loaded)).toEqual(new Set([entities[26].id]));await expect(page.locator('.module-workbench')).toHaveAttribute('aria-busy','false');
  await page.goto(app.origin+'/#/records/'+record.id+'/read');await panel.getByRole('button',{name:'New bill of materials',exact:true}).click();await expect(page.getByLabel('Prototype / run record',{exact:true})).toHaveText(record.title);await page.getByLabel('BOM title',{exact:true}).fill('Parts for this observation');await page.getByRole('button',{name:'Add component',exact:true}).click();await page.getByLabel('Value / description',{exact:true}).fill('Calibration fixture');await page.getByRole('button',{name:'Save BOM',exact:true}).click();await expect(page.locator('[data-module-status]')).toHaveText('Saved');
  ModuleCatalogue.prototype.read=read;const reader=new ProjectModuleReader(f.workspace,book.id),bom=(await reader.list({workspaceId:book.id,type:'bom'})).items[0],saved=(await reader.selected({workspaceId:book.id,id:bom.id})).entity;expect(saved.data.recordId).toBe(record.id);expect(saved.data.recordTitle).toBe(record.title);expect(saved.data.recordRevision).toMatch(/^[a-f0-9]{64}$/);
  await expect(page.locator('.module-workbench')).toHaveAttribute('aria-busy','false');await page.locator('.module-link').getByRole('button',{name:record.title,exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText(record.title);
  expect(requests).toEqual([]);expect(errors).toEqual([]);
 }finally{release?.();await page.unrouteAll({behavior:'wait'});ResearchCatalogue.prototype.record=original;ModuleCatalogue.prototype.read=read;ModuleCatalogue.prototype.selected=selected;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
