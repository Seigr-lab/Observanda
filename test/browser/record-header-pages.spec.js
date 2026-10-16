import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {RecordValues} from '../../src/record-values.js';

test('reader collection windows are independent and late fields remain editable without full-record loading',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-header-ui-')),book=sampleNotebook(),record=book.entries[0],prototype=record.figures[0];
 record.contributors=Array.from({length:13},(_,i)=>({id:randomUUID(),name:'Contributor '+i,role:'Observer'}));
 record.figures=Array.from({length:13},(_,i)=>({...structuredClone(prototype),id:randomUUID(),title:'Figure '+i}));
 record.template={id:randomUUID(),profileId:null,label:'Measurement',description:'',fields:Array.from({length:13},(_,i)=>({key:'v'+i,label:'Value '+i,type:'number',unit:'',required:false,choices:[]})),values:{v12:'9007199254740993'}};
 record.body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Inspect the placed figure here.'}]},{type:'book_figure',attrs:{version:1,id:randomUUID(),figureId:record.figures[12].id,alternative:'Placed observation'}}]};
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const read=ResearchCatalogue.prototype.record,requests=[],errors=[];ResearchCatalogue.prototype.record=()=>{throw Error('Collection reading loaded the full record');};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);});
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');
  const figures=page.getByRole('navigation',{name:'Browse figures',exact:true}),contributors=page.getByRole('navigation',{name:'Browse contributors',exact:true}),fields=page.getByRole('navigation',{name:'Browse record fields',exact:true});
  await expect(figures).toContainText('1–4 of 13');await expect(page.locator('.book-figure-placement #record-figure-'+record.figures[12].id)).toBeVisible();
  await contributors.getByRole('button',{name:'Next items',exact:true}).click();await expect(contributors).toContainText('5–8 of 13');await expect(figures).toContainText('1–4 of 13');
  await fields.getByLabel('Go to item',{exact:true}).fill('13');await fields.getByRole('button',{name:'Go',exact:true}).click();await expect(fields).toContainText('13–13 of 13');
  await page.locator('[data-record-detail-field]').selectOption('template:v12');await page.getByRole('button',{name:'Edit selected detail',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Edit Value 12',exact:true});await expect(dialog.getByLabel('Value 12',{exact:true})).toHaveValue('9007199254740993');
  await dialog.getByLabel('Value 12',{exact:true}).fill('9007199254740995');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(fields).toContainText('13–13 of 13');await expect(contributors).toContainText('5–8 of 13');await expect(page.locator('[data-record-detail-field]')).toHaveValue('template:v12');
  expect((await new RecordValues(f.workspace).read({workspaceId:book.id,recordId:record.id,field:'template:v12'})).value.value).toBe('9007199254740995');
  await figures.getByLabel('Go to item',{exact:true}).fill('13');await figures.getByRole('button',{name:'Go',exact:true}).click();await expect(figures).toContainText('13–13 of 13');
  await expect(page.locator('#record-figure-'+record.figures[12].id)).toHaveCount(1);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(requests.filter(route=>/^\/api\/workspace\/read\/(selection|page)$/.test(route)||route==='/api/research/records/save')).toEqual([]);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=read;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
