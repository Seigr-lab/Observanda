import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';

test('analysis record drafts recover after a rejected checkpoint, restart and concurrent result edits',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-result-recovery-ui-')),book=sampleNotebook(),record=book.entries[0];
 record.results={version:1,statements:[{id:randomUUID(),kind:'number',title:'Exact timing result',text:'9007199254740993/6',basis:'authored',source:null,limitations:'Declared measurement scope'}]};
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 let rejected=false,lost=false;
 try{
  await page.route('**/api/research/drafts/write',async route=>{
   const command=route.request().postDataJSON();requests.push(command);
   if(!rejected){rejected=true;await route.fulfill({status:400,json:{code:'INVALID',message:'Synthetic checkpoint validation refusal'}});return;}
   if(!lost){lost=true;await route.fetch();await route.abort();return;}
   await route.continue();
  });
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);await expect(page.getByLabel('Record title',{exact:true})).toHaveValue(record.title);
  await page.getByLabel('Record title',{exact:true}).fill('Rejected initial edit');
  await expect(page.locator('[data-record-checkpoint]')).toContainText('Synthetic checkpoint validation refusal');
  await page.getByLabel('Record title',{exact:true}).fill('Recoverable analysis edit');
  await expect.poll(()=>requests.length).toBe(2);await expect(page.locator('[data-record-checkpoint]')).toContainText('Draft not checkpointed');
  await page.getByRole('button',{name:'Retry checkpoint',exact:true}).click();
  await expect(page.locator('[data-record-checkpoint]')).toContainText('Record draft checkpointed');
  expect(requests[1].changes[0].record.title).toBe('Recoverable analysis edit');expect(requests[2]).toEqual(requests[1]);
  const drafts=new ResearchDrafts(f.workspace),items=await drafts.list({workspaceId:book.id});expect(items.drafts).toHaveLength(1);
  const stored=await drafts.read(items.drafts[0].id);expect(stored.draft.changes[0].record.results).toEqual(record.results);
  const remote={...structuredClone(record),results:{version:1,statements:[...record.results.statements,{...record.results.statements[0],id:randomUUID(),title:'Independent conclusion',text:'Concurrent observation'}]}};
  await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:remote}]},{receipt:true});
  await page.unroute('**/api/research/drafts/write');await page.reload();
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();
  await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();
  const review=page.getByRole('dialog',{name:'Recover record draft',exact:true});await expect(review.locator('.record-conflict')).toHaveCount(0);
  await expect(review).toContainText('Conclusions, numbers and tables');await review.getByRole('button',{name:'Continue editing',exact:true}).click();
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Recoverable analysis edit');
  await expect(page.locator('[data-record-checkpoint]')).toContainText('Record draft checkpointed');
  await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  const saved=(await f.workspace.read()).book.entries[0];expect(saved.title).toBe('Recoverable analysis edit');expect(saved.results).toEqual(remote.results);expect(errors.filter(message=>!message.includes('net::ERR_FAILED'))).toEqual([]);
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
