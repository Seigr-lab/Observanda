import {openRecordActions} from './record-editing-helper.js';
import {projectTemplateFixture} from './project-template-fixture.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {RecordWriting} from '../../src/record-writing.js';
import {RecordStarters} from '../../src/record-starters.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

async function setup(page,dedicated=false){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-template-source-ui-')),book=sampleNotebook(),record=book.entries[0];
 record.body='Completed results are not reusable instructions';record.sections=Array.from({length:129},(_,i)=>({id:randomUUID(),title:'Method section '+(i+1),body:'Exact original instructions '+(i+1)}));
 const f=dedicated?await projectTemplateFixture(directory,book):await encryptedFixture(directory,book),app=await testServer({root:f.applicationRoot??f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true}),original=ResearchCatalogue.prototype.record,errors=[],requests=[];
 ResearchCatalogue.prototype.record=()=>{throw Error('Template workflow reconstructed a complete record');};
 page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(r.url().includes('/api/workspace/read/'))requests.push(r.url());});
 const dialog=page.locator('#dialog'),click=name=>dialog.getByRole('button',{name,exact:true}).click();
 return {...f,book,record,dialog,app,click,async open(){await page.goto(app.url);await page.goto(app.origin+'/#/'+(dedicated?'owners/'+book.projects[0].id+'/':'')+'records/'+record.id+'/read');await openRecordActions(page);await page.getByRole('button',{name:'Record templates',exact:true}).click();await click('Create from this record');await expect(dialog.getByLabel('Go to section number')).toBeVisible();},async close(){ResearchCatalogue.prototype.record=original;await app.close();await f.close?.();clearVault(f.vault);await rm(directory,{recursive:true,force:true});expect(errors).toEqual([]);expect(requests.some(url=>/\/(selection|page)$/.test(url))).toBe(false);}};
}

for(const dedicated of [false,true])test((dedicated?'project: ':'workspace: ')+'template selection pages headings and retains exact chosen instructions from the original saved version',async({page},info)=>{
 test.setTimeout(180000);
 const f=await setup(page,dedicated),{dialog,click,record}=f;
 try{
  await f.open();await dialog.getByRole('group',{name:'1. Method section 1',exact:true}).getByLabel('Include section heading').check();
  await dialog.getByLabel('Go to section number').fill('129');await click('Go');await expect(dialog).toContainText('Sections 129–129 of 129');
  await dialog.getByLabel('Include section heading').check();await dialog.getByLabel('Copy instructions: Method section 129',{exact:true}).check();await expect(dialog.locator('[data-source-count]')).toHaveText('2 sections selected');
  await click('Previous sections');await expect(dialog).toContainText('Sections 109–128 of 129');await click('Next sections');await expect(dialog.getByLabel('Copy instructions: Method section 129',{exact:true})).toBeChecked();
  const writer=new RecordWriting(f.workspace),target={workspaceId:f.book.id,recordId:record.id,sectionId:record.sections[128].id},base=await writer.read(target);
  await writer.save({...target,expectedRevision:base.revision,value:{...base.value,body:'Changed after template selection began'}});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await dialog.getByLabel('Copy instructions: Method section 129',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('template-source-narrow.png')});
  await click('Prepare template draft');await expect(dialog.getByRole('button',{name:'Edit section',exact:true})).toHaveCount(2);
  await dialog.getByRole('button',{name:'Edit section',exact:true}).nth(0).click();await expect(dialog.getByLabel('Section title',{exact:true})).toHaveValue('Method section 1');await expect(dialog.getByRole('textbox',{name:'Section instructions',exact:true})).toBeEmpty();await click('Back to sections');
  await dialog.getByRole('button',{name:'Edit section',exact:true}).nth(1).click();await expect(dialog.getByLabel('Section title',{exact:true})).toHaveValue('Method section 129');await expect(dialog.getByRole('textbox',{name:'Section instructions',exact:true})).toHaveText('Exact original instructions 129');await click('Back to sections');await click('Starting instructions');await expect(dialog.getByRole('textbox',{name:'Starting instructions',exact:true})).toBeEmpty();
  const store=new RecordStarters(f.workspace,{}),listing=await store.list({workspaceId:f.book.id,cursor:null}),saved=await store.read({workspaceId:f.book.id,id:listing.items[0].id});expect(saved.draft.sections).toEqual([{title:'Method section 1',body:''},{title:'Method section 129',body:'Exact original instructions 129'}]);expect((await writer.read(target)).value.body).toBe('Changed after template selection began');
 }finally{await f.close();}
});

test('source and preparation failures retain selection and reject responses for a different saved version',async({page})=>{
 const f=await setup(page),{dialog,click}=f;let failPage=true,failCapture=true;const pins=[];
 try{
  await f.open();await dialog.getByRole('group',{name:'1. Method section 1',exact:true}).getByLabel('Include section heading').check();await dialog.getByLabel('Copy summary / context').check();
  await page.route('**/api/research/starters/source',async route=>{const input=route.request().postDataJSON();pins.push(input.snapshotId);if(failPage){failPage=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Interrupted source lookup'})});}else await route.continue();});
  await click('Next sections');await expect(dialog.getByRole('alert')).toHaveText('Interrupted source lookup');await expect(dialog.locator('[data-source-count]')).toHaveText('1 sections selected');await click('Try again');await expect(dialog).toContainText('Sections 21–40 of 129');expect(new Set(pins).size).toBe(1);
  await click('Previous sections');await expect(dialog.getByRole('group',{name:'1. Method section 1',exact:true}).getByLabel('Include section heading')).toBeChecked();await expect(dialog.getByLabel('Copy summary / context')).toBeChecked();
  await page.route('**/api/research/starters/capture-finish',async route=>{const response=await route.fetch();if(failCapture){failCapture=false;const result=await response.json();await route.fulfill({response,json:{...result,header:{...result.header,id:randomUUID()}}});}else await route.fulfill({response});});
  await click('Prepare template draft');await expect(dialog.getByRole('alert')).toContainText('response was incomplete');await expect(dialog.locator('[data-source-count]')).toHaveText('1 sections selected');await expect(dialog.getByLabel('Copy summary / context')).toBeChecked();
  await click('Prepare template draft');await expect(dialog.getByRole('button',{name:'Edit section',exact:true})).toHaveCount(1);await click('Starting instructions');await expect(dialog.getByRole('textbox',{name:'Starting instructions',exact:true})).toHaveText('Completed results are not reusable instructions');
 }finally{await f.close();}
});

test('leaving source selection cancels a delayed read and a late response cannot replace the template library',async({page})=>{
 const f=await setup(page),{dialog,click}=f;let release,reached;const hold=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>reached=resolve);
 try{
  await f.open();await page.route('**/api/research/starters/source',async route=>{const response=await route.fetch();reached();await hold;await route.fulfill({response}).catch(()=>{});});
  await click('Next sections');await ready;await click('Back to templates');await expect(dialog.getByRole('heading',{name:'Record templates',exact:true})).toBeVisible();release();await page.unrouteAll({behavior:'wait'});
  await expect(dialog.locator('[data-starter-source]')).toHaveCount(0);await click('Create from this record');await expect(dialog).toContainText('Sections 1–20 of 129');await expect(dialog.locator('[data-source-count]')).toHaveText('0 sections selected');
  await click('Prepare template draft');await expect(dialog.getByRole('button',{name:'Edit section',exact:true})).toHaveCount(0);await click('Starting instructions');await expect(dialog.getByRole('textbox',{name:'Starting instructions',exact:true})).toBeEmpty();
 }finally{release();await f.close();}
});
