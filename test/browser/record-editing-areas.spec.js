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
import {RecordWriting} from '../../src/record-writing.js';
import {RecordValues} from '../../src/record-values.js';

test('saved editing opens directly, browses areas and retains late writing across reading and route changes',async({page},info)=>{
 test.setTimeout(180000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-edit-areas-')),book=sampleNotebook(),record=book.entries[0];
 record.sections=Array.from({length:129},(_,i)=>({id:randomUUID(),title:'Observation '+(i+1),body:'Retained observations '+i}));
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),read=ResearchCatalogue.prototype.record,requests=[],errors=[];
 ResearchCatalogue.prototype.record=()=>{throw Error('Saved editing reconstructed an entire record');};
 page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);});
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id);
  const editor=page.locator('.record-editing'),nav=page.getByRole('navigation',{name:'Record editing areas',exact:true});
  await expect(editor.locator('h1')).toHaveText(record.title);await expect(nav).toBeVisible();await expect(editor.locator('[contenteditable=true]')).toHaveCount(0);
  await expect(editor.locator('.record-edit-details')).toContainText('Progress');await expect(editor.locator('.record-edit-details')).toContainText('Publication availability');await expect(editor.locator('.record-edit-details')).not.toContainText('undefined');
  for(const name of ['Record details','Summary / context','Writing sections','Figures','Images, audio and video','Preparations, events and assessments','Results','Tags','Contributors','Original evidence and connected work','Research links','Methods and record activity']){
   await nav.getByRole('button',{name,exact:true}).click();await expect(page.locator('.record-edit-area').and(page.getByRole('region',{name,exact:true}))).toBeFocused();
  }
  await nav.getByRole('button',{name:'Writing sections',exact:true}).click();
  await editor.getByLabel('Go to section number',{exact:true}).fill('129');await editor.getByRole('button',{name:'Go',exact:true}).click();
  const section=page.locator('#record-section-'+record.sections[128].id);await expect(section).toBeFocused();
  await page.getByRole('button',{name:'Read record',exact:true}).click();await expect(page).toHaveURL(new RegExp('/read$'));await expect(section).toBeVisible();
  await page.getByRole('button',{name:'Edit record',exact:true}).click();await expect(page).toHaveURL(new RegExp(record.id+'$'));await expect(section).toBeVisible();
  await section.getByRole('button',{name:'Edit section',exact:true}).click();const writing=page.getByRole('dialog',{name:'Edit writing section',exact:true});
  await writing.locator('.ProseMirror').fill('Edited acquisition 129');await writing.getByRole('button',{name:'Save changes',exact:true}).click();await expect(writing).not.toBeVisible();await expect(section).toContainText('Edited acquisition 129');
  await nav.getByRole('button',{name:'Record details',exact:true}).click();await editor.getByRole('button',{name:'Edit selected detail',exact:true}).click();const title=page.getByRole('dialog',{name:'Edit Record title',exact:true});
  await title.getByLabel('Record title',{exact:true}).fill('Amended field record');await title.getByRole('button',{name:'Save changes',exact:true}).click();await expect(title).not.toBeVisible();await expect(editor.locator('h1')).toHaveText('Amended field record');
  await page.reload();await expect(nav).toBeVisible();await expect(editor.locator('h1')).toHaveText('Amended field record');
  await page.getByRole('button',{name:'Read record',exact:true}).click();await expect(page).toHaveURL(new RegExp('/read$'));
  await page.goBack();await expect(nav).toBeVisible();await page.goForward();await expect(nav).toHaveCount(0);await page.getByRole('button',{name:'Edit record',exact:true}).click();
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:info.outputPath('saved-editing-desktop.png')});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await nav.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('saved-editing-mobile.png')});
  const writingService=new RecordWriting(f.workspace),target={workspaceId:book.id,recordId:record.id};
  expect((await writingService.read({...target,sectionId:record.sections[0].id})).value.body).toEqual(record.sections[0].body);
  expect((await new RecordValues(f.workspace).read({...target,field:'title'})).value.value).toBe('Amended field record');
  expect(requests.filter(route=>/^\/api\/workspace\/read\/(selection|page)$/.test(route)||route==='/api/research/records/save')).toEqual([]);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=read;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('new drafts keep their authoring form and saved records reopen in editing areas, including empty writing',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-new-to-edit-areas-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/notebooks/'+book.notebooks[0].id);
  await page.getByRole('button',{name:'New record',exact:true}).click();await page.getByRole('button',{name:'Create free-form note',exact:true}).click();
  await page.getByLabel('Record title',{exact:true}).fill('A new observation');await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  const id=await page.evaluate(()=>location.hash.split('/')[2]);await page.reload();await expect(page.locator('.record-editing h1')).toHaveText('A new observation');
  await page.getByRole('navigation',{name:'Record editing areas',exact:true}).getByRole('button',{name:'Writing sections',exact:true}).click();
  await page.getByRole('button',{name:'Add writing section',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Edit writing section',exact:true});
  await dialog.getByLabel('Section heading',{exact:true}).fill('First field visit');await dialog.locator('.ProseMirror').fill('The first retained observation.');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading',{name:'First field visit',exact:true})).toBeVisible();
  await page.goto(app.origin+'/#/records/'+randomUUID());await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
  await page.goto(app.origin+'/#/records/'+id);await expect(page.locator('.record-editing h1')).toHaveText('A new observation');
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
