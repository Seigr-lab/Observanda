import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {RecordHistory} from '../../src/record-history.js';
import {buildPublication} from '../../src/publication.js';
import {Workspace} from '../../src/storage.js';
import {copyPlan,encryptedCopy} from '../../src/locations.js';
import {createAccess,takeCreatedVault} from '../../src/access.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';

test('long records keep writing sections, edits and anchored reading in independent visible windows',async({page},info)=>{
 test.setTimeout(120000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-section-windows-')),book=upgradeNotebook(sampleNotebook()),e=book.entries[0];
 e.sections=Array.from({length:257},(_,i)=>({id:randomUUID(),title:'Observation '+(i+1),body:'Exact retained notes '+(i+1)+'. '+('Detail from this acquisition. '.repeat(10))}));
 const original=structuredClone(e),f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await expect(page.locator('#main-navigation')).toBeVisible();await page.evaluate(id=>location.hash='#/records/'+id,e.id);
  await expect(page.locator('.record-section')).toHaveCount(4);await expect(page.locator('.editor-paper .ProseMirror')).toHaveCount(5);
  await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.getByLabel('Find section heading',{exact:true}).fill('Observation 257');await page.getByRole('button',{name:'Find next',exact:true}).click();await expect(page.getByLabel('Section heading',{exact:true}).first()).toHaveValue('Observation 257');await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.getByLabel('Find section heading',{exact:true}).fill('Absent heading');await page.getByRole('button',{name:'Find next',exact:true}).click();await expect(page.locator('[data-section-search-status]')).toHaveText('No section heading matches.');await expect(page.getByLabel('Section heading',{exact:true}).first()).toHaveValue('Observation 257');
  await page.getByLabel('Go to section number',{exact:true}).fill('1');await page.getByRole('button',{name:'Go',exact:true}).click();
  await page.getByRole('button',{name:'Next sections',exact:true}).click();await expect(page.getByLabel('Section heading',{exact:true}).first()).toHaveValue('Observation 5');await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.getByRole('button',{name:'Previous sections',exact:true}).click();await page.getByLabel('Observation 1 content',{exact:true}).fill('Revised first observation');
  const go=async n=>{await page.getByLabel('Go to section number',{exact:true}).fill(String(n));await page.getByRole('button',{name:'Go',exact:true}).click();};
  await go(131);await page.getByLabel('Observation 131 content',{exact:true}).fill('Revised late observation');
  await go(1);await expect(page.getByLabel('Observation 1 content',{exact:true})).toHaveText('Revised first observation');await go(131);await expect(page.getByLabel('Observation 131 content',{exact:true})).toHaveText('Revised late observation');
  await page.getByRole('button',{name:'Move Observation 134 down',exact:true}).click();await expect(page.locator('[data-writing-heading="'+e.sections[133].id+'"]')).toBeFocused();
  await page.getByRole('button',{name:'Add section',exact:true}).click();await expect(page.getByLabel('Section heading',{exact:true}).last()).toBeFocused();await page.getByLabel('Section heading',{exact:true}).last().fill('Final observations');await page.getByLabel('Final observations content',{exact:true}).fill('A newly added section beyond the earlier count ceiling.');
  await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  const saved=(await f.workspace.read()).book.entries[0];expect(saved.sections).toHaveLength(258);expect(saved.sections[134].id).toBe(e.sections[133].id);expect(saved.sections[130].body.content[0].content[0].text).toBe('Revised late observation');expect(saved.sections[5]).toEqual(e.sections[5]);
  await page.getByRole('button',{name:'Dismiss',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');await page.locator('.record-section-navigation').scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('continued-record-editor.png')});await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));
  await page.evaluate(({id,section})=>location.hash='#/records/'+id+'/read/'+section,{id:e.id,section:e.sections[211].id});
  await expect(page.locator('#record-section-'+e.sections[211].id)).toBeFocused();await expect(page.locator('.record-sections>section[id]')).toHaveCount(4);await expect(page.locator('.record-sections')).toContainText('Exact retained notes 212.');
  await page.getByRole('button',{name:'Next sections',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.locator('#record-section-'+e.sections[215].id)).toBeFocused();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');await page.getByRole('button',{name:'Previous sections',exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('continued-record-sections.png')});
  const history=new RecordHistory(f.workspace,{}),command={workspaceId:book.id,recordId:e.id},versions=await history.list(command),version=versions.versions.find(v=>v.revision===recordRevision(original));expect(version).toBeDefined();expect((await history.read({...command,...version})).record).toEqual(original);
  const current=(await f.workspace.read()).book,edition=buildPublication(current),html=edition.files.get('entries/'+e.id+'.html');expect(html).toContain('Final observations');for(const s of saved.sections)expect(html).toContain('id="record-section-'+s.id+'"');
  const access=await createAccess('','record section recovery test password'),restoredVault=takeCreatedVault(access),destination=path.join(directory,'restored');
  try{await encryptedCopy(await copyPlan(f.workspace.root,destination),access,restoredVault,f.vault);const restored=new Workspace(destination,restoredVault);expect((await restored.read()).book.entries[0]).toEqual(saved);expect((await new RecordHistory(restored,{}).read({...command,...version})).record).toEqual(original);}finally{clearVault(restoredVault);}
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
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
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
