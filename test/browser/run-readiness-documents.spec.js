import {test,expect} from '@playwright/test';
import path from 'node:path';
import {figureValueFixture} from '../record-figure-values-fixture.js';
import {testServer} from '../device-fixture.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchMaterials} from '../../src/research-materials.js';

test('large-record reader links completion evidence and changes progress without loading a full editor',async({page})=>{
 test.setTimeout(120000);const f=await figureValueFixture({large:true}),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),read=ResearchCatalogue.prototype.record,owner=ResearchMaterials.prototype.owner,errors=[],requests=[];
 ResearchCatalogue.prototype.record=()=>{throw Error('Readiness reconstructed a record');};ResearchMaterials.prototype.owner=()=>{throw Error('Readiness reconstructed the owner');};page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);});
 const dialog=page.locator('#dialog'),open=async()=>{await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();await dialog.getByRole('button',{name:'Run readiness',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Run readiness',exact:true})).toBeVisible();};
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');await open();await dialog.getByRole('button',{name:'Link receipt',exact:true}).click();
  for(const [label,value] of [['Private source revision','Acquisition one'],['Source SHA-256','a'.repeat(64)],['Scope and verification statement','Exact source inspected; interpretation remains bounded.'],['Validation tool','Independent inspection'],['Tool version','1'],['Tool source SHA-256','b'.repeat(64)]])await dialog.getByLabel(label,{exact:true}).fill(value);
  await dialog.getByRole('button',{name:'Save receipt',exact:true}).click();await expect(dialog).toContainText('Exact source inspected; interpretation remains bounded.');await dialog.getByText('Project completion policy',{exact:true}).click();await dialog.getByLabel('Validation',{exact:true}).check();await dialog.getByRole('button',{name:'Save completion policy',exact:true}).click();await expect(dialog.getByLabel('Validation',{exact:true})).not.toBeVisible();await dialog.getByRole('button',{name:'Back to evidence',exact:true}).click();await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('[data-record-detail-field]').selectOption('status');await page.getByRole('button',{name:'Edit selected detail',exact:true}).click();const editor=page.getByRole('dialog',{name:'Edit Progress',exact:true});await editor.getByRole('combobox',{name:'Progress',exact:true}).selectOption('completed');
  const saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/research/records/values/save'),removed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/research/drafts/remove');await editor.getByRole('button',{name:'Save changes',exact:true}).click();expect((await saved).ok()).toBe(true);expect((await removed).ok()).toBe(true);
  await expect(editor).not.toBeVisible();expect((await f.values.read({workspaceId:f.book.id,recordId:f.record.id,field:'status'})).value.value).toBe('completed');
  await open();await expect(dialog).not.toContainText('Required completion receipts missing');await expect(dialog).toContainText('Exact source inspected; interpretation remains bounded.');expect(requests).not.toContain('/api/workspace/read/selection');expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=read;ResearchMaterials.prototype.owner=owner;await app.close();await f.close();}
});
