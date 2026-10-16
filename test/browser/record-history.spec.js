import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {sampleNotebook} from '../../src/sample.js';
import {testServer} from '../device-fixture.js';
import {ResearchMaterials} from '../../src/research-materials.js';

test('navigation has one project tree; history belongs only to the open record and safely restores it',async({page})=>{
 test.setTimeout(60000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-history-ui-')),book=sampleNotebook(),id=book.entries[0].id,other=book.entries[1].id;
 book.entries[0].title='Initial listening session';book.entries[0].body='Original listening conditions.\n\n'+Array.from({length:50},(_,i)=>'Listening note '+i+'. The room and the instrument are documented separately.').join('\n\n');
 const {workspace:ws,vault,deviceStore}=await encryptedFixture(directory,book);
 let saved=await ws.read();saved.book.entries[0].title='Revised listening session';saved.book.entries[0].body='New interpretation';saved=await ws.save(saved.book,saved.etag);
 saved.book.entries[1].title='Another record stays current';await ws.save(saved.book,saved.etag);
 const app=await testServer({root:ws.root,deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const nav=page.locator('#main-navigation'),dialog=page.locator('#dialog');
 try{
  await page.goto(app.url);await expect(nav).toBeVisible();
  await expect(nav.getByRole('button',{name:'Projects',exact:true})).toHaveCount(1);
  await expect(nav.getByRole('button',{name:'All records',exact:true})).toHaveCount(0);
  await expect(nav.getByText('Lab books',{exact:true})).toHaveCount(0);
  await expect(nav.locator('[data-action="history"],[data-action^="record-history-"]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'History',exact:true})).toHaveCount(0);
  await nav.getByRole('button',{name:'Projects',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/projects$/);
  await nav.getByRole('button',{name:'Preferences',exact:true}).click();
  await expect(page.getByRole('button',{name:/^(History|Version history|Restore)$/})).toHaveCount(0);
  await page.evaluate(id=>location.hash='#/records/'+id,id);
  await page.getByRole('button',{name:'History',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Record history',exact:true})).toBeVisible();
  await expect(dialog.locator('.record-history-list li')).toHaveCount(2);
  await expect(dialog).not.toContainText('Another record stays current');
  await dialog.getByRole('button',{name:'Review version',exact:true}).click();
  await expect(dialog).toContainText('Original listening conditions.');
  await dialog.getByText('Compare with current saved version',{exact:true}).click();
  await expect(dialog).toContainText('New interpretation');
  await page.setViewportSize({width:390,height:844});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await expect(dialog.getByRole('button',{name:'Close',exact:true})).toBeInViewport({ratio:1});
  expect(await dialog.evaluate(el=>{
   const edge=el.getBoundingClientRect(),actions=el.querySelector('.dialog-actions').getBoundingClientRect();
   return actions.top>=edge.top&&actions.bottom<=edge.bottom;
  })).toBe(true);
  await page.setViewportSize({width:720,height:900});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await expect(dialog.getByRole('button',{name:'Close',exact:true})).toBeInViewport({ratio:1});
  await page.evaluate(()=>document.documentElement.style.fontSize='');await page.setViewportSize({width:1440,height:1000});
  await dialog.getByRole('button',{name:'Restore this version',exact:true}).click();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  expect((await ws.read()).book.entries[0].title).toBe('Revised listening session');
  await dialog.getByRole('button',{name:'Restore this version',exact:true}).click();
  await dialog.getByRole('button',{name:'Restore record',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Initial listening session');
  const restored=(await ws.read()).book;expect(restored.entries.find(e=>e.id===other).title).toBe('Another record stays current');expect(restored.entries[0].share).toBe(false);
  await page.getByRole('button',{name:'History',exact:true}).click();
  await expect(dialog.locator('.record-history-list li')).toHaveCount(3);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  // Unsaved edits must never be silently discarded by opening history.
  await page.getByLabel('Record title',{exact:true}).fill('Keep this draft');
  await page.getByRole('button',{name:'History',exact:true}).click();
  await expect(page.locator('#leave-dialog')).toBeVisible();
  await page.locator('#leave-dialog').getByRole('button',{name:'Stay here',exact:true}).click();
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Keep this draft');
  await page.getByRole('button',{name:'History',exact:true}).click();
  await page.locator('#leave-dialog').getByRole('button',{name:'Discard changes',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Record history',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Review version',exact:true}).first().click();
  // A later save of this record is rejected instead of overwritten.
  let latest=await ws.read();latest.book.entries[0].title='Concurrent saved title';latest=await ws.save(latest.book,latest.etag);
  await dialog.getByRole('button',{name:'Restore this version',exact:true}).click();
  await dialog.getByRole('button',{name:'Restore record',exact:true}).click();
  await expect(page.locator('#notice')).toContainText('changed in another window');
  expect((await ws.read()).etag).toBe(latest.etag);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await nav.getByRole('button',{name:'Dashboard',exact:true}).click();
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true});}
});

test('retained history pages keep navigation and selected reference inspection through a failed request',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-retained-history-ui-')),book=sampleNotebook(),{workspace:ws,vault,deviceStore}=await encryptedFixture(directory,book),record=(await ws.read()).book.entries[0],materials=new ResearchMaterials(ws);
 await ws.withLock(async()=>{for(let i=0;i<51;i++)await materials.retainRecord({...record,title:'Retained method '+i,body:'Exact original method '+i});});
 const app=await testServer({root:ws.root,deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await expect(page.locator('#main-navigation')).toBeVisible();await page.evaluate(id=>location.hash='#/records/'+id,record.id);await page.getByRole('button',{name:'History',exact:true}).click();
  const dialog=page.locator('#dialog'),items=dialog.locator('.record-history-list li');await expect(items).toHaveCount(20);
  await expect(dialog).toContainText('Versions 1–20. More retained references remain to be checked.');await expect(dialog).not.toContainText('No earlier versions yet.');
  let fail=true;await page.route('**/api/research/records/history/list',route=>fail?(fail=false,route.abort('failed')):route.continue());
  const previous=await items.allTextContents();await dialog.getByRole('button',{name:'Older versions',exact:true}).click();
  await expect(page.locator('#notice')).toBeVisible();expect(await items.allTextContents()).toEqual(previous);await expect(dialog.getByRole('button',{name:'Newer versions',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'Older versions',exact:true}).click();await expect(dialog).toContainText('Versions 21–40.');
  await dialog.getByRole('button',{name:'Older versions',exact:true}).click();await expect(items).toHaveCount(12);await expect(dialog).toContainText('Versions 41–52 of 52');
  await expect(dialog.getByRole('button',{name:'Older versions',exact:true})).toBeDisabled();const title=await items.last().locator('strong').textContent();
  await items.last().getByRole('button',{name:'Review version',exact:true}).click();await expect(dialog).toContainText('Exact original method '+title.match(/Retained method (\d+)/)[1]);
  await dialog.getByRole('button',{name:'Back to history',exact:true}).click();await expect(dialog).toContainText('Versions 41–52 of 52');
  await dialog.getByRole('button',{name:'Newer versions',exact:true}).click();await expect(dialog).toContainText('Versions 21–40.');
  await ws.withLock(()=>materials.retainRecord({...record,title:'New reference during review'}));
  await dialog.getByRole('button',{name:'Older versions',exact:true}).click();await expect(page.locator('#notice')).toContainText('history');await expect(dialog).toContainText('Versions 21–40.');
  await dialog.getByRole('button',{name:'Refresh history',exact:true}).click();await expect(dialog).toContainText('Versions 1–20.');await expect(dialog.getByRole('button',{name:'Newer versions',exact:true})).toBeDisabled();
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true});}
});

test('duplicate-only history windows continue and finish without hiding saved revisions',async({page})=>{
 test.setTimeout(150000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-sparse-history-ui-')),book=sampleNotebook(),{workspace:ws,vault,deviceStore}=await encryptedFixture(directory,book),materials=new ResearchMaterials(ws),versions=[];
 let saved=await ws.read();versions.push(saved.book.entries[0]);
 for(let i=1;i<260;i++){const next=structuredClone(saved.book);next.entries[0].title='Saved revision '+i;saved=await ws.save(next,saved.etag);versions.push(saved.book.entries[0]);}
 await ws.withLock(async()=>{for(const record of versions)await materials.retainRecord(record);});
 const app=await testServer({root:ws.root,deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 try{
  await page.goto(app.url);await expect(page.locator('#main-navigation')).toBeVisible();await page.evaluate(id=>location.hash='#/records/'+id,versions[0].id);await page.getByRole('button',{name:'History',exact:true}).click();
  const dialog=page.locator('#dialog'),items=dialog.locator('.record-history-list li');
  for(let i=0;i<13;i++){
   await expect(items).toHaveCount(20);await expect(dialog).toContainText('Versions '+(i*20+1)+'–'+(i*20+20)+'.');
   await dialog.getByRole('button',{name:'Older versions',exact:true}).click();
  }
  await expect(items).toHaveCount(0);await expect(dialog).toContainText('These references point to versions already shown.');await expect(dialog.getByRole('button',{name:'Continue history',exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:'Continue history',exact:true}).click();await expect(dialog).toContainText('All 260 distinct versions have been listed.');await expect(dialog.getByRole('button',{name:'Continue history',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'Newer versions',exact:true}).click();await expect(dialog).toContainText('These references point to versions already shown.');
  await dialog.getByRole('button',{name:'Newer versions',exact:true}).click();await expect(items).toHaveCount(20);await expect(dialog).toContainText('Versions 241–260.');
  await items.last().getByRole('button',{name:'Review version',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Review record version',exact:true})).toBeVisible();await expect(dialog).toContainText(versions[0].title);
 }finally{await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true});}
});
