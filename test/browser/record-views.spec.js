import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {queryFixture} from '../record-query-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {upgradeNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {RecordViews} from '../../src/record-views.js';
import {testServer} from '../device-fixture.js';

test('save, reopen, edit, discard and remove a private record view without copying records',async({page})=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-view-ui-')),book=upgradeNotebook(queryFixture());
 const {workspace:ws,vault,deviceStore}=await encryptedFixture(root,book);
 const etag=(await ws.read()).etag,app=await testServer({root:ws.root,deviceStore,port:0,headless:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/projects/'+id+'/records',book.projects[0].id);
  await page.getByText('Filters',{exact:true}).click();
  await page.getByLabel('Tags',{exact:true}).fill('sound, summer');
  await page.getByLabel('From date',{exact:true}).fill('2026-06-01');await page.getByLabel('Through date',{exact:true}).fill('2026-06-30');
  await page.getByLabel('Sort records',{exact:true}).selectOption('date-asc');
  const rows=page.locator('.records-table tbody tr'),dialog=page.locator('#dialog');
  await expect(rows).toHaveCount(2);
  await page.getByRole('button',{name:'Saved views',exact:true}).click();
  await dialog.getByRole('button',{name:'Save current view',exact:true}).click();
  await page.getByLabel('View name',{exact:true}).fill('Summer sessions');
  expect((await new RecordViews(ws).list({workspaceId:book.id})).views).toHaveLength(0);
  await dialog.getByRole('button',{name:'Save view',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Summer sessions',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(id=>location.hash='#/notebooks/'+id,book.notebooks.at(-1).id);await expect(rows).toHaveCount(1);
  await page.getByRole('button',{name:'Saved views',exact:true}).click();await dialog.getByRole('button',{name:'Open',exact:true}).click();
  await expect(rows).toHaveCount(2);await expect(page.getByLabel('Tags',{exact:true})).toHaveValue('sound, summer');
  await page.getByRole('button',{name:'Summer take 2',exact:true}).click();
  await expect(page.locator('.record-reader')).toContainText('Recorder stopped early');
  await page.getByRole('button',{name:'Back to records',exact:true}).click();await page.reload();await expect(rows).toHaveCount(2);
  await page.getByRole('button',{name:'Saved views',exact:true}).click();await dialog.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByLabel('View name',{exact:true}).fill('Accidental change');await dialog.getByRole('button',{name:'Back to saved views',exact:true}).click();
  await page.locator('#leave-dialog').getByRole('button',{name:'Stay here'}).click();await expect(page.getByLabel('View name')).toHaveValue('Accidental change');
  await dialog.getByRole('button',{name:'Back to saved views',exact:true}).click();await page.locator('#leave-dialog').getByRole('button',{name:'Discard changes'}).click();
  await expect(dialog.getByRole('heading',{name:'Summer sessions',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('View name').fill('Session comparison');
  await page.route('**/api/research/views/save',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'IO',message:'Synthetic unavailable drive'})}));
  await dialog.getByRole('button',{name:'Save view',exact:true}).click();
  await expect(page.getByLabel('View name')).toHaveValue('Session comparison');await expect(page.locator('#notice')).toContainText('Synthetic unavailable drive');
  await page.unroute('**/api/research/views/save');await dialog.getByRole('button',{name:'Save view',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Session comparison',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Close',exact:true}).click();expect((await ws.read()).etag).toBe(etag);
  // The saved definition finds new matching content, without materializing duplicates.
  const latest=await ws.read();latest.book.entries.push({...latest.book.entries[0],id:randomUUID(),title:'Summer take 3',occurredOn:'2026-06-29'});await ws.save(latest.book,latest.etag);
  await page.reload();await expect(rows).toHaveCount(3);await page.getByRole('button',{name:'Saved views',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Session comparison',exact:true})).toBeVisible();

  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.setProperty('--app-font-size','24px'));
  await dialog.getByRole('button',{name:'Edit',exact:true}).click();
  await expect(page.getByLabel('View name')).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('checkbox',{name:'Use current filters and scope'})).toBeFocused();
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await dialog.getByRole('button',{name:'Back to saved views',exact:true}).click();
  await dialog.getByRole('button',{name:'Remove',exact:true}).click();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Session comparison',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Remove',exact:true}).click();await dialog.getByRole('button',{name:'Remove view',exact:true}).click();
  await expect(dialog).toContainText('No saved views yet.');await dialog.getByRole('button',{name:'Close',exact:true}).click();
  expect((await ws.read()).book.entries).toHaveLength(7);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(vault);await rm(root,{recursive:true,force:true});}
});

test('missing lab books require explicit rebinding; concurrent view edits keep the unsaved form',async({page})=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-view-scope-')),book=upgradeNotebook(queryFixture());
 const {workspace:ws,vault,deviceStore}=await encryptedFixture(root,book);
 const app=await testServer({root:ws.root,deviceStore,port:0,headless:true}),store=new RecordViews(ws),dialog=page.locator('#dialog');
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/notebooks/'+id,book.notebooks.at(-1).id);
  await page.getByRole('button',{name:'Saved views',exact:true}).click();await dialog.getByRole('button',{name:'Save current view',exact:true}).click();await page.getByLabel('View name').fill('Other team');await dialog.getByRole('button',{name:'Save view',exact:true}).click();await dialog.getByRole('button',{name:'Close',exact:true}).click();
  const snapshot=await ws.read(),removed=snapshot.book.notebooks.pop();snapshot.book.entries=snapshot.book.entries.filter(e=>e.notebookId!==removed.id);await ws.save(snapshot.book,snapshot.etag);
  await page.evaluate(()=>location.hash='#/records');await expect(page.getByRole('heading',{name:'All records',exact:true})).toBeVisible();await page.reload();await page.getByRole('button',{name:'Saved views',exact:true}).click();
  await expect(dialog).toContainText('lab book is no longer available');await expect(dialog.getByRole('button',{name:'Open',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('checkbox',{name:'Use current filters and scope'}).check();await dialog.getByRole('button',{name:'Save view',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Open',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('View name').fill('My rename');
  const [saved]= (await store.list({workspaceId:book.id})).views;const {revision,...value}=saved;
  await store.save({workspaceId:book.id,expectedRevision:revision,view:{...value,name:'Other window rename'}});
  await dialog.getByRole('button',{name:'Save view',exact:true}).click();
  await expect(page.locator('#notice')).toContainText('changed in another window');await expect(page.getByLabel('View name')).toHaveValue('My rename');
  await dialog.getByRole('button',{name:'Back to saved views',exact:true}).click();await page.locator('#leave-dialog').getByRole('button',{name:'Discard changes'}).click();
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Saved views',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Other window rename',exact:true})).toBeVisible();
 }finally{await app.close();clearVault(vault);await rm(root,{recursive:true,force:true});}
});
