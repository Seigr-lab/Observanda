import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';

test('skip navigation and selected writing saves retain a useful keyboard destination',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-focus-')),book=sampleNotebook();let releaseRecord=()=>{};
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 try{
  await page.goto(app.url);await expect(page.locator('main h1')).toHaveText('Dashboard');
  await page.locator('main').getByRole('button',{name:'All records',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(page.locator('main h1')).toHaveText('All records');await expect(page.locator('main h1')).toBeFocused();
  const route=page.url();await page.locator('.skip-link').focus();await page.keyboard.press('Enter');
  await expect(page).toHaveURL(route);await expect(page.locator('main h1')).toBeFocused();await expect(page).toHaveTitle('All records · Observanda');
  const held=new Promise(resolve=>releaseRecord=resolve);await page.route('**/api/workspace/read/record-content',async route=>{const response=await route.fetch();await held;await route.fulfill({response});},{times:1});
  await page.goto(app.origin+'/#/records/'+book.entries[0].id);const actions=page.locator('details[data-disclosure=record-actions]');await actions.locator(':scope > summary').click();releaseRecord();await expect(page.locator('.record-editing h1')).toHaveText(book.entries[0].title);await expect(actions).toHaveAttribute('open','');await expect(actions.locator(':scope > summary')).toBeFocused();
  await page.getByRole('button',{name:'Evidence and results',exact:true}).click();
  await expect(page.locator('[data-disclosure="record-evidence"]')).toHaveAttribute('open','');
  const edit=page.getByRole('button',{name:'Edit summary / context',exact:true});
  await edit.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:'Edit summary / context',exact:true});
  await dialog.locator('.ProseMirror').fill('Writing saved without losing the keyboard position.');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(dialog).not.toBeVisible();await expect(edit).toBeFocused();
  await expect(page.locator('[data-disclosure="record-evidence"]')).toHaveAttribute('open','');
  await page.keyboard.press('Enter');await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(edit).toBeFocused();
  await page.locator('#main-navigation [data-action="preferences"]').focus();await page.keyboard.press('Enter');
  await expect(page.locator('#main-navigation [data-action="preferences"]')).toBeFocused();
 }finally{
  releaseRecord();await app.close();clearVault(f.vault);
  if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-focus-'))throw Error('Unexpected cleanup directory');
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});

test('website palettes leave app controls readable and app theme preferences survive reload',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-focus-')),book=sampleNotebook();
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/preferences/appearance');
  await page.getByLabel('Background',{exact:true}).fill('#202020');await page.getByLabel('Surface',{exact:true}).fill('#202020');
  await expect(page.locator('[data-design-contrast]')).toContainText('Increase contrast before publishing');
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--ui-background').trim())).toBe('#f5f6f8');
  await page.getByLabel('Background',{exact:true}).fill(book.appearance.background);await page.getByLabel('Surface',{exact:true}).fill(book.appearance.surface);
  await page.locator('.preferences-tabs [data-action="interface"]').click();
  await page.getByRole('dialog').getByRole('button',{name:'Discard changes',exact:true}).click();
  await page.getByLabel('App theme',{exact:true}).selectOption('studio');
  await page.getByRole('button',{name:'Save app settings',exact:true}).click();await page.reload();
  await expect(page.getByLabel('App theme',{exact:true})).toHaveValue('studio');
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--ui-background').trim())).toBe('#f1f6f4');
 }finally{
  await app.close();clearVault(f.vault);
  if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-focus-'))throw Error('Unexpected cleanup directory');
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
