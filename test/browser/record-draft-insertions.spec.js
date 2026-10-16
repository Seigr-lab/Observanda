import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {figureValueFixture} from '../record-figure-values-fixture.js';
import {retainedDraft} from '../fixtures/record-draft-review.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {testServer} from '../device-fixture.js';
const media={get:async()=>{throw Error('Unexpected media');}};
const newRecord=f=>({...structuredClone(f.record),id:randomUUID(),title:'Unfinished acquisition notebook',body:'Exact earlier observations',sections:[],figures:[],attachments:[],results:{version:1,statements:[]},relations:[],share:false});
async function openDraft(page,title){await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).locator('.record-draft-row').filter({hasText:title}).getByRole('button',{name:'Review draft',exact:true}).click();}

test('large new-record checkpoints preview late writing and recover directly to the reader',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);const f=await figureValueFixture(),record=newRecord(f);record.sections=Array.from({length:82},(_,i)=>({id:randomUUID(),title:'Acquisition '+i,body:'Measurements '.repeat(2200)}));const draft=await retainedDraft(f.workspace,f.book.id,null,record);
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),original=ResearchCatalogue.prototype.record;ResearchCatalogue.prototype.record=()=>{throw Error('Draft recovery loaded full record');};const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);});
 try{
  await page.goto(app.url);await openDraft(page,record.title);const preview=page.locator('.record-draft-preview');await preview.locator('[data-preview-position]').fill('82');await preview.locator('[data-preview-go]').click();await expect(preview).toContainText('Acquisition 81');await preview.locator('[data-preview-recover]').click();const review=page.locator('.record-draft-review');await expect(review).toContainText('This draft has not been saved as a record.');await review.getByRole('button',{name:'Save recovered record',exact:true}).click();await expect(review).toHaveCount(0,{timeout:60000});await expect(page.locator('.record-reader > h1')).toHaveText(record.title);
  expect(await new ResearchDrafts(f.workspace).read(draft.draft.id,{header:true})).toBe(null);expect(requests.some(route=>route.includes('/drafts/transfer/read')||route==='/api/workspace/read/selection'||route==='/api/research/records/save')).toBe(false);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=original;await app.close();await f.close();}
});
test('a deleted-record checkpoint can explicitly keep the record removed without opening a missing reader',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);const f=await figureValueFixture(),record=newRecord(f),records=new ResearchRecords(f.workspace,media);await records.save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:null,record}]},{receipt:true});const saved=(await f.workspace.read()).book.entries.find(r=>r.id===record.id),draft=await retainedDraft(f.workspace,f.book.id,saved,{...saved,title:'Retained removed draft'});await records.remove({workspaceId:f.book.id,recordId:record.id,expectedRevision:recordRevision(saved)});
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),original=ResearchCatalogue.prototype.record;ResearchCatalogue.prototype.record=()=>{throw Error('Draft recovery loaded full record');};const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await openDraft(page,'Retained removed draft');await page.locator('.record-draft-preview [data-preview-recover]').click();const review=page.locator('.record-draft-review');await expect(review).toContainText('This record was removed after the draft began.');await review.locator('[data-review="choose-stored"]').click();await review.getByRole('button',{name:'Save recovered record',exact:true}).click();await expect(review).toHaveCount(0);await expect(page.locator('.record-reader')).toHaveCount(0);expect(await new ResearchDrafts(f.workspace).read(draft.draft.id,{header:true})).toBe(null);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=original;await app.close();await f.close();}
});
