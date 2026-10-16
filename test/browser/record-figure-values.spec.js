import {test,expect} from '@playwright/test';
import path from 'node:path';
import {figureValueFixture} from '../record-figure-values-fixture.js';
import {testServer} from '../device-fixture.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchDrafts} from '../../src/research-drafts.js';

test('reader figures recover unfinished work, resolve conflicts and save without loading the full record',async({page},info)=>{
 page.setDefaultTimeout(15000);
 test.setTimeout(240000);const f=await figureValueFixture(),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),original=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=()=>{throw Error('Reader figure editing reconstructed the full record');};
 const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);});page.on('dialog',d=>d.accept());
 const dialog=page.getByRole('dialog',{name:'Edit Figure',exact:true}),save=()=>dialog.getByRole('button',{name:'Save changes',exact:true}).click(),compound=f.record.figures[8];
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');
  await page.locator('.book-figure-placement').getByRole('button',{name:'Edit figure Panel comparison',exact:true}).click();await expect(dialog.getByLabel('Multi-panel title',{exact:true})).toHaveValue('Panel comparison');
  await dialog.getByRole('button',{name:'Remove panel',exact:true}).click();await expect(dialog.locator('[data-figure-message]')).toContainText('result');expect(await dialog.getByLabel('Editing panel',{exact:true}).locator('option').count()).toBe(3);
  await dialog.getByLabel('Multi-panel title',{exact:true}).fill('Recovered comparison');await dialog.getByLabel('Editing panel',{exact:true}).selectOption(compound.panels[1].id);await dialog.getByLabel('Value 1',{exact:true}).fill('3.25');
  await expect(dialog.locator('[data-writing-status]')).toHaveText('Recovery checkpoint saved.');await dialog.getByRole('button',{name:'Keep recovery checkpoint and close',exact:true}).click();await page.reload();
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();await expect(dialog.getByLabel('Multi-panel title',{exact:true})).toHaveValue('Recovered comparison');
  await dialog.getByLabel('Editing panel',{exact:true}).selectOption(compound.panels[1].id);await expect(dialog.getByLabel('Value 1',{exact:true})).toHaveValue('3.25');
  const base=await f.values.read(f.target(compound.id)),other=structuredClone(base.value.value);other.title='Other session comparison';await f.save(base,other);
  await save();await expect(dialog.locator('.record-writing-conflict')).toContainText('Other session comparison');await dialog.getByRole('button',{name:'Keep my edit after review',exact:true}).click();
  const first=await f.values.read(f.target(f.record.figures[0].id));await f.save(first,{...first.value.value,title:'Concurrent unrelated plot'});
  let dropped=false;await page.route('**/api/research/records/values/save',async route=>{if(dropped)return route.continue();dropped=true;await route.fetch();await route.abort('failed');});await save();await expect(dialog.locator('[data-writing-error]')).not.toBeEmpty();await save();await expect(dialog).not.toBeVisible();await page.unroute('**/api/research/records/values/save');
  await expect(page.locator('.book-figure-placement')).toContainText('Recovered comparison');expect((await f.values.read(f.target(compound.id))).value.value.panels[1].figure.series[0].points[0].y).toBe(3.25);expect((await f.values.read(f.target(first.value.value.id))).value.value.title).toBe('Concurrent unrelated plot');
  await page.getByRole('button',{name:'Edit figure Recovered comparison',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('reader-figure-mobile.png')});await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await expect.poll(async()=>(await new ResearchDrafts(f.workspace).list({workspaceId:f.book.id})).drafts.length).toBe(0);expect(requests.filter(route=>/^\/api\/workspace\/read\/(selection|page)$/.test(route)||route==='/api/research/records/save')).toEqual([]);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=original;await app.close();await f.close();}
});

test('reader plot controls edit retained figures and apply mapped data using the existing editor',async({page},info)=>{
 page.setDefaultTimeout(15000);
 test.setTimeout(180000);const f=await figureValueFixture(),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),original=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=()=>{throw Error('Reader plot editing reconstructed the full record');};const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const dialog=page.getByRole('dialog',{name:'Edit Figure',exact:true}),save=()=>dialog.getByRole('button',{name:'Save changes',exact:true}).click(),first=f.record.figures[0];
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');await page.getByRole('button',{name:'Edit figure Observation 0',exact:true}).click();
  await expect(dialog.locator('[data-action="material-figure-source"]')).toHaveCount(1);await dialog.getByRole('button',{name:'Inspect calculation',exact:true}).click();const evidence=page.locator('#dialog');await expect(evidence.getByRole('heading',{name:'Retained plot calculation',exact:true})).toBeVisible();await expect(evidence).toContainText(f.analysis.revision);await evidence.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toBeVisible();await dialog.getByLabel('Figure title',{exact:true}).fill('Retained figure presentation');await dialog.getByLabel('Horizontal axis label',{exact:true}).fill('Time (s)');await save();await expect(dialog).not.toBeVisible();expect((await f.values.read(f.target(first.id))).value.value.source).toEqual(f.analysis);
  await page.getByRole('button',{name:'Edit figure Observation 1',exact:true}).click();await dialog.locator('.figure-import > summary').click();await dialog.locator('[data-figure-paste]').fill('time,value\n1,10\n2,20\n3,30');await dialog.getByRole('button',{name:'Review data',exact:true}).click();await dialog.getByRole('button',{name:'Use mapped data',exact:true}).click();
  await expect(dialog.getByLabel('Value 3',{exact:true})).toHaveValue('30');await dialog.getByRole('button',{name:'Add measurement',exact:true}).click();await dialog.getByLabel('Coordinate 4',{exact:true}).fill('4');await dialog.getByLabel('Value 4',{exact:true}).fill('40');await dialog.getByLabel('Figure title',{exact:true}).fill('Mapped observations');
  await page.screenshot({path:info.outputPath('reader-figure-mapping.png')});await save();await expect(dialog).not.toBeVisible();const saved=(await f.values.read(f.target(f.record.figures[1].id))).value.value;expect(saved.series[0].points.map(p=>p.y)).toEqual([10,20,30,40]);expect(saved.markerArea).toBeUndefined();expect(saved.title).toBe('Mapped observations');expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=original;await app.close();await f.close();}
});
