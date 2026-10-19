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

test('record type edits recover and resolve conflicts without replacing research content or entering the full editor',async({page})=>{
 test.setTimeout(120000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-type-ui-')),book=sampleNotebook(),record=book.entries[2];book.entries=[record];record.type='note';record.status='draft';record.sections=Array.from({length:67},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Retained body '+i}));
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),service=new RecordValues(f.workspace),target={workspaceId:book.id,recordId:record.id,field:'type'},requests=[],errors=[],read=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=()=>{throw Error('Type editing reconstructed an entire record');};page.on('request',r=>requests.push(new URL(r.url()).pathname));page.on('pageerror',e=>errors.push(e.message));
 const open=async()=>{await page.locator('[data-record-detail-field]').selectOption('type');await page.getByRole('button',{name:'Edit selected detail',exact:true}).click();};
 const dialog=page.getByRole('dialog',{name:'Edit Record type',exact:true});
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');await page.getByRole('button',{name:'Edit record',exact:true}).click();await open();await expect(dialog.getByLabel('Record type',{exact:true})).toHaveValue('note');
  await dialog.getByLabel('Record type',{exact:true}).selectOption('observation');await dialog.getByRole('button',{name:'Keep recovery checkpoint and close',exact:true}).click();await expect(dialog).not.toBeVisible();await page.reload();
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();await expect(dialog.getByLabel('Record type',{exact:true})).toHaveValue('observation');
  await dialog.getByLabel('Record type',{exact:true}).selectOption('observation');await expect(dialog.locator('[data-writing-status]')).toHaveText('Recovery checkpoint saved.');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();expect((await service.read(target)).value.value).toBe('observation');
  await open();await dialog.getByLabel('Record type',{exact:true}).selectOption('analysis');const base=await service.read(target);await service.save({...target,expectedRevision:base.revision,value:{value:'protocol'}});
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog.locator('.record-writing-conflict')).toContainText('Protocol');await dialog.getByRole('button',{name:'Keep my edit after review',exact:true}).click();await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();expect((await service.read(target)).value.value).toBe('analysis');
  await expect(page.locator('#record-section-'+record.sections[0].id)).toContainText('Retained body 0');await expect.poll(async()=>(await new ResearchDrafts(f.workspace).list({workspaceId:book.id})).drafts.length).toBe(0);
  expect(requests.filter(route=>/^\/api\/workspace\/read\/(selection|page)$/.test(route)||route==='/api/research/records/save')).toEqual([]);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=read;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
