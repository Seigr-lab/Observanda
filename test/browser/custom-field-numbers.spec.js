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
  await page.setViewportSize({width:390,height:844});await dialog.getByLabel('Numeral base',{exact:true}).scrollIntoViewIfNeeded();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('native-number-schema-narrow.png')});
  await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.setViewportSize({width:1440,height:1000});await row().getByRole('button',{name:'Open lab book',exact:true}).click();await main.getByRole('button',{name:'New record',exact:true}).click();await dialog.getByRole('button',{name:'Create acquisition',exact:true}).click();
  const counter=page.getByLabel('Counter (ticks) · Base 6 fractional numeral',{exact:true}),ratio=page.getByLabel('Ratio · Exact fraction (base 10 numerator/denominator)',{exact:true});
  await page.getByLabel('Record title',{exact:true}).fill('Exact native values');await counter.fill('-15.30');await ratio.fill('1/3');
  await page.locator('.section-save [data-action="save"]').click();await expect(page.locator('#save-status')).toHaveText('Saved');
  let saved=(await f.workspace.read()).book,record=saved.entries.find(r=>r.title==='Exact native values');expect(record.template.fields[0].numeric).toEqual({version:1,representation:'radix-fraction',radix:6});expect(record.template.values.counter).toBe('-15.30');expect(saved.entries.find(r=>r.id===legacy.id).template).toEqual(legacy.template);
  await page.reload();await expect(counter).toHaveValue('-15.30');await expect(ratio).toHaveValue('1/3');await main.getByRole('button',{name:'Read record',exact:true}).click();await expect(main.locator('.record-revision')).toContainText('Base 6 fractional numeral');await expect(main.locator('.record-revision')).toContainText('-15.30');
  await settings();await dialog.getByLabel('Numeral base',{exact:true}).fill('8');await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.evaluate(id=>location.hash='#/records/'+id,record.id);await expect(counter).toHaveValue('-15.30');await counter.fill('6');await page.locator('.section-save [data-action="save"]').click();await expect(page.locator('#save-status')).not.toHaveText('Saved');expect((await f.workspace.read()).book.entries.find(r=>r.id===record.id).template.values.counter).toBe('-15.30');
  await expect(dialog).toContainText('Counter (ticks) · Base 6 fractional numeral');await dialog.getByRole('button',{name:'Back to workspace',exact:true}).click();await counter.fill('+15.3');await page.locator('.section-save [data-action="save"]').click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.setViewportSize({width:390,height:844});await counter.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('native-number-entry-narrow.png')});
  await page.evaluate(id=>location.hash='#/records/'+id,legacy.id);await expect(page.getByLabel('Counter (ticks)',{exact:true})).toHaveValue('15.30');expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
