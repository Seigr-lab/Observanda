import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {defaultColumn} from '../../src/web/dataset-schema.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
test('create a retained heatmap, edit thresholds in the record and inspect its saved matrix',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-heatmap-ui-')),f=await encryptedFixture(directory,sampleNotebook()),book=(await f.workspace.read()).book,record=book.entries[0],m=new ResearchMaterials(f.workspace),bytes=Buffer.from('Trial,Reference,Gap\n'+Array.from({length:6},(_,r)=>Array.from({length:5},(_,c)=>['Trial '+c,'Reference '+r,r*5+c].join(',')).join('\n')).join('\n'));
 const upload=await m.startImport({recordId:record.id,name:'matrix.csv',size:bytes.length});await m.appendImport(upload.id,0,[bytes]);const artifact=await m.finishImport(upload.id);await m.dataset({recordId:record.id,title:'Reference gaps',artifact,columns:['Trial','Reference','Gap'].map((label,i)=>({...defaultColumn({label}),representation:i===2?'integer':'text'}))});
 const app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')}),errors=[];page.on('pageerror',e=>errors.push(e.message));const dialog=page.locator('#dialog');
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);await page.getByRole('button',{name:'Open evidence & analysis'}).click();await dialog.locator('.material-list li').filter({hasText:'Reference gaps'}).getByRole('button',{name:'Inspect',exact:true}).click();await dialog.getByRole('button',{name:'Create reproducible figure'}).click();await dialog.getByLabel('Chart type').selectOption('heatmap');await dialog.getByLabel('Split series by').selectOption('1');await dialog.getByLabel('Gap · integer',{exact:true}).check();
  await dialog.getByLabel('Measured quantity / unit').fill('Gap (µs)');await dialog.locator('[data-heatmap-band="1"]').getByLabel('Inclusive upper threshold').fill('12');await dialog.locator('[data-heatmap-band="1"]').getByLabel('Band label').fill('Accepted');await dialog.getByRole('button',{name:'Calculate & retain figure'}).click();await expect(dialog.locator('.figure-heatmap-cell')).toHaveCount(30);await expect(dialog.locator('svg')).toContainText('Accepted');await dialog.getByRole('button',{name:'Add retained figure to record'}).click();
  const figure=page.locator('[data-figure-id]').last();await expect(figure.locator('[data-heatmap-band]')).toHaveCount(3);await figure.locator('[data-heatmap-band="1"]').getByLabel('Inclusive upper threshold').fill('15');await figure.getByRole('button',{name:'Add threshold band'}).click();await expect(figure.locator('[data-heatmap-band]')).toHaveCount(4);await figure.locator('[data-heatmap-band="2"]').getByLabel('Band label').fill('Review band');await figure.locator('[data-heatmap-band="2"]').getByLabel('Inclusive upper threshold').fill('25');
  await page.locator('.section-save [data-action="save"]').click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await expect(page.locator('.figure-heatmap-cell')).toHaveCount(30);const saved=(await f.workspace.read()).book.entries.find(r=>r.id===record.id).figures.at(-1);expect(saved.heatmap.thresholds[1].max).toBe(15);expect(saved.heatmap.thresholds[2].max).toBe(25);await page.getByRole('button',{name:'Read record',exact:true}).click();await expect(page.locator('.figure-heatmap-cell')).toHaveCount(30);await page.locator('.figure-heatmap-cell').first().locator('xpath=ancestor::*[local-name()="svg"]').screenshot({path:'.local/heatmap-reader.png'});expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
