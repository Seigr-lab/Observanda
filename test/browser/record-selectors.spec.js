import {openRecordActions} from './record-editing-helper.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {richBook} from '../book-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {parseResearchReference} from '../../src/web/research-reference.js';

async function fixture(){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-reference-picker-')),data=richBook(),record=data.concept;
 record.sections=Array.from({length:81},(_,i)=>({id:randomUUID(),title:'Observation '+(i+1),body:'Retained observations '.repeat(40)}));
 const f=await encryptedFixture(directory,data.book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 return {...data,record,f,app,async close(){await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}};
}
test('reference picker searches saved destinations, pins exact references and never hydrates the record editor',async({page},info)=>{
 test.setTimeout(120000);const f=await fixture(),errors=[],requests=[],dialog=page.locator('.record-reference-picker');page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));
 try{
  await page.goto(f.app.url);await expect(page.locator('#main-navigation')).toBeVisible();await page.goto(f.app.origin+'/#/records/'+f.record.id+'/read');await expect(page.locator('.record-reader h1')).toHaveText(f.record.title);
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);await page.getByRole('button',{name:'Copy record reference',exact:true}).click();expect(parseResearchReference(await page.evaluate(()=>navigator.clipboard.readText()))).toEqual({workspaceId:f.book.id,kind:'record',id:f.record.id});
  await openRecordActions(page);await page.getByRole('button',{name:'Copy section, figure or table reference',exact:true}).click();
  await expect(dialog.getByLabel('Content destination')).toBeEnabled();await expect(dialog.getByLabel('Content destination').locator('option')).toHaveCount(20);
  await dialog.getByRole('button',{name:'Next destinations',exact:true}).click();await expect(dialog.getByLabel('Content destination').locator('option').first()).toHaveText('Observation 21');
  await dialog.getByRole('button',{name:'Previous destinations',exact:true}).click();await expect(dialog.getByLabel('Content destination').locator('option').first()).toHaveText('Observation 1');
  await dialog.getByLabel('Find a destination').fill('Exact measurements');await dialog.getByLabel('Find a destination').press('Enter');await expect(dialog.getByLabel('Content destination').locator('option')).toHaveText(['Exact measurements']);
  await dialog.getByLabel('Reference version').selectOption('exact');await page.context().grantPermissions(['clipboard-read','clipboard-write']);await dialog.getByRole('button',{name:'Copy reference',exact:true}).click();await expect(dialog).not.toBeVisible();
  const reference=parseResearchReference(await page.evaluate(()=>navigator.clipboard.readText()));expect(reference).toEqual({workspaceId:f.book.id,kind:'record',id:f.record.id,revision:recordRevision(f.record),selector:{version:1,kind:'table',id:f.table.attrs.id}});
  await openRecordActions(page);await page.getByRole('button',{name:'Copy section, figure or table reference',exact:true}).click();await expect(dialog.getByLabel('Content destination')).toBeEnabled();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('reference-picker-phone.png')});
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));
  // A later record change does not silently change the selected saved version.
  const changed={...f.record,sections:f.record.sections.map(s=>({...s,title:'Amended '+s.title}))};await new ResearchRecords(f.f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:f.record.id,expectedRevision:recordRevision(f.record),record:changed}]},{receipt:true});
  await dialog.getByLabel('Reference version').selectOption('exact');await dialog.getByRole('button',{name:'Copy reference',exact:true}).click();await expect(dialog.getByRole('alert')).not.toBeEmpty();
  await expect(dialog.getByLabel('Content destination').locator('option').first()).toHaveText('Observation 1');
  await dialog.getByRole('button',{name:'Refresh destinations',exact:true}).click();await expect(dialog.getByLabel('Content destination').locator('option').first()).toHaveText('Amended Observation 1');
  // Clipboard denial leaves a selectable reference rather than losing it.
  await page.evaluate(()=>Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async()=>{throw Error('Clipboard unavailable');}}));
  await dialog.getByLabel('Reference version').selectOption('current');await dialog.getByRole('button',{name:'Copy reference',exact:true}).click();
  const fallback=dialog.getByRole('textbox',{name:'Copy section, figure or table reference',exact:true});await expect(fallback).toBeVisible();expect(parseResearchReference(await fallback.inputValue()).selector.id).toBe(f.record.sections[0].id);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Copy record reference',exact:true}).click();const plain=page.getByRole('dialog',{name:'Research reference',exact:true});await expect(plain).toBeVisible();expect(parseResearchReference(await plain.locator('.research-reference').textContent()).id).toBe(f.record.id);await plain.getByRole('button',{name:'Close',exact:true}).click();
  expect(requests.some(url=>/\/workspace\/read\/(selection|page)$/.test(url))).toBe(false);expect(errors).toEqual([]);
 }finally{await f.close();}
});
test('reference searches retry the exact failed window, cancel promptly and ignore responses after navigation',async({page})=>{
 test.setTimeout(90000);const f=await fixture(),dialog=page.locator('.record-reference-picker'),cursors=[];let failed=false;
 try{
  await page.goto(f.app.url);await expect(page.locator('#main-navigation')).toBeVisible();await page.goto(f.app.origin+'/#/records/'+f.record.id+'/read');await expect(page.locator('.record-reader h1')).toHaveText(f.record.title);await openRecordActions(page);await page.getByRole('button',{name:'Copy section, figure or table reference',exact:true}).click();await expect(dialog.getByLabel('Content destination')).toBeEnabled();
  await page.route('**/api/workspace/read/record-selectors',async route=>{const body=route.request().postDataJSON();if(body.search&&body.cursor){cursors.push(body.cursor);if(!failed){failed=true;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Interrupted destination lookup'})});return;}}await route.continue();});
  await dialog.getByLabel('Find a destination').fill('Observation 81');await dialog.getByRole('button',{name:'Find',exact:true}).click();await expect(dialog.getByRole('alert')).toHaveText('Interrupted destination lookup');await dialog.getByRole('button',{name:'Try again',exact:true}).click();await expect(dialog.getByLabel('Content destination').locator('option')).toHaveText(['Observation 81']);expect(cursors[0]).toBe(cursors[1]);await page.unroute('**/api/workspace/read/record-selectors');
  let resume,reached;const held=new Promise(resolve=>resume=resolve),waiting=new Promise(resolve=>reached=resolve);let pause=true;
  await page.route('**/api/workspace/read/record-selectors',async route=>{if(pause&&route.request().postDataJSON().cursor){pause=false;reached();await held;}await route.continue().catch(()=>{});});
  await dialog.getByLabel('Find a destination').fill('No matching destination');await dialog.getByRole('button',{name:'Find',exact:true}).click();await waiting;await dialog.getByRole('button',{name:'Cancel loading',exact:true}).click();resume();await expect(dialog.getByRole('alert')).toContainText('Loading stopped');await expect(dialog.getByLabel('Content destination').locator('option')).toHaveText(['Observation 81']);
  await dialog.getByRole('button',{name:'Try again',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('No matching destinations in this saved record.');await expect(dialog.getByRole('button',{name:'Copy reference',exact:true})).toBeDisabled();await page.unroute('**/api/workspace/read/record-selectors');
  let releaseLate,enteredLate;const late=new Promise(resolve=>releaseLate=resolve),entered=new Promise(resolve=>enteredLate=resolve);
  await page.route('**/api/workspace/read/record-selectors',async route=>{enteredLate();await late;await route.continue().catch(()=>{});});
  await dialog.getByRole('button',{name:'Refresh destinations',exact:true}).click();await entered;
  await page.evaluate(id=>location.hash='#/records/'+id+'/read',f.experiment.id);await expect(dialog).not.toBeVisible();releaseLate();await expect(page.locator('.record-reader h1')).toHaveText(f.experiment.title);await expect(dialog).not.toBeVisible();
 }finally{await f.close();}
});
