import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {largeRecordBook} from '../record-capacity-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {ResearchDrafts} from '../../src/research-drafts.js';

test('near-limit records recover newer input after a lost checkpoint reply and clear it after save',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-capacity-')),book=largeRecordBook();
 const {workspace:ws,vault,deviceStore}=await encryptedFixture(directory,book);
 const app=await startServer({root:ws.root,deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
 let release=()=>{},lost=true;
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);
  const title=page.getByLabel('Record title',{exact:true});
  await expect(title).toHaveValue(book.entries[0].title);
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/research/drafts/write',async route=>{
   requests.push(route.request().postDataJSON());
   if(lost){lost=false;const response=await route.fetch();expect(response.ok()).toBe(true);await gate;await route.abort('failed');}
   else await route.continue();
  });
  await title.fill('First unsaved title');
  await expect.poll(()=>requests.length).toBe(1);
  await title.fill('Newer unsaved title');release();
  await expect(page.locator('[data-record-draft-retry]')).toBeVisible();
  await page.locator('[data-record-draft-retry]').click();
  await expect.poll(()=>requests.length).toBeGreaterThanOrEqual(3);
  await expect(page.locator('[data-record-checkpoint]')).toContainText('Record draft checkpointed');
  expect(requests[1]).toEqual(requests[0]);
  expect(requests.at(-1).changes[0].record.title).toBe('Newer unsaved title');
  expect(requests.every(request=>request.changes[0].base===undefined)).toBe(true);
  const drafts=new ResearchDrafts(ws),listing=await drafts.list({workspaceId:book.id});
  expect(listing.drafts).toHaveLength(1);
  const stored=await drafts.read(listing.drafts[0].id);
  expect(stored.draft.changes[0].record.title).toBe('Newer unsaved title');
  expect(stored.draft.changes[0].base).toEqual(book.entries[0]);
  await page.reload();await expect(title).toHaveValue(book.entries[0].title);
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();
  await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();
  await page.getByRole('dialog',{name:'Recover record draft',exact:true}).getByRole('button',{name:'Continue editing',exact:true}).click();
  await expect(title).toHaveValue('Newer unsaved title');
  await page.getByRole('button',{name:'Save record',exact:true}).click();
  await expect(page.locator('#save-status')).toHaveText('Saved');
  const saved=(await ws.read()).book.entries[0];
  expect(saved.title).toBe('Newer unsaved title');expect(saved.sections).toEqual(book.entries[0].sections);
  // A separately lost checkpoint reply followed directly by Save must also
  // resolve and remove the uncertain writer rather than orphaning its draft.
  await page.unroute('**/api/research/drafts/write');lost=true;
  await page.route('**/api/research/drafts/write',async route=>{
   if(lost){lost=false;expect((await route.fetch()).ok()).toBe(true);await route.abort('failed');}
   else await route.continue();
  });
  await title.fill('Saved after uncertain checkpoint');
  await expect(page.locator('[data-record-draft-retry]')).toBeVisible();
  await page.getByRole('button',{name:'Save record',exact:true}).click();
  await expect(page.locator('#save-status')).toHaveText('Saved');
  await expect.poll(async()=> (await drafts.list({workspaceId:book.id})).drafts.length).toBe(0);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({checkpointBytes:Buffer.byteLength(JSON.stringify(requests[0])),browserHeapMiB:Math.ceil(await page.evaluate(()=>performance.memory?.usedJSHeapSize??0)/1048576)}));
 }finally{release();await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true});}
});
