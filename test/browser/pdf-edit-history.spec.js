import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {navigate} from './preferences-helper.js';

test('saved PDF changes undo and redo across layout, sections and history without overwriting another writer',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(15000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-undo-')),fixture=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),errors=[];
 const app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore}),documents=new PdfDocuments(fixture.workspace,(await fixture.workspace.outline()).metadata.id);
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]'),undo=ui.getByRole('button',{name:'Undo document change',exact:true}),redo=ui.getByRole('button',{name:'Redo document change',exact:true}),title=ui.getByLabel('Section title',{exact:true}),content=ui.getByRole('textbox',{name:'Content',exact:true});
  async function saved(){await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');await expect(ui).toHaveAttribute('aria-busy','false');}
  async function details(name){const node=ui.locator('summary').filter({hasText:new RegExp('^'+name+'$')});if(!await node.evaluate(node=>node.parentElement.open))await node.click();}
  async function move(direction){await (direction==='undo'?undo:redo).click();await saved();}
  await ui.locator('[data-command="new"]').click();await expect(ui.getByRole('heading',{name:'New document',exact:true})).toBeVisible();await saved();await expect(undo).toBeDisabled();const id=new URL(page.url()).hash.split('/').at(-1);
  await details('Document');await ui.getByLabel('Document name',{exact:true}).fill('Reversible report');await title.fill('Original section');await content.fill('Retained original content.');await saved();const baseline=await documents.read('open',{id}),first=(await documents.read('sections',{id})).items[0].id;
  await details('Document layout');await ui.getByLabel('Page width (mm)',{exact:true}).fill('180');await saved();const layout=await documents.read('open',{id});
  // The immediate Undo must flush this pending save before selecting its inverse.
  await title.fill('Revised section');await move('undo');await expect(title).toHaveValue('Original section');expect((await documents.read('open',{id})).revision).toBe(layout.revision);
  await move('redo');await expect(title).toHaveValue('Revised section');
  // Keyboard shortcuts outside text controls operate on saved document revisions.
  await undo.focus();await page.keyboard.press('Control+z');await saved();await expect(title).toHaveValue('Original section');await redo.focus();await page.keyboard.press('Control+Shift+z');await saved();await expect(title).toHaveValue('Revised section');
  await move('undo');await move('undo');expect((await documents.read('open',{id})).header.layout.widthMm).toBe(baseline.header.layout.widthMm);await move('redo');await move('redo');expect((await documents.read('open',{id})).header.layout.widthMm).toBe(180);
  await ui.locator('[data-command="append"]').click();await saved();await expect(title).toHaveValue('');await move('undo');expect((await documents.read('open',{id})).count).toBe(1);await move('redo');expect((await documents.read('open',{id})).count).toBe(2);
  const second=(await documents.read('sections',{id})).items.find(row=>row.id!==first).id;await ui.locator('[data-command="section"][data-id="'+second+'"]').click();await expect(title).toHaveValue('');await saved();await title.fill('Second section');await saved();expect((await documents.read('section',{id,sectionId:second})).section.title).toBe('Second section');await ui.locator('[data-command="remove-section"]').click();await saved();expect((await documents.read('open',{id})).count).toBe(1);await move('undo');await expect(ui.getByRole('navigation',{name:'Sections',exact:true}).getByRole('button',{name:'Second section',exact:true})).toBeVisible();await move('redo');expect((await documents.read('open',{id})).count).toBe(1);
  const beforeRestore=await documents.read('open',{id});await ui.locator('[data-command="history"]').click();await ui.locator('[data-command="restore"][data-revision="'+baseline.revision+'"]').first().click();await saved();await expect(title).toHaveValue('Original section');await move('undo');expect((await documents.read('open',{id})).revision).toBe(beforeRestore.revision);
  expect((await documents.read('open',{id,revision:baseline.revision})).header).toEqual(baseline.header);expect((await documents.read('history',{id})).items.some(item=>item.revision===baseline.revision)).toBe(true);
  await page.reload();await expect(ui.getByRole('heading',{name:'Reversible report',exact:true})).toBeVisible();await saved();await expect(undo).toBeDisabled();await expect(redo).toBeDisabled();
  await details('Document layout');await ui.getByLabel('Page width (mm)',{exact:true}).fill('190');await saved();const local=await documents.read('open',{id}),foreign=await documents.change({id,commandId:randomUUID(),expectedRevision:local.revision,operation:{type:'header',header:{...local.header,name:'Concurrent writer edition'}}});
  const conflict=page.waitForResponse(response=>response.url().endsWith('/api/pdf/change')&&response.status()===409);await undo.click();await conflict;await expect(ui).toHaveAttribute('aria-busy','false');expect((await documents.read('open',{id})).revision).toBe(foreign.revision);await expect(ui.getByRole('heading',{name:'Reversible report',exact:true})).toBeVisible();await expect(ui.getByLabel('Page width (mm)',{exact:true})).toHaveValue('190');await expect(undo).toBeEnabled();await expect(redo).toBeDisabled();
  await ui.locator('[data-command="list"]').click();await ui.locator('[data-command="new"]').click();await expect(ui.getByRole('heading',{name:'New document',exact:true})).toBeVisible();await saved();await expect(undo).toBeDisabled();await ui.locator('[data-command="list"]').click();await ui.getByRole('button',{name:'Concurrent writer edition',exact:true}).click();await expect(ui.getByRole('heading',{name:'Concurrent writer edition',exact:true})).toBeVisible();await expect(undo).toBeDisabled();expect(errors).toEqual([]);
 }finally{await app.close();clearVault(fixture.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-undo-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
