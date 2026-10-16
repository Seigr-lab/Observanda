import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {queryFixture} from '../record-query-fixture.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {defaultDashboard,createPanel} from '../../src/web/dashboard-model.js';
import {writeWorkspaceDashboard,readWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {navigate} from './preferences-helper.js';

for(const count of [42,420])test('sample review, amendment and dashboard cards do not read a '+count+'-record research corpus',async({page,context})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-sample-scope-')),book=upgradeNotebook(queryFixture()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Record '+i,body:'UNRELATED_BODY_'+i}));
 const f=await encryptedFixture(directory,book),settings=defaultDashboard();settings.enabledModules.push('laboratory');settings.views[0].panels=['samples','analyses','lab-events','laboratory'].map(id=>createPanel(id,id));
 await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),read=ResearchCatalogue.prototype.read,record=ResearchCatalogue.prototype.record,errors=[],requests=[];
 ResearchCatalogue.prototype.read=()=>{throw Error('Full research read in sample analysis');};ResearchCatalogue.prototype.record=()=>{throw Error('Unrelated research body in sample analysis');};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));
 const dialog=page.locator('#dialog');
 try{
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Sample analysis overview',exact:true})).toBeVisible();
  await page.evaluate(()=>location.hash='#/laboratory/samples');await page.getByRole('button',{name:'Register sample',exact:true}).click();
  await dialog.getByLabel('Sample code',{exact:true}).fill('S-01');await dialog.getByLabel('Material / specimen',{exact:true}).fill('Synthetic water');await dialog.getByLabel('Source reference (optional)').fill('PRIVATE_SOURCE_REFERENCE');
  await page.route('**/api/laboratory/change*',route=>route.fulfill({status:503,json:{message:'Synthetic sample save interruption'}}),{times:1});
  await dialog.getByRole('button',{name:'Register sample',exact:true}).click();await expect(dialog.getByLabel('Sample code',{exact:true})).toHaveValue('S-01');
  await expect(page.getByRole('status').filter({hasText:'Synthetic sample save interruption'})).toContainText('Synthetic sample save interruption');await dialog.getByRole('button',{name:'Register sample',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'Record analysis',exact:true}).click();await dialog.getByLabel('Analysis code',{exact:true}).fill('A-01');await dialog.getByLabel('Method / version',{exact:true}).fill('Optical method v1');await dialog.getByLabel('Analyte',{exact:true}).fill('Absorbance');await dialog.getByLabel('Result value',{exact:true}).fill('0.34');await dialog.getByLabel('Unit (required for numeric results)').fill('AU');await dialog.getByLabel('Lower interval limit (optional)').fill('0');await dialog.getByLabel('Upper interval limit (optional)').fill('1');await dialog.getByRole('button',{name:'Save analysis',exact:true}).click();
  await page.getByRole('button',{name:'A-01',exact:true}).click();await dialog.getByRole('button',{name:'Save and submit for review',exact:true}).click();await page.getByRole('button',{name:'A-01',exact:true}).click();await dialog.getByRole('button',{name:'Review result',exact:true}).click();
  await dialog.getByLabel('Reviewer name',{exact:true}).fill('Synthetic reviewer');await dialog.getByLabel('I checked sample identity').check();await expect(dialog).toContainText('It is not an authenticated electronic signature.');await dialog.getByRole('button',{name:'Record review',exact:true}).click();
  await page.getByRole('button',{name:/^Analyses /}).click();await page.getByRole('button',{name:'A-01',exact:true}).click();
  const popup=context.waitForEvent('page');await dialog.getByRole('link',{name:'Open printable result',exact:true}).click();const sheet=await popup;await sheet.waitForLoadState();await expect(sheet.getByRole('cell',{name:'0.34',exact:true})).toBeVisible();const oldSheet=sheet.url();await sheet.close();
  await dialog.getByRole('button',{name:'Amend result',exact:true}).click();await dialog.getByLabel('Reason for amendment').fill('Transcription correction');await dialog.getByRole('button',{name:'Start amendment',exact:true}).click();await dialog.getByLabel('Result value',{exact:true}).fill('0.35');await dialog.getByRole('button',{name:'Save result',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.reload();await page.getByRole('button',{name:/^Analyses /}).click();await page.getByRole('button',{name:'A-01',exact:true}).click();await expect(dialog.getByLabel('Result value',{exact:true})).toHaveValue('0.35');await expect(dialog).not.toContainText('Reviewed by Synthetic reviewer');const retained=await page.request.get(oldSheet);expect(retained.status()).toBe(200);expect(await retained.text()).toContain('<td>0.34</td>');await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await navigate(page,'Dashboard');await expect(page.locator('main')).toContainText('S-01');await expect(page.locator('main')).toContainText('A-01');expect(requests.filter(p=>p==='/api/notebook'||p==='/api/workspace/read/page')).toEqual([]);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
