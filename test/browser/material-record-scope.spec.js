import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {queryFixture} from '../record-query-fixture.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {writeWorkspaceDashboard,readWorkspaceDashboard} from '../../src/security/dashboard-storage.js';

for(const count of [62,620])test('external analysis discovers and pins exact methods without loading a '+count+'-record workspace',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-evidence-scope-')),book=upgradeNotebook(queryFixture()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Take '+String(i).padStart(3,'0'),body:'PRIVATE_ORIGINAL_'+i,figures:[],relations:[]}));
 const owner=book.entries[0],method=book.entries[30],f=await encryptedFixture(directory,book),settings=defaultDashboard();settings.views[0].panels=[];
 await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const materials=new ResearchMaterials(f.workspace),input=await materials.collection({recordId:owner.id,title:'Session evidence',inputs:[]});
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const originalRead=ResearchCatalogue.prototype.read,originalRecord=ResearchCatalogue.prototype.record,bodies=[],requests=[],errors=[],service=new ResearchRecords(f.workspace,{});
 ResearchCatalogue.prototype.read=function(){throw Error('Unexpected full workspace read during evidence workflow');};
 ResearchCatalogue.prototype.record=function(id,...args){bodies.push(id);return originalRecord.call(this,id,...args);};
 page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));
 const dialog=page.locator('#dialog'),picker=dialog.locator('[data-method-picker]');let release;
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,owner.id);
  await page.getByRole('button',{name:'Open evidence & analysis'}).click();
  await dialog.getByText('Analysis, collections & verification',{exact:true}).click();await dialog.getByRole('button',{name:'Record external analysis',exact:true}).click();
  await dialog.getByLabel('Title',{exact:true}).fill('Retained listening comparison');await dialog.getByLabel('Tool / method',{exact:true}).fill('Listening review');await dialog.getByLabel('Tool version or source revision',{exact:true}).fill('revision one');
  await dialog.getByLabel('Parameters and procedure',{exact:true}).fill('Compare each take with the original room conditions.');
  await dialog.locator('#material-picker-inputs').getByRole('checkbox',{name:/Session evidence/}).check();
  await dialog.getByRole('button',{name:'Choose saved method / run',exact:true}).click();await expect(picker.locator('[data-action="research-target-choose"]')).toHaveCount(25);
  expect(bodies).toEqual([]);
  await picker.getByRole('button',{name:'Next results',exact:true}).click();await expect(picker.getByRole('button',{name:/Take 030/})).toBeVisible();
  // A changed result must be explicitly refreshed. The surrounding analysis
  // draft and previously selected evidence remain mounted through the retry.
  let changed={...method,body:'Changed method before selection.'};
  await service.save({workspaceId:book.id,changes:[{id:method.id,expectedRevision:recordRevision(method),record:changed}]},{recordIds:[method.id]});
  changed=await f.workspace.catalogue(async store=>store.record(method.id,(await store.member(await store.snapshot(),method.id)).revision));
  await picker.getByRole('button',{name:/Take 030/}).click();await expect(picker.getByRole('alert')).toContainText('That record changed after this search');
  await expect(dialog.getByLabel('Title',{exact:true})).toHaveValue('Retained listening comparison');await expect(dialog.locator('#material-picker-inputs').getByRole('checkbox',{name:/Session evidence/})).toBeChecked();
  await picker.getByRole('button',{name:'Refresh results',exact:true}).click();await picker.getByLabel('Find in this workspace').fill('Take 030');await expect(picker.locator('[data-action="research-target-choose"]')).toHaveCount(1);
  await picker.getByRole('button',{name:/Take 030/}).focus();await page.keyboard.press('Enter');await expect(picker).toBeHidden();await expect(dialog.locator('[data-method-summary]')).toContainText('Retained revision '+recordRevision(changed).slice(0,12));
  // A later edit cannot change the revision selected for this analysis.
  const latest={...changed,title:'Later method',body:'Later method revision.'};await service.save({workspaceId:book.id,changes:[{id:method.id,expectedRevision:recordRevision(changed),record:latest}]},{recordIds:[method.id]});
  await dialog.getByLabel('Unrecorded identities and why they are unavailable').fill('Manual procedure; no executable tool source.');await dialog.getByLabel('Uncertainty convention / unknown uncertainty').fill('Not quantified.');await dialog.getByLabel('Sources, scope and limitations').fill('Fixture observations only.');await dialog.getByRole('button',{name:'Save analysis',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible();
  const head=(await materials.list({recordId:owner.id,kind:'analysis'})).items[0],doc=await materials.read(head),refs=(await materials.referencePage(head)).items;
  expect(doc.title).toBe('Retained listening comparison');expect(doc.content.parameters).toBe('Compare each take with the original room conditions.');
  expect(refs.map(({kind,id,revision,workspaceId})=>({kind,id,revision,...(workspaceId?{workspaceId}:{})}))).toEqual([input,{kind:'record',id:method.id,revision:recordRevision(changed),workspaceId:book.id}]);
  await dialog.locator('.material-list li').filter({hasText:'Retained listening comparison'}).getByRole('button',{name:'Inspect',exact:true}).click();await dialog.locator('#material-input-references').getByRole('button',{name:'Take 030',exact:true}).click();
  await expect(dialog).toContainText('Changed method before selection.');await expect(dialog).not.toContainText('Later method revision.');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Open evidence & analysis'}).click();await dialog.getByText('Analysis, collections & verification',{exact:true}).click();await dialog.getByRole('button',{name:'Record external analysis',exact:true}).click();
  await dialog.getByRole('button',{name:'Choose saved method / run',exact:true}).click();await expect(picker.locator('[data-action="research-target-choose"]')).toHaveCount(25);
  await page.route('**/api/research/records/query',route=>route.fulfill({status:503,json:{message:'Synthetic discovery interruption'}}),{times:1});
  await picker.getByRole('button',{name:'Next results',exact:true}).click();await expect(picker.getByRole('alert')).toContainText('Synthetic discovery interruption');await picker.getByRole('button',{name:'Refresh results',exact:true}).click();await expect(picker.locator('[data-action="research-target-choose"]')).toHaveCount(25);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='20px');expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:test.info().outputPath('analysis-method-phone.png')});
  let arrived;const held=new Promise(r=>release=r),received=new Promise(r=>arrived=r);await page.route('**/api/research/materials/pin',async route=>{const response=await route.fetch();arrived();await held;await route.fulfill({response}).catch(()=>{});},{times:1});
  await picker.getByRole('button',{name:/Take 000/}).click();await received;
  await picker.getByRole('button',{name:'Cancel',exact:true}).click();await expect(picker).toBeHidden();await expect(dialog.getByRole('heading',{name:'Record external analysis',exact:true})).toBeVisible();
  release();await expect(dialog.locator('[data-method-summary]')).toHaveText('No saved method or run selected.');
  expect([...new Set(bodies)]).toEqual([method.id]);expect(requests.filter(p=>p==='/api/notebook'||p==='/api/workspace/read/page')).toEqual([]);expect(errors).toEqual([]);
 }finally{release?.();ResearchCatalogue.prototype.read=originalRead;ResearchCatalogue.prototype.record=originalRecord;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
