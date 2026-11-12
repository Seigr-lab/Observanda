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
import {PdfDocumentStore} from '../../src/pdf-document-store.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {navigate} from './preferences-helper.js';

test('finds and distinguishes same-name documents among hundreds, pins, duplicates, edits and restores from the visible library',async({page})=>{
 test.setTimeout(360000);page.setDefaultTimeout(20000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-library-'));
 const fixture=await encryptedFixture(directory,{...sampleNotebook(),title:'Watershed workspace'}),workspaceId=(await fixture.workspace.outline()).metadata.id;
 const documents=new PdfDocuments(fixture.workspace,workspaceId),targetId=randomUUID(),errors=[];
 const app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore});
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await documents.domains.initialize(['pdf']);
  await documents.domains.run(['pdf'],async get=>{
   const owner=new PdfDocumentStore(get('pdf'));
   for(let i=0;i<301;i++){
    const id=i===210?targetId:randomUUID(),name=i===210||i===42?'Floodplain report':'Study '+String(i).padStart(3,'0');
    const header={version:1,id,name,language:'en',direction:'ltr',layout:pdfLayoutPreset()};
    const section={id:randomUUID(),title:'Station '+i,content:'Measurements from gauge '+i+'.',layout:null,start:null};
    await owner.change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header,section}});
   }
  },{write:['pdf']});
  await page.goto(app.url);await navigate(page,'PDF editor');
  const workspaceTitle=(await page.locator('.workspace-name').innerText()).trim();expect(workspaceTitle).toBeTruthy();
  const ui=page.locator('[data-pdf-editor]'),search=ui.getByRole('searchbox'),sort=ui.getByLabel('Sort by');
  await search.fill('Floodplain');await search.press('Enter');await expect(ui.locator('.pdf-library-row')).toHaveCount(2,{timeout:120000});
  const row=ui.locator('[data-library-item="'+targetId+'"]');await row.getByRole('button',{name:'Details',exact:true}).click();
  await expect(row).toContainText('Measurements from gauge 210.');await expect(row).toContainText(workspaceTitle);await expect(row).toContainText('No PDF exports yet.');
  await row.getByRole('button',{name:'Pin',exact:true}).click();await expect(row.getByRole('button',{name:'Unpin',exact:true})).toBeVisible();
  await sort.selectOption('pinned');await expect(ui.locator('.pdf-library-row')).toHaveCount(1);
  await row.getByRole('button',{name:'Duplicate…',exact:true}).click();await row.getByLabel('Name for the copy').fill('Floodplain copy');await row.getByRole('button',{name:'Create copy'}).click();
  const content=ui.getByRole('textbox',{name:'Content',exact:true});await expect(content).toContainText('Measurements from gauge 210.');
  const copyId=new URL(page.url()).hash.split('/').at(-1);expect(copyId).not.toBe(targetId);
  await content.fill('Independent measurements.');await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');
  await ui.getByRole('button',{name:'History',exact:true}).click();await expect(ui.locator('[data-command="restore"]')).toHaveCount(1);
  await ui.getByRole('button',{name:'Documents',exact:true}).click();await sort.selectOption('recent');await search.fill('Floodplain copy');await search.press('Enter');
  const copy=ui.locator('[data-library-item="'+copyId+'"]');await copy.getByRole('button',{name:'Floodplain copy',exact:true}).click();
  await expect(content).toContainText('Independent measurements.');await ui.getByRole('button',{name:'Archive document',exact:true}).click();
  await ui.getByRole('button',{name:'Archived documents',exact:true}).click();await ui.getByRole('button',{name:'Floodplain copy - Restore document',exact:true}).click();
  await expect(ui.locator('.pdf-library-row')).toHaveCount(0);await ui.getByRole('button',{name:'Active documents',exact:true}).click();
  await expect(ui.getByRole('heading',{name:'PDF documents',exact:true})).toBeVisible();await expect(ui).toHaveAttribute('aria-busy','false');
  await search.fill(targetId);await search.press('Enter');await expect(search).toHaveValue(targetId);await expect(row).toBeVisible();await row.getByRole('button',{name:'Floodplain report',exact:true}).click();await expect(content).toContainText('Measurements from gauge 210.');
  expect((await documents.read('open',{id:targetId})).sequence).toBe(0);expect((await documents.read('open',{id:copyId})).sequence).toBeGreaterThan(1);expect(errors).toEqual([]);
 }finally{
  await app.close();await clearVault(fixture.vault);
  if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-library-'))throw Error('Unexpected test directory');
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
