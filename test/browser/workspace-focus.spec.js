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
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-focus-')),book=sampleNotebook();
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 try{
  await page.goto(app.url);await expect(page.locator('main h1')).toHaveText('Dashboard');
  await page.locator('main').getByRole('button',{name:'All records',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(page.locator('main h1')).toHaveText('All records');await expect(page.locator('main h1')).toBeFocused();
  const route=page.url();await page.locator('.skip-link').focus();await page.keyboard.press('Enter');
  await expect(page).toHaveURL(route);await expect(page.locator('main h1')).toBeFocused();await expect(page).toHaveTitle('All records · Observanda');
  await page.goto(app.origin+'/#/records/'+book.entries[0].id);
  const edit=page.getByRole('button',{name:'Edit summary / context',exact:true});
  await edit.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:'Edit summary / context',exact:true});
  await dialog.locator('.ProseMirror').fill('Writing saved without losing the keyboard position.');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(dialog).not.toBeVisible();await expect(edit).toBeFocused();
  await page.keyboard.press('Enter');await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(edit).toBeFocused();
  await page.locator('#main-navigation [data-action="preferences"]').focus();await page.keyboard.press('Enter');
  await expect(page.locator('#main-navigation [data-action="preferences"]')).toBeFocused();
 }finally{
  await app.close();clearVault(f.vault);
  if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-focus-'))throw Error('Unexpected cleanup directory');
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
