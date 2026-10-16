import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {largeRecordBook} from '../record-capacity-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {proseText} from '../../src/web/prose-model.js';

test('capacity preflight keeps a refused research save recoverable without sending it',async({page},testInfo)=>{
 test.setTimeout(90000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-capacity-refusal-ui-')),book=largeRecordBook(),f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')}),errors=[],saves=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());page.on('request',request=>{if(request.url().endsWith('/api/research/records/save'))saves.push(request.postDataJSON());});
  const waits=[];
  // This is an encrypted multi-request persistence operation, not a synchronous
  // UI assertion. Keep its observed latency alongside the content assertions.
  const checkpoint=async()=>{const start=performance.now();try{await expect(page.locator('[data-record-checkpoint]')).toContainText('Record draft checkpointed',{timeout:15000});}finally{waits.push(Math.round(performance.now()-start));}};
 try{
  await page.addInitScript(()=>{const stringify=JSON.stringify;JSON.stringify=function(value,...options){if(window.refuseOversizedSaveEncoding&&value?.changes?.some(change=>change.id&&change.record))throw Error('Oversized save was serialized before its capacity check');return stringify.call(this,value,...options);};});
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);
  const editor=page.locator('.document-field').first().getByRole('textbox'),text='界'.repeat(50000);
  await editor.fill(text);await checkpoint();
  await page.evaluate(()=>window.refuseOversizedSaveEncoding=true);await page.getByRole('button',{name:'Save record',exact:true}).click();
  await expect(page.locator('#notice')).toContainText('Record content needs');await expect(page.locator('#notice')).toContainText('2097152 bytes');
  await expect(page.locator('#save-status')).toHaveText('Unsaved changes');await expect(editor).toHaveText(text);expect(saves).toHaveLength(0);
  await page.evaluate(()=>window.refuseOversizedSaveEncoding=false);
  const drafts=new ResearchDrafts(f.workspace),items=await drafts.list({workspaceId:book.id});expect(items.drafts).toHaveLength(1);
  expect(proseText((await drafts.read(items.drafts[0].id)).draft.changes[0].record.body)).toBe(text);expect((await f.workspace.read()).book.entries[0].body).toBe('');
  await page.reload();await page.getByRole('button',{name:'Review drafts',exact:true}).click();
  await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();
  await page.getByRole('dialog',{name:'Recover record draft',exact:true}).getByRole('button',{name:'Continue editing',exact:true}).click();
  await expect(editor).toHaveText(text);await checkpoint();
  await page.getByRole('button',{name:'Add section',exact:true}).click();
  await checkpoint();
  const sectionId=await page.locator('.record-section').last().getAttribute('data-writing-section');
  const checkpoints=await drafts.list({workspaceId:book.id}),previous=await drafts.read(checkpoints.drafts[0].id),section=page.locator('[data-writing-section="'+sectionId+'"]').locator('.document-field').getByRole('textbox');
  await section.fill('界'.repeat(60000));await checkpoint();
  const large=await drafts.read(previous.draft.id,{header:true});expect(large.draft.formatVersion).toBe(3);expect(large.revision).not.toBe(previous.revision);
  await page.reload();await page.getByRole('button',{name:'Review drafts',exact:true}).click();
  await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();
  await page.getByRole('dialog',{name:'Recover record draft',exact:true}).getByRole('button',{name:'Continue editing',exact:true}).click();
  // Recovery opens the first writing window. The last visible section can have
  // identical fixture text, but is not the newly appended section being tested.
  const position=previous.draft.changes[0].record.sections.findIndex(item=>item.id===sectionId)+1;expect(position).toBeGreaterThan(4);
  await page.getByLabel('Go to section number',{exact:true}).fill(String(position));await page.getByRole('button',{name:'Go',exact:true}).click();
  await expect(section).toHaveText('界'.repeat(60000));await expect(editor).toHaveText(text);
  await checkpoint();
  // Shrinking a recovered checkpoint returns to the direct transport safely.
  await section.fill('Reviewed continuation');await checkpoint();
  const continued=await drafts.list({workspaceId:book.id});expect(proseText((await drafts.read(continued.drafts[0].id)).draft.changes[0].record.sections.find(item=>item.id===sectionId).body)).toBe('Reviewed continuation');
  expect(errors).toEqual([]);
 }finally{await testInfo.attach('checkpoint-latency.json',{body:JSON.stringify({checkpointWaitMs:waits}),contentType:'application/json'});await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
