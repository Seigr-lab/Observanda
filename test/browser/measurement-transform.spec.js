import {RetainedFigureDocuments} from '../../src/retained-figure-document.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {transformedPlotDataset,plotCounterOrigin} from '../fixtures/transformed-plot-dataset.js';

test('author exact plot origins and scales, reopen point errors and inspect their original cells',async({page},info)=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-transform-ui-')),book=sampleNotebook(),record=book.entries[0],f=await encryptedFixture(directory,book),materials=new ResearchMaterials(f.workspace);
 await transformedPlotDataset(materials,record.id,{width:4,count:2});
 const app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,headless:true,preferencesFile:path.join(directory,'preferences.json')}),dialog=page.locator('#dialog'),errors=[],inspections=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().endsWith('/measurement-inspect'))inspections.push(request.postDataJSON());});
 const calculate=async()=>{const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/materials/plot'));await dialog.getByRole('button',{name:'Calculate & retain figure',exact:true}).click();const result=await response;expect(result.ok(),await result.text()).toBe(true);};
 const open=async title=>{await page.goto(app.origin+'/#/records/'+record.id);await page.getByRole('button',{name:'Open evidence & analysis'}).click();await dialog.locator('.material-list li').filter({hasText:title}).getByRole('button',{name:'Inspect',exact:true}).click();};
 try{
  await page.goto(app.url);await open('Exact coordinate source');await dialog.getByRole('button',{name:'Create reproducible figure',exact:true}).click();
  const x=dialog.locator('[data-projection-axis="x"]'),y=dialog.locator('[data-projection-axis="y"]');await expect(x.locator('[data-projection-enabled]')).toBeDisabled();
  await dialog.getByLabel('Horizontal representation',{exact:true}).selectOption('number');await dialog.getByLabel('Chart type',{exact:true}).selectOption('scatter');await dialog.locator('#material-title').fill('Exact adjacent counters');await dialog.locator('[data-material-value="3"]').check();
  const intervals=dialog.locator('[data-material-intervals="3"]');await intervals.locator('summary').click();await intervals.locator('[data-interval-column="error"]').selectOption('2');
  for(const [axis,origin,scale]of [[x,plotCounterOrigin,'.001'],[y,'1000','.1']]){await axis.locator('[data-projection-enabled]').check();await axis.locator('[data-projection-quantity="origin"] [data-projection-spelling]').fill(origin);await axis.locator('[data-projection-quantity="scale"] [data-projection-spelling]').fill(scale);}
  const scale=y.locator('[data-projection-quantity="scale"] [data-projection-spelling]');await scale.focus();await scale.press('End');await expect(scale).toBeFocused();await expect(scale).toHaveValue('.1');
  await calculate();await expect(dialog.locator('#material-figure svg')).toBeVisible({timeout:45000});await expect(dialog.locator('#material-figure')).toContainText('source value');await dialog.locator('#material-figure').screenshot({path:info.outputPath('projected-figure.png')});
  const head=(await materials.list({recordId:record.id,kind:'analysis'})).items.find(item=>item.title==='Exact adjacent counters'),retained=await materials.read(head);expect(retained.content.version).toBe('10');expect(retained.content.mapping.resourcePolicy.version).toBe(1);expect(retained.content.mapping.projection.version).toBe(2);expect(retained.content.mapping.projection.x.origin.spelling).toBe(plotCounterOrigin);const reader=await new RetainedFigureDocuments(f.workspace,{readOnly:true}).open(retained.content.figure),points=(await reader.window({collection:'points',limit:16})).items.map(item=>item.value);expect(points.map(point=>point.x)).toEqual([2,1]);expect(points[0].error).toBe(.05);
  await page.reload();await open('Exact adjacent counters');await dialog.getByRole('button',{name:'Inspect plotted points and exact sources',exact:true}).click();await expect(dialog.getByRole('button',{name:'Inspect point',exact:true})).toHaveCount(2);await dialog.getByRole('button',{name:'Inspect point',exact:true}).first().click();
  await expect(dialog).toContainText('Binary projection error in source units');await expect(dialog).toContainText('100001/100');await expect(dialog).toContainText(/1\s*\/\s*1801439850948198400/);await dialog.screenshot({path:info.outputPath('point-source-desktop.png')});await page.setViewportSize({width:390,height:844});await expect(dialog.getByRole('button',{name:'y - column 4',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await dialog.screenshot({path:info.outputPath('point-source-narrow.png')});await dialog.getByRole('button',{name:'y - column 4',exact:true}).click();await expect(dialog.locator('[data-measurement-inspection]')).toContainText('1000.01');
  expect(inspections.at(-1).source.selector).toEqual({kind:'cell',page:0,row:0,column:3});expect(inspections.at(-1).source.ref.revision).toBe(retained.content.inputs[0].revision);expect((await materials.read(head)).content.mapping.projection).toEqual(retained.content.mapping.projection);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
