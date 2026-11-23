import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {workDirectory} from '../../scripts/work-directory.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {revealInEditor} from './record-editor-helper.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';

// Numeric figure inputs belong to the figure editor of a record that is being written for the first time.
test('numeric authoring and CSV review refuse silent rounding while preserving the editable input',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(20000);
 const directory=await mkdtemp(path.join(await workDirectory('test-work'),'figure-input-')),book=sampleNotebook(),title='Precision input checks';
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const stored=async()=>(await f.workspace.read()).book.entries.find(entry=>entry.title===title);
 try{
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await page.evaluate(id=>location.hash='#/notebooks/'+id,book.notebooks[0].id);
  await page.getByRole('button',{name:'New record',exact:true}).click();await page.getByRole('button',{name:'Create observation',exact:true}).click();
  await page.getByLabel('Record title',{exact:true}).fill(title);
  await (await revealInEditor(page,page.getByRole('button',{name:'Add figure',exact:true}),'Evidence and results')).click();
  const editor=page.locator('.figure-workbench').first(),value=editor.getByLabel('Value 1',{exact:true}),coordinate=editor.getByLabel('Coordinate 1',{exact:true}),coordinates=editor.getByLabel('Horizontal coordinates',{exact:true}),series=editor.getByRole('combobox',{name:'Editing series',exact:true});
  // A category coordinate that would lose precision as a number keeps the categories and the typed text.
  await coordinates.selectOption('category');await coordinate.fill('9007199254740993.0');
  await coordinates.selectOption('number');await expect(coordinates).toHaveValue('category');await expect(coordinate).toHaveValue('9007199254740993.0');
  await coordinate.fill('0');await coordinates.selectOption('number');await expect(coordinates).toHaveValue('number');
  await coordinate.fill('0');await value.fill('1');
  await editor.getByRole('button',{name:'Add series',exact:true}).click();await expect(series.locator('option:checked')).toHaveText('Series 2');await value.fill('2');
  await series.selectOption({label:'Series 1'});await expect(value).toHaveValue('1');
  const annotations=editor.locator('.figure-annotations');await annotations.locator('summary').click();await annotations.getByRole('button',{name:'Add boundary',exact:true}).click();
  await annotations.getByLabel('Annotation label',{exact:true}).fill('Decision boundary');await annotations.getByLabel('Position / interval start',{exact:true}).fill('0.25');
  await value.fill('9007199254740993.0');await expect(value).toHaveAttribute('aria-invalid','true');
  await expect(editor.locator('[data-figure-validation]')).toContainText('loses precision');
  await page.locator('.section-save [data-action=save]').click();await expect(page.locator('#notice')).toContainText('loses precision');expect(await stored()).toBeUndefined();
  await series.selectOption({label:'Series 2'});
  await expect(series.locator('option:checked')).toHaveText('Series 1');await expect(value).toHaveValue('9007199254740993.0');
  await value.fill('1.0000000000000002');await expect(value).not.toHaveAttribute('aria-invalid','true');
  const boundary=annotations.getByLabel('Position / interval start',{exact:true});
  await boundary.fill('0.10000000000000000001');await expect(boundary).toHaveAttribute('aria-invalid','true');await boundary.fill('0.25');
  await editor.locator('.figure-axis > summary').click();const minimum=editor.getByLabel('Value minimum',{exact:true});await minimum.fill('1e-999');await expect(minimum).toHaveAttribute('aria-invalid','true');await minimum.fill('');
  const importer=editor.locator('.figure-import');await importer.locator(':scope > summary').click();
  await importer.getByLabel('Data to import',{exact:true}).fill('X,Y\n0,9007199254740993.0');await importer.getByRole('button',{name:'Review data',exact:true}).click();
  await expect(importer.getByRole('button',{name:'Use mapped data',exact:true})).toBeDisabled();await expect(importer.locator('.figure-import-problems[role="alert"]').last()).toContainText('loses precision');
  await page.locator('.section-save [data-action=save]').click();await expect(page.locator('.record-editing')).toContainText(title);
  const saved=(await stored()).figures[0];
  expect(saved.series.map(item=>item.points[0].y)).toEqual([1.0000000000000002,2]);expect(saved.annotations.map(({kind,start,label})=>({kind,start,label}))).toEqual([{kind:'boundary',start:.25,label:'Decision boundary'}]);expect(saved.y.min).toBe(null);
  expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
