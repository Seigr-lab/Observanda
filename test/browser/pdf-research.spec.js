import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {MediaStore} from '../../src/media.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {navigate} from './preferences-helper.js';

test('PDF author selects private research, reviews updates, preserves local editions and checks printable layout',async({page,browser})=>{
 test.setTimeout(120000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-pdf-sources-')),book=sampleNotebook();book.title='workspace';const original=book.entries[0],part={id:randomUUID(),title:'Selected observation',body:'Original exact value 9007199254740993.'};original.share=false;original.sections=[part];
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore}),workspaceId=(await f.workspace.outline()).metadata.id,d=new PdfDocuments(f.workspace,workspaceId),errors=[];
 const uninstall=installPdfRenderer(async input=>{const view=await browser.newPage();try{await view.emulateMedia({media:'print'});await view.setContent(input.html);const preflight=await view.evaluate(measurePdfPreflight);return {preflight,bytes:input.preflightOnly||preflight.status==='fatal'?null:await view.pdf({preferCSSPageSize:true,printBackground:true})};}finally{await view.close();}});page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name:'New document',exact:true}).click();await expect(page).toHaveURL(/#\/modules\/pdf-editor\/[a-f0-9-]{36}$/);const id=new URL(page.url()).hash.split('/').at(-1);
  await ui.getByRole('button',{name:'Add research',exact:true}).click();await ui.getByRole('button',{name:'Content in this workspace or project',exact:true}).click();await ui.getByLabel('Search record titles').fill(original.title);await ui.getByRole('button',{name:'Search',exact:true}).click();await ui.locator('.pdf-source-list').getByRole('button',{name:original.title,exact:true}).click();await ui.getByRole('button',{name:part.title,exact:true}).click();await expect(ui.locator('.pdf-source-preview')).toContainText('9007199254740993');await ui.getByRole('button',{name:'Insert selected content',exact:true}).click();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue(part.title);await expect(ui.getByRole('textbox',{name:'Content',exact:true})).toHaveText(part.body);
  const items=await d.read('sections',{id}),sectionId=items.items.at(-1).id,edition=(await d.read('open',{id})).revision;await ui.getByRole('textbox',{name:'Content',exact:true}).fill('Local report wording');await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');
  const record=await f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),original.id);return store.record(row.id,row.revision);}),expectedRevision=recordRevision(record);record.sections[0].body='New source wording';await new ResearchRecords(f.workspace,new MediaStore(f.workspace)).save({workspaceId,changes:[{id:record.id,expectedRevision,record}]});
  await ui.getByRole('button',{name:'Review source update',exact:true}).click();await expect(ui.locator('.pdf-source-diff')).toContainText('Local report wording');await expect(ui.locator('.pdf-source-diff')).toContainText('New source wording');await ui.getByRole('button',{name:'Keep document unchanged',exact:true}).click();await expect(ui.getByRole('textbox',{name:'Content',exact:true})).toHaveText('Local report wording');
  await ui.getByRole('button',{name:'Review source update',exact:true}).click();await ui.getByRole('button',{name:'Accept source update',exact:true}).click();await expect(ui.getByRole('textbox',{name:'Content',exact:true})).toHaveText('New source wording');expect((await d.read('section',{id,sectionId,revision:edition})).section.content).toBe(part.body);
  await ui.getByRole('button',{name:'Check PDF layout',exact:true}).click();await expect(ui.locator('[data-pdf-preflight]')).toContainText('No layout problems were detected.');
  await page.reload();await ui.getByRole('navigation',{name:'Sections'}).getByRole('button',{name:part.title,exact:true}).click();await expect(ui.getByRole('textbox',{name:'Content',exact:true})).toHaveText('New source wording');expect(errors).toEqual([]);
 }finally{await app.close();uninstall();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
