import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {attemptFixture} from '../fixtures/attempts.js';

test('normal record reading pages stored sections without selection hydration and preserves editing',async({page},info)=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-reading-blocks-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];
 record.sections=Array.from({length:257},(_,i)=>({id:randomUUID(),title:'Observation '+(i+1),body:'Exact retained observations '+i+' '+('kept '.repeat(100))}));
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/workspace/read/'))requests.push(r.url());});
 try{
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  requests.length=0;
  await page.goto(app.origin+'/#/records/'+record.id+'/read/'+record.sections[250].id);
  await expect(page.locator('#record-section-'+record.sections[250].id)).toBeFocused();
  await expect(page.locator('.record-sections>section[id]')).toHaveCount(4);
  expect(requests.some(url=>url.endsWith('/record-content'))).toBe(true);
  expect(requests.some(url=>url.endsWith('/start'))).toBe(false);
  expect(requests.some(url=>/\/(selection|page)$/.test(url))).toBe(false);
  let interrupt=true;const cursors=[];
  await page.route('**/api/workspace/read/record-content',async route=>{
   const command=route.request().postDataJSON();if(command.cursor&&command.search){cursors.push(command.cursor);if(interrupt){interrupt=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic interrupted reading request'})});return;}}
   await route.continue();
  });
  await page.getByLabel('Find section heading',{exact:true}).fill('Observation 257');await page.getByRole('button',{name:'Find next',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic interrupted reading request');await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.locator('#record-section-'+record.sections[256].id)).toBeFocused();
  await expect(page.getByRole('button',{name:'Next sections',exact:true})).toBeDisabled();
  expect(cursors[0]).toBe(cursors[1]);await page.unroute('**/api/workspace/read/record-content');
  let resume;const held=new Promise(resolve=>resume=resolve);let waiting;const reached=new Promise(resolve=>waiting=resolve);let pause=true;
  await page.route('**/api/workspace/read/record-content',async route=>{if(pause&&route.request().postDataJSON().cursor){pause=false;waiting();await held;}await route.continue().catch(()=>{});});
  await page.getByLabel('Find section heading',{exact:true}).fill('Observation 240');await page.getByRole('button',{name:'Find next',exact:true}).click();await reached;
  await page.getByRole('button',{name:'Cancel loading',exact:true}).click();resume();await expect(page.getByRole('alert')).toContainText('Loading stopped');
  await expect(page.locator('#record-section-'+record.sections[256].id)).toBeVisible();
  await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(page.locator('#record-section-'+record.sections[239].id)).toBeFocused();await page.unroute('**/api/workspace/read/record-content');
  await page.getByLabel('Go to section number',{exact:true}).fill('129');await page.getByRole('button',{name:'Go',exact:true}).click();
  await expect(page.locator('#record-section-'+record.sections[128].id)).toBeFocused();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('stored-section-reading.png')});
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));
  await page.getByRole('button',{name:'Edit record',exact:true}).click();await expect(page.getByRole('navigation',{name:'Record editing areas',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Edit selected detail',exact:true}).click();const edit=page.getByRole('dialog',{name:'Edit Record title',exact:true});
  await edit.getByLabel('Record title',{exact:true}).fill('Amended title');
  await edit.getByRole('button',{name:'Save changes',exact:true}).click();await expect(edit).not.toBeVisible();
  await expect(page.locator('.record-reader h1')).toHaveText('Amended title');
  expect(requests.some(url=>/\/(selection|page)$/.test(url))).toBe(false);
  const saved=(await f.workspace.read()).book.entries.find(e=>e.id===record.id);expect(saved.sections).toEqual(record.sections);
  await page.getByRole('button',{name:'Read record',exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText('Amended title');
  const next={...saved,title:'Written from another session'};
  await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(saved),record:next}]},{receipt:true});
  await page.locator('.brand[data-action="workspace-refresh"]').click();await expect(page.locator('.record-reader h1')).toHaveText(next.title);
  await expect(page.getByRole('button',{name:'History',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'History',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Current saved version');
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('paged readers open exact methods and result evidence without entering editing or loading the record body',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-reading-references-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0],method=book.entries[1];
 record.sections=Array.from({length:129},(_,i)=>({id:randomUUID(),title:'Observation '+i,body:'Retained window '+i}));record.figures=[];record.attachments=[];
 method.body='Exact instructions used for this run';book.title='workspace';
 const f=await encryptedFixture(directory,book),materials=new ResearchMaterials(f.workspace),records=new ResearchRecords(f.workspace,{}),bytes=Buffer.from('Exact captured observations 9007199254740993 / 3');
 const upload=await materials.startImport({recordId:record.id,name:'source-observations.txt',size:bytes.length,provenance:'Synthetic reference navigation'});await materials.appendImport(upload.id,0,[bytes]);const artifact=await materials.finishImport(upload.id);
 const analysis=await materials.analysis({recordId:record.id,title:'Retained reference analysis',inputs:[artifact],tool:'Synthetic decoder',version:'1',parameters:'Pinned decoder settings',outputs:[]});
 const pinned=await materials.pinRecord(method.id,recordRevision(method)),next=structuredClone(record);
 next.attempt=attemptFixture({protocols:[{...pinned,label:'Method used for this run'}]});
 next.results={version:1,statements:[{id:randomUUID(),kind:'number',title:'Exact result',text:'9007199254740993/3',basis:'retained',source:{...analysis,workspaceId:book.id,label:'Retained reference analysis'},limitations:'Synthetic reading qualification'}]};
 await records.save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:next}]},{receipt:true});
 await records.save({workspaceId:book.id,changes:[{id:method.id,expectedRevision:recordRevision(method),record:{...method,body:'Later changed method instructions'}}]},{receipt:true});
 const before=await f.workspace.outline(),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/api/'))requests.push(new URL(request.url()).pathname);});
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read/'+record.sections[127].id);
  const reader=page.locator('.record-reader'),dialog=page.locator('#dialog');await expect(page.locator('#record-section-'+record.sections[127].id)).toBeFocused();
  await reader.getByRole('button',{name:/Method used for this run/}).click();await expect(dialog).toContainText(method.body);await expect(dialog).not.toContainText('Later changed method instructions');
  await dialog.getByRole('button',{name:'Compare with saved record',exact:true}).click();await expect(dialog).toContainText(method.body);await expect(dialog).toContainText('Later changed method instructions');await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await expect(reader).toBeVisible();await expect(page).toHaveURL(new RegExp('/read/'+record.sections[127].id+'$'));await expect(page.locator('[contenteditable=true]')).toHaveCount(0);
  await reader.locator('[data-action="result-reference"]').click();await expect(dialog).toContainText('Pinned decoder settings');await expect(dialog.getByRole('button',{name:'Add retained figure to record',exact:true})).toHaveCount(0);
  await dialog.locator('[data-action="material-reference"]').first().click();await expect(dialog).toContainText('source-observations.txt');
  const download=page.waitForEvent('download');await dialog.getByRole('button',{name:/Download original/}).click();const file=await download;expect(file.suggestedFilename()).toBe('source-observations.txt');expect(await readFile(await file.path())).toEqual(bytes);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(reader).toBeVisible();await expect(page.locator('#record-section-'+record.sections[127].id)).toBeVisible();
  expect(requests.filter(route=>/^\/api\/workspace\/read\/(selection|page)$/.test(route)||route==='/api/research/records/save')).toEqual([]);expect((await f.workspace.outline()).etag).toBe(before.etag);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
