import {test,expect} from '@playwright/test';
import path from 'node:path';
import {figureValueFixture} from '../record-figure-values-fixture.js';
import {testServer} from '../device-fixture.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {RecordValues} from '../../src/record-values.js';

test('reader creates and repeats runs with recoverable request identity after a lost response',async({page},info)=>{
 test.setTimeout(150000);const f=await figureValueFixture({large:true}),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),read=ResearchCatalogue.prototype.record,owner=ResearchMaterials.prototype.owner,errors=[],requests=[];
 ResearchCatalogue.prototype.record=()=>{throw Error('Run creation reconstructed the original record');};ResearchMaterials.prototype.owner=()=>{throw Error('Run creation loaded its complete owner');};page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);});const dialog=page.getByRole('dialog',{name:'Add run or take',exact:true});
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');await page.getByText('Organize runs or takes',{exact:true}).click();await page.getByRole('button',{name:'Add run or take',exact:true}).click();await expect(dialog.getByLabel('Run title',{exact:true})).toBeEnabled();await dialog.getByLabel('Run title',{exact:true}).fill('Planned acquisition');
  let created;await page.route('**/api/research/records/runs/create',async route=>{const response=await route.fetch(),text=await response.text();created=JSON.parse(text.trim().split('\n').at(-1));await route.abort('failed');});await dialog.getByRole('button',{name:'Create run',exact:true}).click();await expect(dialog.getByRole('button',{name:'Retry creation',exact:true})).toBeEnabled();await expect(dialog.getByLabel('Run title',{exact:true})).toBeDisabled();await page.unroute('**/api/research/records/runs/create');
  await page.reload();await page.getByText('Organize runs or takes',{exact:true}).click();await page.getByRole('button',{name:'Add run or take',exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText('Planned acquisition');await expect(dialog).not.toBeVisible();expect(created).toBeTruthy();
  const count=await f.workspace.catalogue(async store=>(await store.snapshot()).count);expect(count).toBe(2);
  await page.getByRole('button',{name:'Create another run or take',exact:true}).click();const repeat=page.getByRole('dialog',{name:'Create another run or take',exact:true});await expect(repeat.getByLabel('Run title',{exact:true})).toHaveValue('Planned acquisition — next run');await repeat.getByLabel('Run title',{exact:true}).fill('Repeated acquisition');await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await repeat.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('repeat-run-mobile.png')});await repeat.getByRole('button',{name:'Create run',exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText('Repeated acquisition');const id=page.url().split('/records/')[1].split('/')[0],values=new RecordValues(f.workspace);expect((await values.read({workspaceId:f.book.id,recordId:id,field:'status'})).value.value).toBe('planned');expect((await values.read({workspaceId:f.book.id,recordId:id,field:'share'})).value.value).toBe(false);
  expect(await f.workspace.catalogue(async store=>(await store.snapshot()).count)).toBe(3);expect(requests).not.toContain('/api/workspace/read/selection');expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=read;ResearchMaterials.prototype.owner=owner;await app.close();await f.close();}
});
