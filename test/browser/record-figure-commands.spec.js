import {test,expect} from '@playwright/test';
import path from 'node:path';
import {figureValueFixture} from '../record-figure-values-fixture.js';
import {testServer} from '../device-fixture.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchDrafts} from '../../src/research-drafts.js';

test('create plots and multi-panel figures from the reader and recover an unfinished new figure',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);const f=await figureValueFixture(),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),original=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=()=>{throw Error('Figure creation reconstructed the full record');};const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);});
 const dialog=page.getByRole('dialog',{name:'Edit Figure',exact:true}),save=()=>dialog.getByRole('button',{name:'Save changes',exact:true}).click();
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');await page.getByRole('button',{name:'Add figure',exact:true}).click();await dialog.getByLabel('Figure title',{exact:true}).fill('New reader plot');await dialog.getByLabel('Coordinate 1',{exact:true}).fill('1');
  await expect(dialog.locator('[data-writing-status]')).toHaveText('Recovery checkpoint saved.');await dialog.getByRole('button',{name:'Keep recovery checkpoint and close',exact:true}).click();await page.reload();
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();await expect(dialog.getByLabel('Figure title',{exact:true})).toHaveValue('New reader plot');await expect(dialog.getByLabel('Coordinate 1',{exact:true})).toHaveValue('1');await dialog.getByLabel('Value 1',{exact:true}).fill('2');await save();await expect(dialog).not.toBeVisible();await expect(page.getByRole('button',{name:'Edit figure New reader plot',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Add multi-panel figure',exact:true}).click();await dialog.getByLabel('Multi-panel title',{exact:true}).fill('New panel comparison');
  for(let i=0;i<2;i++){await dialog.getByLabel('Editing panel',{exact:true}).selectOption({index:i});await dialog.getByLabel('Figure title',{exact:true}).fill('Acquisition '+(i+1));await dialog.getByLabel('Coordinate 1',{exact:true}).fill('1');await dialog.getByLabel('Value 1',{exact:true}).fill(String(i+4));}
  await save();await expect(dialog).not.toBeVisible();await expect(page.getByRole('button',{name:'Edit figure New panel comparison',exact:true})).toBeVisible();await expect.poll(async()=>(await new ResearchDrafts(f.workspace).list({workspaceId:f.book.id})).drafts.length).toBe(0);
  expect(requests.filter(route=>/^\/api\/workspace\/read\/(selection|page)$/.test(route)||route==='/api/research/records/save')).toEqual([]);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=original;await app.close();await f.close();}
});

test('reader duplication and removal retry acknowledgements without losing sources or protected placements',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);const f=await figureValueFixture(),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),original=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=()=>{throw Error('Figure collection UI reconstructed a full record');};page.on('dialog',d=>d.accept());const errors=[];page.on('pageerror',e=>errors.push(e.message));let copied,removed,droppedCopy=false,droppedRemove=false;
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');
  await page.route('**/api/research/records/figures',async route=>{const command=route.request().postDataJSON();if(command.action==='duplicate'&&!droppedCopy){droppedCopy=true;copied=command.id;await route.fetch();return route.abort('failed');}if(command.action==='remove'&&!droppedRemove){droppedRemove=true;removed=command.id;await route.fetch();return route.abort('failed');}return route.continue();});
  await page.locator('#record-figure-'+f.record.figures[0].id).getByRole('button',{name:'Duplicate figure',exact:true}).click();await page.getByRole('button',{name:'Retry figure operation',exact:true}).click();const copy=page.locator('#record-figure-'+copied);await expect(copy.getByRole('button',{name:'Inspect calculation',exact:true})).toBeVisible();expect((await f.values.read(f.target(copied))).value.value.source).toEqual(f.analysis);
  await copy.getByRole('button',{name:'Remove figure',exact:true}).click();await page.getByRole('button',{name:'Retry figure operation',exact:true}).click();await expect(copy).toHaveCount(0);expect((await f.values.read(f.target(copied))).value.value).toBeNull();expect(removed).toBeTruthy();
  await page.unroute('**/api/research/records/figures');await page.locator('.book-figure-placement').getByRole('button',{name:'Remove figure',exact:true}).click();await expect(page.locator('#notice')).toContainText('supporting results');await expect(page.locator('.book-figure-placement')).toContainText('Panel comparison');expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=original;await app.close();await f.close();}
});
