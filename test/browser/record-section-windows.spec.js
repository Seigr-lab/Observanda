import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {RecordContent} from '../../src/record-content.js';
import {RecordWriting} from '../../src/record-writing.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';

test('long records page their sections in windows for reading, editing, finding and anchored links',async({page},info)=>{
 test.setTimeout(180000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-section-windows-')),book=upgradeNotebook(sampleNotebook()),e=book.entries[0];
 e.sections=Array.from({length:257},(_,i)=>({id:randomUUID(),title:'Observation '+(i+1),body:'Exact retained notes '+(i+1)+'. '+('Detail from this acquisition. '.repeat(10))}));
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const content=new RecordContent(f.workspace),target={workspaceId:book.id,recordId:e.id},writing=new RecordWriting(f.workspace);
 const shown=page.locator('.record-sections>section[id]'),range=page.locator('.record-section-navigation [role=status]'),section=i=>page.locator('#record-section-'+e.sections[i].id);
 const go=async n=>{await page.getByLabel('Go to section number',{exact:true}).fill(String(n));await page.getByRole('button',{name:'Go',exact:true}).click();await expect(section(n-1)).toBeVisible();};
 const write=async(i,text)=>{await section(i).getByRole('button',{name:'Edit section',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Edit writing section',exact:true});await dialog.locator('.ProseMirror').fill(text);await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(section(i)).toContainText(text);};
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+e.id+'/read');
  // Reading shows one window of four sections with its position.
  await expect(shown).toHaveCount(4);await expect(range).toHaveText('Sections 1–4 of 257');await expect(page.getByRole('button',{name:'Previous sections',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Next sections',exact:true}).click();await expect(range).toHaveText('Sections 5–8 of 257');await expect(section(4)).toBeVisible();
  await page.getByRole('button',{name:'Previous sections',exact:true}).click();await expect(range).toHaveText('Sections 1–4 of 257');
  await page.getByLabel('Find section heading',{exact:true}).fill('Observation 257');await page.getByRole('button',{name:'Find next',exact:true}).click();await expect(section(256)).toBeVisible();await expect(range).toHaveText('Sections 257–257 of 257');
  await page.getByLabel('Find section heading',{exact:true}).fill('Absent heading');await page.getByRole('button',{name:'Find next',exact:true}).click();await expect(page.getByRole('alert')).toContainText('No section heading matches.');
  // Editing works in any window and keeps every other section.
  await page.getByRole('button',{name:'Edit record',exact:true}).click();await expect(page.getByRole('navigation',{name:'Record editing areas',exact:true})).toBeVisible();
  await go(1);await write(0,'Revised first observation');await go(131);await write(130,'Revised late observation');
  await go(134);await section(133).getByRole('button',{name:'Move down',exact:true}).click();
  await expect.poll(async()=>(await content.read({...target,offset:133})).sections.values.map(s=>s.id).slice(0,2)).toEqual([e.sections[134].id,e.sections[133].id]);
  await go(257);await page.getByRole('button',{name:'Add writing section',exact:true}).click();const added=page.getByRole('dialog',{name:'Edit writing section',exact:true});
  await added.getByLabel('Section heading',{exact:true}).fill('Final observations');await added.locator('.ProseMirror').fill('Closing notes.');await added.getByRole('button',{name:'Save changes',exact:true}).click();await expect(added).not.toBeVisible();
  await expect(page.getByRole('heading',{name:'Final observations',exact:true})).toBeVisible();
  const last=await content.read({...target,offset:257});expect(last.sections.total).toBe(258);expect(last.sections.values[0].title).toBe('Final observations');
  expect(JSON.stringify((await writing.read({...target,sectionId:e.sections[0].id})).value.body)).toContain('Revised first observation');
  expect(JSON.stringify((await writing.read({...target,sectionId:e.sections[130].id})).value.body)).toContain('Revised late observation');
  // An anchored link opens the window that holds its section, and paging moves focus with the window.
  await page.evaluate(({id,section})=>location.hash='#/records/'+id+'/read/'+section,{id:e.id,section:e.sections[211].id});
  await expect(section(211)).toBeFocused();await expect(shown).toHaveCount(4);await expect(page.locator('.record-sections')).toContainText('Exact retained notes 212.');
  await page.getByRole('button',{name:'Next sections',exact:true}).click();await expect(shown.first()).toBeFocused();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('section-windows-mobile.png')});
  expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('conflict review keeps choices across windows and cancellation preserves the recoverable draft',async({page})=>{
 test.setTimeout(120000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-conflict-windows-')),book=upgradeNotebook(sampleNotebook()),base=book.entries[0];base.sections=Array.from({length:45},(_,i)=>({id:randomUUID(),title:'Section '+(i+1),body:'Original '+(i+1)}));
 const f=await encryptedFixture(directory,book),mine=structuredClone(base),remote=structuredClone(base);
 for(let i=0;i<17;i++){mine.sections[i].body='My observation '+(i+1);remote.sections[i].body='Other observation '+(i+1);}
 const drafts=new ResearchDrafts(f.workspace),id=randomUUID();await drafts.write({id,workspaceId:book.id,expectedRevision:null,changes:[{base,record:mine,expectedRevision:recordRevision(base)}]});await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:base.id,expectedRevision:recordRevision(base),record:remote}]});
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 try{
  await page.goto(app.url);const open=async()=>{const listing=page.getByRole('dialog',{name:'Recoverable record drafts',exact:true});if(!await listing.isVisible())await page.getByRole('button',{name:'Review drafts',exact:true}).click();await listing.getByRole('button',{name:'Review draft',exact:true}).click();};await open();const dialog=page.getByRole('dialog',{name:'Recover record draft',exact:true});
  await expect(dialog.locator('.record-conflict')).toHaveCount(1);await expect(dialog.getByRole('status')).toContainText('Field 1 of 17');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect((await drafts.read(id)).draft.changes[0].record).toEqual(mine);
  await open();await dialog.getByLabel('Write a combined version',{exact:true}).check();await dialog.locator('[data-combined]').fill('Combined precise observation');await dialog.getByRole('button',{name:'Next field',exact:true}).click();await dialog.getByLabel('Saved version',{exact:false}).check();await dialog.getByRole('button',{name:'Previous field',exact:true}).click();await expect(dialog.getByLabel('Write a combined version',{exact:true})).toBeChecked();await expect(dialog.locator('[data-combined]')).toHaveValue('Combined precise observation');
  await dialog.getByRole('button',{name:'Continue editing',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Field 3 of 17');await expect(dialog.getByRole('alert')).toContainText('Choose a version');
  for(let i=2;i<17;i++){await expect(dialog.locator('.record-conflict')).toHaveCount(1);await dialog.getByLabel('Your version',{exact:false}).check();if(i<16)await dialog.getByRole('button',{name:'Next unresolved field',exact:true}).click();}
  await expect(dialog.getByRole('status')).toContainText('17 choices made');await dialog.getByRole('button',{name:'Continue editing',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.locator('[data-record-checkpoint]')).toContainText('Record draft checkpointed');await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  const saved=(await f.workspace.read()).book.entries[0];expect(saved.sections[0].body).toBe('Combined precise observation');expect(saved.sections[1].body).toBe('Other observation 2');expect(saved.sections.slice(2,17)).toEqual(mine.sections.slice(2,17));expect(saved.sections.slice(17)).toEqual(base.sections.slice(17));
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
