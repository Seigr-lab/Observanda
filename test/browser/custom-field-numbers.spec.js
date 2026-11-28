import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {templateFrom} from '../../src/web/notebook-schema.js';
import {newRecordOpened,setNewRecordTitle,saveNewRecord,saveRecordValue} from './record-editing-helper.js';
import {revealInEditor} from './record-editor-helper.js';

test('native template number formats stay explicit through authoring, save, reading, schema changes and narrow screens',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(12000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-number-fields-ui-')),book=sampleNotebook(),notebook=book.notebooks[0];
 const section={id:randomUUID(),profileId:null,key:'acquisition',label:'Acquisition',description:'Retain exact readings.',enabled:true,fields:[{key:'counter',label:'Counter',type:'number',unit:'ticks',required:true,choices:[]}]};
 notebook.configuration={profiles:[],sections:[section]};book.entries[0].template={...templateFrom(section),values:{counter:'15.30'}};const legacy=structuredClone(book.entries[0]);
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));const main=page.locator('main'),dialog=page.locator('#dialog');
 const project=()=>page.evaluate(id=>location.hash='#/projects/'+id,notebook.projectId);
 const row=()=>main.locator('.project-notebook').filter({has:page.getByRole('button',{name:notebook.title,exact:true})});
 const settings=async()=>{await project();await row().getByRole('button',{name:'Lab book settings',exact:true}).click();};
 try{
  await page.goto(app.url);await expect(page.locator('#main-navigation')).toBeVisible();await settings();
  await expect(dialog.getByLabel('Number format',{exact:true})).toHaveValue('decimal');
  await dialog.getByLabel('Number format',{exact:true}).focus();await dialog.getByLabel('Number format',{exact:true}).selectOption('radix-fraction');await expect(dialog.getByLabel('Number format',{exact:true})).toBeFocused();await dialog.getByLabel('Numeral base',{exact:true}).fill('6');
  await dialog.getByRole('button',{name:'Add field',exact:true}).click();await dialog.getByLabel('Field label',{exact:true}).last().fill('Ratio');await dialog.getByLabel('Value type',{exact:true}).last().selectOption('number');await dialog.getByLabel('Number format',{exact:true}).last().selectOption('rational');
  // In a narrow window each field folds into its name; opening it shows its number settings.
  await page.setViewportSize({width:390,height:844});const folded=dialog.getByRole('button',{name:'Counter',exact:true});if(await folded.isVisible())await folded.click();await dialog.getByLabel('Numeral base',{exact:true}).scrollIntoViewIfNeeded();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('native-number-schema-narrow.png')});
  await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.setViewportSize({width:1440,height:1000});await row().getByRole('button',{name:'Open lab book',exact:true}).click();await main.getByRole('button',{name:'New record',exact:true}).click();await dialog.getByRole('button',{name:'Create acquisition',exact:true}).click();
  // A new record is written on the record page: each of its fields is edited in its own dialog and written into the draft.
  const counterLabel='Counter (ticks) · Base 6 fractional numeral',ratioLabel='Ratio · Exact fraction (base 10 numerator/denominator)';
  const field=async index=>{await (await revealInEditor(page,main.locator('[data-action=record-value-edit][data-value-field^="template:"]').nth(index),'Record details')).click();const value=page.locator('dialog.record-writing[open]');await expect(value.locator('[data-writing-fields] input').first()).toBeVisible();return value;};
  const write=async(index,label,text)=>{const value=await field(index);await value.getByLabel(label,{exact:true}).fill(text);await saveRecordValue(value);};
  const shows=async(index,label,text)=>{const value=await field(index);await expect(value.getByLabel(label,{exact:true})).toHaveValue(text);await value.getByRole('button',{name:'Close',exact:true}).click();await expect(value).not.toBeVisible();};
  await newRecordOpened(page);await setNewRecordTitle(page,'Exact native values');await write(0,counterLabel,'-15.30');await write(1,ratioLabel,'1/3');
  await saveNewRecord(page);
  let saved=(await f.workspace.read()).book,record=saved.entries.find(r=>r.title==='Exact native values');expect(record.template.fields[0].numeric).toEqual({version:1,representation:'radix-fraction',radix:6});expect(record.template.values.counter).toBe('-15.30');expect(saved.entries.find(r=>r.id===legacy.id).template).toEqual(legacy.template);
  await page.reload();await expect(main.locator('.record-editing h1')).toHaveText('Exact native values');await shows(0,counterLabel,'-15.30');await shows(1,ratioLabel,'1/3');await main.getByRole('button',{name:'Read record',exact:true}).click();await expect(main.locator('.record-revision')).toContainText('Base 6 fractional numeral');await expect(main.locator('.record-revision')).toContainText('-15.30');
  await settings();await dialog.getByLabel('Numeral base',{exact:true}).fill('8');await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(dialog).not.toBeVisible();
  // The record keeps the numeral base it was saved with: a value that is not base 6 is refused, a base 6 one is saved.
  await page.evaluate(id=>location.hash='#/records/'+id,record.id);const counter=await field(0);await expect(counter.getByLabel(counterLabel,{exact:true})).toHaveValue('-15.30');await counter.getByLabel(counterLabel,{exact:true}).fill('6');await counter.getByRole('button',{name:'Save changes',exact:true}).click();await expect(counter.locator('[data-writing-error]')).not.toBeEmpty();expect((await f.workspace.read()).book.entries.find(r=>r.id===record.id).template.values.counter).toBe('-15.30');
  await counter.getByLabel(counterLabel,{exact:true}).fill('+15.3');await saveRecordValue(counter);
  await page.setViewportSize({width:390,height:844});const narrow=await field(0);await narrow.getByLabel(counterLabel,{exact:true}).scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('native-number-entry-narrow.png')});await narrow.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(id=>location.hash='#/records/'+id,legacy.id);await shows(0,'Counter (ticks)','15.30');expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
