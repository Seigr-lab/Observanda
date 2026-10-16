import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {createFigure,createSeries} from '../../src/web/figure-model.js';
import {createAnnotation} from '../../src/web/figure-annotations.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';

test('numeric authoring and CSV review refuse silent rounding while preserving the editable input',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(10000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-figure-input-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0],plot=createFigure();
 plot.title='Precise measurements';plot.series[0].points=[{x:0,y:1,error:null}];const second=createSeries('Second');second.points=[{x:0,y:2,error:null}];plot.series.push(second);
 plot.annotations=[{...createAnnotation('boundary'),start:.25,label:'Decision boundary'}];
 record.figures=[plot];record.sections=[];record.attachments=[];record.relations=[];book.entries=[record];
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences')}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));let saves=0;page.on('request',r=>{if(r.url().endsWith('/api/research/records/save'))saves++;});
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);
  const editor=page.locator('.figure-workbench').first(),value=editor.getByLabel('Value 1',{exact:true});
  await value.fill('9007199254740993.0');await expect(value).toHaveAttribute('aria-invalid','true');
  await expect(editor.locator('[data-figure-validation]')).toContainText('loses precision');
  await expect(page.getByRole('button',{name:'Save record',exact:true})).toBeDisabled();expect(saves).toBe(0);
  await page.getByLabel('Record title',{exact:true}).fill('Precision input checks');await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#notice')).toContainText('loses precision');expect(saves).toBe(0);
  await editor.getByRole('combobox',{name:'Editing series',exact:true}).selectOption(second.id);
  await expect(editor.getByRole('combobox',{name:'Editing series',exact:true})).toHaveValue(plot.series[0].id);await expect(value).toHaveValue('9007199254740993.0');
  expect((await f.workspace.read()).book.entries[0].figures).toEqual([plot]);
  await value.fill('1.0000000000000002');await expect(value).not.toHaveAttribute('aria-invalid','true');
  const annotations=editor.locator('.figure-annotations');await annotations.locator('summary').click();const boundary=annotations.getByLabel('Position / interval start',{exact:true});
  await boundary.fill('0.10000000000000000001');await expect(boundary).toHaveAttribute('aria-invalid','true');await boundary.fill('0.25');
  await editor.locator('.figure-axis > summary').click();const minimum=editor.getByLabel('Value minimum',{exact:true});await minimum.fill('1e-999');await expect(minimum).toHaveAttribute('aria-invalid','true');await minimum.fill('');
  const save=page.waitForResponse(r=>r.url().endsWith('/api/research/records/save'));await page.getByRole('button',{name:'Save record',exact:true}).click();expect((await save).ok()).toBe(true);
  expect((await f.workspace.read()).book.entries[0].figures[0].series[0].points[0].y).toBe(1.0000000000000002);
  const importer=editor.locator('.figure-import');await importer.locator(':scope > summary').click();
  await importer.getByLabel('Data to import',{exact:true}).fill('X,Y\n0,9007199254740993.0');await importer.getByRole('button',{name:'Review data',exact:true}).click();
  await expect(importer.getByRole('button',{name:'Use mapped data',exact:true})).toBeDisabled();await expect(importer.locator('.figure-import-problems[role="alert"]').last()).toContainText('loses precision');
  await editor.getByLabel('Horizontal coordinates',{exact:true}).selectOption('category');await editor.getByLabel('Coordinate 1',{exact:true}).fill('9007199254740993.0');
  await editor.getByLabel('Horizontal coordinates',{exact:true}).selectOption('number');await expect(editor.getByLabel('Horizontal coordinates',{exact:true})).toHaveValue('category');await expect(editor.getByLabel('Coordinate 1',{exact:true})).toHaveValue('9007199254740993.0');
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
