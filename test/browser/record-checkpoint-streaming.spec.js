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

test('edits made during a streamed checkpoint remain recoverable after reload',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-checkpoint-streaming-')),book=largeRecordBook(),f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 let release,entered,first=true;const pending=new Promise(resolve=>{entered=resolve;});
 await page.route('**/api/research/drafts/transfer/start',async route=>{
  if(first){first=false;entered();await new Promise(resolve=>{release=resolve;});}
  await route.continue();
 });
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);
  const editor=page.locator('.document-field').first().getByRole('textbox'),body='界'.repeat(60000);
  await editor.fill(body);await pending;
  await page.getByLabel('Record title',{exact:true}).fill('Written while the checkpoint was uploading');release();release=null;
  const drafts=new ResearchDrafts(f.workspace);
  await expect.poll(async()=>{
   const items=await drafts.list({workspaceId:book.id});if(!items.drafts.length)return null;
   return (await drafts.read(items.drafts[0].id,{header:true})).draft.titles?.[0]??null;
  },{timeout:20000}).toBe('Written while the checkpoint was uploading');
  await expect(page.locator('[data-record-checkpoint]')).toContainText('Record draft checkpointed');
  const item=(await drafts.list({workspaceId:book.id})).drafts[0];expect(proseText((await drafts.read(item.id)).draft.changes[0].record.body)).toBe(body);
  await page.reload();await page.getByRole('button',{name:'Review drafts',exact:true}).click();
  await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();
  await page.getByRole('dialog',{name:'Recover record draft',exact:true}).getByRole('button',{name:'Continue editing',exact:true}).click();
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Written while the checkpoint was uploading');await expect(editor).toHaveText(body);
  await expect(page.locator('[data-record-checkpoint]')).toContainText('Record draft checkpointed');expect(errors).toEqual([]);
 }finally{release?.();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
