import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {RecordValues} from '../../src/record-values.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchDrafts} from '../../src/research-drafts.js';

test('reader details save and recover independently, preserve exact custom values and resolve same-field conflicts',async({page},info)=>{
 test.setTimeout(180000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-values-ui-')),book=sampleNotebook(),record=book.entries[2];book.entries=[record];
 record.sections=Array.from({length:70},(_,i)=>({id:randomUUID(),title:'Section '+(i+1),body:'Retained observation '+i}));
 record.template={id:randomUUID(),profileId:null,label:'Measurement',description:'',fields:[{key:'count',label:'Exact counter',type:'number',unit:'',required:false,choices:[]}],values:{count:'9007199254740993'}};
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const read=ResearchCatalogue.prototype.record,errors=[],requests=[];ResearchCatalogue.prototype.record=()=>{throw Error('Detail editing reconstructed a whole record');};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);});
 const service=new RecordValues(f.workspace),target=field=>({workspaceId:book.id,recordId:record.id,field});
 const open=async field=>{await page.locator('[data-record-detail-field]').selectOption(field);await page.getByRole('button',{name:'Edit selected detail',exact:true}).click();};
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');
  await expect(page.locator('[data-record-detail-field] option[value="type"]')).toHaveCount(0);
  await open('title');let dialog=page.getByRole('dialog',{name:'Edit Record title',exact:true});
  await page.route('**/api/research/drafts/values/write',async route=>{await route.fetch();await route.abort('failed');},{times:1});
  await dialog.getByLabel('Record title',{exact:true}).fill('Earlier value with lost acknowledgement');await expect(dialog.locator('[data-writing-error]')).not.toBeEmpty();
  // Closing must retry the ambiguous write and then persist the later edit.
  await dialog.getByLabel('Record title',{exact:true}).fill('Recovered title');
  await dialog.getByRole('button',{name:'Keep recovery checkpoint and close',exact:true}).click();await expect(dialog).not.toBeVisible();await page.reload();
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();
  await expect(dialog.getByLabel('Record title',{exact:true})).toHaveValue('Recovered title');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(page.locator('.record-reader h1')).toHaveText('Recovered title');
  await open('outcome');dialog=page.getByRole('dialog',{name:'Edit Outcome',exact:true});await dialog.getByLabel('Outcome',{exact:true}).fill('My result');
  const base=await service.read(target('outcome'));await service.save({...target('outcome'),expectedRevision:base.revision,value:{value:'Other result'}});
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog.locator('.record-writing-conflict')).toContainText('Other result');
  await dialog.getByRole('button',{name:'Keep my edit after review',exact:true}).click();await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  expect((await service.read(target('outcome'))).value.value).toBe('My result');
  await open('template:count');dialog=page.getByRole('dialog',{name:'Edit Exact counter',exact:true});await expect(dialog.getByLabel('Exact counter',{exact:true})).toHaveValue('9007199254740993');
  await dialog.getByLabel('Exact counter',{exact:true}).fill('9007199254740995');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('record-value-mobile.png')});
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();expect((await service.read(target('template:count'))).value.value).toBe('9007199254740995');
  await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>document.documentElement.style.fontSize='');
  await open('occurredOn');dialog=page.getByRole('dialog',{name:'Edit Record date',exact:true});await dialog.getByLabel('Date precision',{exact:true}).selectOption('range');
  await dialog.getByLabel('Start date',{exact:true}).fill('2025-05-01');await dialog.getByLabel('End date',{exact:true}).fill('2025-04-01');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog.locator('[data-record-date-error]')).toContainText('start date must be on or before');
  await dialog.getByLabel('End date',{exact:true}).fill('2025-06-01');await dialog.getByLabel('Estimated date range',{exact:true}).check();
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();expect((await service.read(target('occurredOn'))).value.value).toEqual({kind:'range',from:'2025-05-01',to:'2025-06-01',estimated:true});
  await expect.poll(async()=>(await new ResearchDrafts(f.workspace).list({workspaceId:book.id})).drafts.length).toBe(0);
  expect(requests.filter(route=>/^\/api\/workspace\/read\/(selection|page)$/.test(route)||route==='/api/research/records/save')).toEqual([]);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=read;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
