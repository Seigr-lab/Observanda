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
import {ResearchMaterials} from '../../src/research-materials.js';
import {researchReference} from '../../src/web/research-reference.js';

test('research links recover incomplete references, retain chosen methods, resolve conflicts and remove late links from the reader',async({page},info)=>{
 test.setTimeout(240000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-relation-ui-')),book=sampleNotebook(),record=book.entries[2],method=book.entries[0];book.entries=[record,method];record.type='run';method.title='Method for retention';
 record.relations=Array.from({length:9},(_,i)=>({id:randomUUID(),type:'Related to',label:'Reference '+i,target:{workspaceId:randomUUID(),kind:'record',id:randomUUID()}}));
 record.sections=Array.from({length:70},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Retained observation '+i}));
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const original=ResearchCatalogue.prototype.record,errors=[],requests=[];ResearchCatalogue.prototype.record=function(id,...args){if(id===record.id)throw Error('Research links UI reconstructed the source record');return original.call(this,id,...args);};
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/api/'))requests.push(new URL(request.url()).pathname);});
 const values=new RecordValues(f.workspace),target=id=>({workspaceId:book.id,recordId:record.id,field:'relation:'+id}),dialog=page.getByRole('dialog',{name:'Edit Research link',exact:true}),save=()=>dialog.getByRole('button',{name:'Save changes',exact:true}).click();
 const recover=async()=>{await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();};
 const tail=async()=>{await page.locator('[data-collection-position="relations"]').fill('9');await page.locator('[data-action="content-collection-go"][data-collection="relations"]').click();await expect(page.getByRole('button',{name:'Edit link to Reference 8',exact:true})).toBeVisible();};
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');await page.getByRole('button',{name:'Edit record',exact:true}).click();await page.getByRole('button',{name:'Add research link',exact:true}).click();
  await dialog.getByLabel('Observanda reference',{exact:true}).fill('observanda://unfinished');await dialog.getByLabel('Link label',{exact:true}).fill('Unfinished method');
  await expect(dialog.locator('[data-writing-status]')).toHaveText('Recovery checkpoint saved.');await dialog.getByRole('button',{name:'Keep recovery checkpoint and close',exact:true}).click();await expect(dialog).not.toBeVisible();await page.reload();await recover();
  await expect(dialog.getByLabel('Observanda reference',{exact:true})).toHaveValue('observanda://unfinished');await save();await expect(dialog).toBeVisible();
  await dialog.getByLabel('Relationship purpose',{exact:true}).selectOption('uses-method');await expect(dialog.getByLabel('Version to choose',{exact:true})).toHaveValue('exact');await expect(dialog.getByLabel('Version to choose',{exact:true})).toBeDisabled();
  let finishPin;const holdPin=new Promise(resolve=>{finishPin=resolve;});await page.route('**/api/research/materials/pin',async route=>{const response=await route.fetch();await holdPin;await route.fulfill({response});});
  await dialog.getByRole('button',{name:'Choose target',exact:true}).click();await dialog.locator('[data-action="research-target-choose"]').filter({hasText:'Method for retention'}).click();await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();finishPin();
  await expect(dialog.getByLabel('Observanda reference',{exact:true})).toHaveValue(/\?revision=[a-f0-9]{64}$/);await page.unroute('**/api/research/materials/pin');const reference=await dialog.getByLabel('Observanda reference',{exact:true}).inputValue();
  let dropped=false;await page.route('**/api/research/records/values/save',async route=>{if(dropped)return route.continue();dropped=true;await route.fetch();await route.abort('failed');});
  await save();await expect(dialog.locator('[data-writing-error]')).not.toBeEmpty();await save();await expect(dialog).not.toBeVisible();await page.unroute('**/api/research/records/values/save');await tail();
  const content=await new RecordContent(f.workspace).read({workspaceId:book.id,recordId:record.id,pagedHeader:true,windows:{relations:9}}),created=content.header.relations[0];expect(content.collections.relations.total).toBe(10);expect(created.role).toBe('uses-method');
  const methodTarget={workspaceId:book.id,recordId:method.id,field:'title'},title=await values.read(methodTarget);await values.save({...methodTarget,expectedRevision:title.revision,value:{value:'Later method title'}});expect((await new ResearchMaterials(f.workspace).read(created.target)).title).toBe('Method for retention');
  await page.locator('[data-action="record-link-open"][data-id="'+created.id+'"]').click();const retained=page.getByRole('dialog',{name:'Method for retention',exact:true});await expect(retained).toContainText(created.target.revision);await retained.getByRole('button',{name:'Close',exact:true}).click();await expect(retained).not.toBeVisible();
  await page.getByRole('button',{name:'Edit link to Reference 8',exact:true}).click();await dialog.getByLabel('Link label',{exact:true}).fill('My label');
  const base=await values.read(target(record.relations[8].id));await values.save({...target(record.relations[8].id),expectedRevision:base.revision,value:{value:{...base.value.value,label:'Other label'}}});
  await save();await expect(dialog.locator('.record-writing-conflict')).toContainText('Other label');await dialog.getByRole('button',{name:'Keep my edit after review',exact:true}).click();await save();await expect(dialog).not.toBeVisible();expect((await values.read(target(record.relations[8].id))).value.value.label).toBe('My label');
  await page.getByRole('button',{name:'Edit link to Method for retention',exact:true}).click();await dialog.getByLabel('Remove this research link',{exact:true}).check();await dialog.getByRole('button',{name:'Keep recovery checkpoint and close',exact:true}).click();await expect(dialog).not.toBeVisible();await page.reload();await recover();
  await expect(dialog.getByLabel('Remove this research link',{exact:true})).toBeChecked();await expect(dialog.getByLabel('Observanda reference',{exact:true})).toBeDisabled();await expect(dialog.getByLabel('Observanda reference',{exact:true})).toHaveValue(reference);
  await dialog.getByLabel('Remove this research link',{exact:true}).uncheck();await expect(dialog.getByLabel('Observanda reference',{exact:true})).toBeEnabled();await dialog.getByLabel('Remove this research link',{exact:true}).check();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('research-link-mobile.png')});
  await save();await expect(dialog).not.toBeVisible();expect((await values.read(target(created.id))).value.value).toBeNull();
  await expect.poll(async()=>(await new ResearchDrafts(f.workspace).list({workspaceId:book.id})).drafts.length).toBe(0);expect(requests.filter(route=>/^\/api\/workspace\/read\/(selection|page)$/.test(route)||route==='/api/research/records/save')).toEqual([]);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=original;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('closing discovery cancels a pending exact choice without changing another editor',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-link-cancel-ui-')),book=sampleNotebook(),record=book.entries[2],method=book.entries[0];book.entries=[record,method];record.relations=[];method.title='Method to cancel';
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 let releasePin;const hold=new Promise(resolve=>{releasePin=resolve;});let pinFinished;const finished=new Promise(resolve=>{pinFinished=resolve;});
 await page.route('**/api/research/materials/pin',async route=>{try{const response=await route.fetch();await hold;await route.fulfill({response});}finally{pinFinished();}});
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');await page.getByRole('button',{name:'Edit record',exact:true}).click();await page.getByRole('button',{name:'Add research link',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Edit Research link',exact:true});
  await dialog.getByLabel('Relationship purpose',{exact:true}).selectOption('uses-method');await dialog.getByRole('button',{name:'Choose target',exact:true}).click();await dialog.locator('[data-action="research-target-choose"]').filter({hasText:'Method to cancel'}).click();await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'Keep recovery checkpoint and close',exact:true}).click();await expect(dialog).not.toBeVisible();await page.getByRole('button',{name:'Add contributor',exact:true}).click();const contributor=page.getByRole('dialog',{name:'Edit Contributor',exact:true});await expect(contributor.getByLabel('Name',{exact:true})).toHaveValue('');releasePin();await finished;
  await expect(contributor.getByLabel('Name',{exact:true})).toHaveValue('');await expect(contributor.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();await contributor.getByRole('button',{name:'Close',exact:true}).click();
  const drafts=await new ResearchDrafts(f.workspace).list({workspaceId:book.id});expect(drafts.drafts).toHaveLength(1);const content=await new RecordContent(f.workspace).read({workspaceId:book.id,recordId:record.id,pagedHeader:true});expect(content.header.relations).toHaveLength(0);
 }finally{releasePin();await page.unrouteAll({behavior:'wait'});await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('reader links select structural targets and preserve cross-workspace section references',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-link-targets-ui-')),book=sampleNotebook(),record=book.entries[2];book.entries=[record];record.relations=[];
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const original=ResearchCatalogue.prototype.record;ResearchCatalogue.prototype.record=()=>{throw Error('Structural link selection reconstructed a record');};
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');await page.getByRole('button',{name:'Edit record',exact:true}).click();await page.getByRole('button',{name:'Add research link',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Edit Research link',exact:true});
  await dialog.getByRole('button',{name:'Choose target',exact:true}).click();await dialog.locator('#research-target-kind').selectOption('notebook');await dialog.locator('[data-action="research-target-choose"]').first().click();await expect(dialog.getByLabel('Observanda reference',{exact:true})).toHaveValue(new RegExp('/notebook/'));await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'Add research link',exact:true}).click();const reference=researchReference({workspaceId:randomUUID(),kind:'record',id:randomUUID(),revision:'a'.repeat(64),selector:{version:1,kind:'section',id:randomUUID()}});
  await dialog.getByLabel('Link label',{exact:true}).fill('Another workspace section');await dialog.getByLabel('Observanda reference',{exact:true}).fill(reference);await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  const read=await new RecordContent(f.workspace).read({workspaceId:book.id,recordId:record.id,pagedHeader:true});expect(read.header.relations).toHaveLength(2);expect(researchReference(read.header.relations[1].target)).toBe(reference);
 }finally{ResearchCatalogue.prototype.record=original;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
