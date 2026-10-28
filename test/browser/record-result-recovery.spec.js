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
import {openRecordDetail} from './record-editing-helper.js';

test('analysis record drafts recover after a rejected checkpoint, restart and concurrent result edits',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-result-recovery-ui-')),book=sampleNotebook(),record=book.entries[0];
 record.results={version:1,statements:[{id:randomUUID(),kind:'number',title:'Exact timing result',text:'9007199254740993/6',basis:'authored',source:null,limitations:'Declared measurement scope'}]};
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 let rejected=false,lost=false;
 try{
  await page.route('**/api/research/drafts/values/write',async route=>{
   const command=route.request().postDataJSON();requests.push(command);
   if(!rejected){rejected=true;await route.fulfill({status:400,json:{code:'INVALID',message:'Synthetic checkpoint validation refusal'}});return;}
   if(!lost){lost=true;await route.fetch();await route.abort();return;}
   await route.continue();
  });
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);let edit=await openRecordDetail(page);
  await expect(edit.getByLabel('Record title',{exact:true})).toHaveValue(record.title);
  await edit.getByLabel('Record title',{exact:true}).fill('Rejected initial edit');
  await expect(edit.locator('[data-writing-error]')).toContainText('Synthetic checkpoint validation refusal');
  await edit.getByLabel('Record title',{exact:true}).fill('Recoverable analysis edit');
  await expect.poll(()=>requests.length).toBe(2);await expect(edit.locator('[data-writing-error]')).not.toBeEmpty();
  await edit.getByRole('button',{name:'Retry checkpoint',exact:true}).click();
  await expect(edit.locator('[data-writing-status]')).toHaveText('Recovery checkpoint saved.');
  expect(requests[1].selection.field).toBe('title');expect(requests[1].value.value).toBe('Recoverable analysis edit');expect(requests[2]).toEqual(requests[1]);
  const drafts=new ResearchDrafts(f.workspace),items=await drafts.list({workspaceId:book.id});expect(items.drafts).toHaveLength(1);
  const stored=await drafts.read(items.drafts[0].id,{header:true});expect(stored.draft.selection.field).toBe('title');
  const current=(await f.workspace.read()).book.entries.find(row=>row.id===record.id),remote={...current,results:{version:1,statements:[...record.results.statements,{...record.results.statements[0],id:randomUUID(),title:'Independent conclusion',text:'Concurrent observation'}]}};
  await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(current),record:remote}]},{receipt:true});
  await edit.getByRole('button',{name:'Keep recovery checkpoint and close',exact:true}).click();
  await page.unroute('**/api/research/drafts/values/write');await page.reload();
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();
  await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();
  edit=page.getByRole('dialog',{name:'Edit Record title',exact:true});await expect(edit.locator('.record-writing-conflict')).toHaveCount(0);
  await expect(edit.getByLabel('Record title',{exact:true})).toHaveValue('Recoverable analysis edit');
  await edit.getByRole('button',{name:'Save changes',exact:true}).click();await expect(edit).not.toBeVisible();
  const saved=(await f.workspace.read()).book.entries[0];expect(saved.title).toBe('Recoverable analysis edit');expect(saved.results).toEqual(remote.results);expect(errors.filter(message=>!message.includes('net::ERR_FAILED'))).toEqual([]);
 }finally{await page.unrouteAll({behavior:'ignoreErrors'});await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
