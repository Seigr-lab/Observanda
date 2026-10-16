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
import {RecordContent} from '../../src/record-content.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchDrafts} from '../../src/research-drafts.js';

test('reader contributor authoring recovers additions and removals, reviews conflicts and handles a lost save acknowledgement',async({page},info)=>{
 test.setTimeout(240000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-contributor-ui-')),book=sampleNotebook(),record=book.entries[2];book.entries=[record];
 record.contributors=Array.from({length:9},(_,i)=>({id:randomUUID(),name:'Contributor '+i,role:'Original role '+i}));
 record.sections=Array.from({length:70},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Retained observation '+i}));
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const read=ResearchCatalogue.prototype.record,errors=[],requests=[];ResearchCatalogue.prototype.record=()=>{throw Error('Contributor UI reconstructed a whole record');};
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/api/'))requests.push(new URL(request.url()).pathname);});
 const values=new RecordValues(f.workspace),target=id=>({workspaceId:book.id,recordId:record.id,field:'contributor:'+id}),dialog=page.getByRole('dialog',{name:'Edit Contributor',exact:true});
 const save=()=>dialog.getByRole('button',{name:'Save changes',exact:true}).click();
 const recover=async()=>{await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();};
 const tail=async()=>{await page.locator('[data-collection-position="contributors"]').fill('9');await page.locator('[data-action="content-collection-go"][data-collection="contributors"]').click();await expect(page.locator('[data-record-contributor="'+record.contributors[8].id+'"]')).toBeVisible();};
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');
  await page.getByRole('button',{name:'Add contributor',exact:true}).click();await dialog.getByLabel('Role or contribution',{exact:true}).fill('Field work');
  await expect(dialog.locator('[data-writing-status]')).toHaveText('Recovery checkpoint saved.');await dialog.getByRole('button',{name:'Keep recovery checkpoint and close',exact:true}).click();await page.reload();await recover();
  await expect(dialog.getByLabel('Name',{exact:true})).toHaveValue('');await expect(dialog.getByLabel('Role or contribution',{exact:true})).toHaveValue('Field work');
  await save();await expect(dialog).toBeVisible();await dialog.getByLabel('Name',{exact:true}).fill('Recovered contributor');
  let dropped=false;await page.route('**/api/research/records/values/save',async route=>{if(dropped)return route.continue();dropped=true;await route.fetch();await route.abort('failed');});
  await save();await expect(dialog.locator('[data-writing-error]')).not.toBeEmpty();await save();await expect(dialog).not.toBeVisible();await page.unroute('**/api/research/records/values/save');
  await tail();await expect(page.locator('.record-contributor-values')).toContainText('Recovered contributor');
  const added=await new RecordContent(f.workspace).read({workspaceId:book.id,recordId:record.id,pagedHeader:true,windows:{contributors:9}});expect(added.collections.contributors.total).toBe(10);const created=added.header.contributors[0];
  await page.getByRole('button',{name:'Edit contributor Contributor 8',exact:true}).click();await dialog.getByLabel('Name',{exact:true}).fill('My correction');
  const base=await values.read(target(record.contributors[8].id));await values.save({...target(record.contributors[8].id),expectedRevision:base.revision,value:{value:{name:'Contributor 8',role:'Other reviewer'}}});
  await save();await expect(dialog.locator('.record-writing-conflict')).toContainText('Other reviewer');await dialog.getByRole('button',{name:'Use saved value',exact:true}).click();
  await expect(dialog.getByLabel('Role or contribution',{exact:true})).toHaveValue('Other reviewer');await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();
  await dialog.getByLabel('Role or contribution',{exact:true}).fill('Reviewed together');
  const unrelated=await values.read(target(record.contributors[0].id));await values.save({...target(record.contributors[0].id),expectedRevision:unrelated.revision,value:{value:{name:'Another person corrected',role:'Independent work'}}});
  await save();await expect(dialog).not.toBeVisible();expect((await values.read(target(record.contributors[8].id))).value.value.role).toBe('Reviewed together');
  await page.getByRole('button',{name:'Edit contributor Recovered contributor',exact:true}).click();await dialog.getByLabel('Remove this contributor',{exact:true}).check();
  await dialog.getByRole('button',{name:'Keep recovery checkpoint and close',exact:true}).click();await page.reload();await recover();
  await expect(dialog.getByLabel('Remove this contributor',{exact:true})).toBeChecked();await expect(dialog.getByLabel('Name',{exact:true})).toBeDisabled();await expect(dialog.getByLabel('Name',{exact:true})).toHaveValue('Recovered contributor');
  await dialog.getByLabel('Remove this contributor',{exact:true}).uncheck();await expect(dialog.getByLabel('Name',{exact:true})).toBeEnabled();await dialog.getByLabel('Remove this contributor',{exact:true}).check();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('contributor-removal-mobile.png')});
  await save();await expect(dialog).not.toBeVisible();expect((await values.read(target(created.id))).value.value).toBeNull();
  await expect.poll(async()=>(await new ResearchDrafts(f.workspace).list({workspaceId:book.id})).drafts.length).toBe(0);
  expect(requests.filter(route=>/^\/api\/workspace\/read\/(selection|page)$/.test(route)||route==='/api/research/records/save')).toEqual([]);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=read;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('an empty reader offers contributor creation without entering the full record editor',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-empty-contributors-')),book=sampleNotebook(),record=book.entries[2];book.entries=[record];record.contributors=[];
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const read=ResearchCatalogue.prototype.record;ResearchCatalogue.prototype.record=()=>{throw Error('Empty contributor UI reconstructed a whole record');};
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');await expect(page.locator('.record-contributor-values')).toContainText('No contributors listed.');
  await page.getByRole('button',{name:'Add contributor',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Edit Contributor',exact:true});
  await dialog.getByLabel('Name',{exact:true}).fill('First contributor');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Edit contributor First contributor',exact:true})).toBeVisible();
 }finally{ResearchCatalogue.prototype.record=read;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
