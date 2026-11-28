import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {newRecordOpened,openRecordWriting} from './record-editing-helper.js';

test('Find anything reaches settings, records and tools by name from the keyboard or the title bar',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);await page.setViewportSize({width:1440,height:900});
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-find-')),f=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'});
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
 try{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible({timeout:60000});
  const dialog=page.getByRole('dialog',{name:'Find anything',exact:true}),field=dialog.getByRole('combobox',{name:'Find anything',exact:true});
  const options=dialog.getByRole('option');
  // Ctrl+K opens it with the search field ready.
  await page.keyboard.press('Control+k');await expect(dialog).toBeVisible();await expect(field).toBeFocused();
  await expect(dialog.getByRole('status')).toHaveText('Type to search places, settings, tools and records.');
  // A settings category, chosen with the arrow keys and Enter.
  await field.fill('agen');await expect(options).toHaveText(['Agents']);
  await page.keyboard.press('ArrowDown');await expect(field).toHaveAttribute('aria-activedescendant','find-anything-option-0');
  await expect(options.first()).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('Enter');await expect(dialog).toBeHidden();await expect(page).toHaveURL(/#\/preferences\/agents$/);
  // The title-bar button opens the same search; a record is found by its title and opens.
  const button=page.getByRole('button',{name:'Find anything',exact:true});await expect(button).toHaveAttribute('aria-keyshortcuts','Control+K');
  await button.click();await expect(field).toBeFocused();
  await field.fill('seed unfold');await expect(options.filter({hasText:'Watching a seed unfold'})).toHaveCount(1);await expect(dialog.getByRole('status')).toHaveText(/1 result/);
  await page.keyboard.press('Enter');await expect(page.getByRole('heading',{level:1,name:'Watching a seed unfold',exact:true})).toBeVisible();  // A tool that is turned off is found too, and opens Tools at that tool without turning it on.
  await page.keyboard.press('Control+k');await field.fill('calculator');
  const calculator=options.filter({hasText:'Scientific calculator'});await expect(calculator).toContainText('Enable it in Tools');
  await calculator.click();await expect(page).toHaveURL(/#\/tools$/);  await expect(page.locator('[data-tool-card]:not([hidden])')).toHaveCount(1);await expect(page.locator('[data-tool-card]:not([hidden]) h2')).toHaveText('Scientific calculator');
  // Nothing matching says so; Escape closes and returns to the button that opened it.
  await button.click();await field.fill('no such place zq');await expect(dialog.getByRole('status')).toHaveText('Nothing matches “no such place zq”.');
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(button).toBeFocused();
  // In text being written, Ctrl+K keeps its meaning of adding a link; the search does not open.
  await page.locator('#main-navigation .notebook-link').first().click();await page.locator('main').getByRole('button',{name:'New record',exact:true}).click();
  await page.locator('dialog[open] button').filter({hasText:/^Observation/}).click();
  // The new record opens on the record page; its text is written in the writing dialog.
  await newRecordOpened(page);const text=(await openRecordWriting(page)).locator('.ProseMirror');await text.click();
  await page.keyboard.press('Control+k');await expect(page.locator('dialog.rich-link-panel[open]')).toBeVisible();await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
});
