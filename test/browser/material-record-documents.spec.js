import {test,expect} from '@playwright/test';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {figureValueFixture} from '../record-figure-values-fixture.js';
import {testServer} from '../device-fixture.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchMaterials} from '../../src/research-materials.js';

test('the large-record reader imports evidence and opens its exact acquisition without loading the full editor',async({page},info)=>{
 test.setTimeout(120000);const f=await figureValueFixture({large:true}),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),original=ResearchCatalogue.prototype.record,owner=ResearchMaterials.prototype.owner,errors=[],requests=[];
 ResearchCatalogue.prototype.record=()=>{throw Error('Evidence reader reconstructed a record');};ResearchMaterials.prototype.owner=()=>{throw Error('Evidence reader requested the complete owner');};page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);});
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();const dialog=page.locator('#dialog');await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Import original file',exact:true}).click();const buffer=Buffer.from('An exact retained capture.');await dialog.getByLabel('Original file',{exact:true}).setInputFiles({name:'capture.img',mimeType:'application/octet-stream',buffer});await dialog.getByRole('button',{name:'Import original',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible({timeout:30000});
  await dialog.locator('.material-list > li').filter({hasText:'capture.img'}).getByRole('button',{name:'Inspect',exact:true}).click();const downloadEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download original',exact:true}).click();const download=await downloadEvent;expect(await readFile(await download.path())).toEqual(buffer);
  await dialog.locator('[data-action="material-reference"]').first().click();await expect(dialog.getByRole('heading',{name:f.record.title,level:2,exact:true})).toBeVisible();await expect(dialog.getByRole('navigation',{name:'Retained record content',exact:true})).toContainText('1–4 of 73');await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();await dialog.locator('.material-list > li').filter({hasText:'Retained plot calculation'}).getByRole('button',{name:'Inspect',exact:true}).click();await dialog.locator('[data-action="material-attach"]').click();
  const editor=page.getByRole('dialog',{name:'Edit Figure',exact:true});await expect(editor.getByLabel('Figure title',{exact:true})).toHaveValue('Observation 0');await editor.getByLabel('Figure title',{exact:true}).fill('Retained calculation presentation');await editor.getByRole('button',{name:'Save changes',exact:true}).click();await expect(editor).not.toBeVisible();const figure=(await f.values.read(f.target(f.record.figures[0].id))).value.value;expect(figure.title).toBe('Retained calculation presentation');expect(figure.source).toEqual(f.analysis);
  await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('reader-evidence-mobile.png')});await dialog.getByRole('button',{name:'Close',exact:true}).click();
  expect(requests).not.toContain('/api/workspace/read/selection');expect(requests).not.toContain('/api/research/materials/current-record');expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=original;ResearchMaterials.prototype.owner=owner;await app.close();await f.close();}
});
