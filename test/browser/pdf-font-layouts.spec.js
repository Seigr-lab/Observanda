import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {WorkspaceFonts} from '../../src/workspace-fonts.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {PdfDocumentStore} from '../../src/pdf-document-store.js';
import {readPdfDocumentFont} from '../../src/pdf-document-fonts.js';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
import {navigate} from './preferences-helper.js';

test('custom-font layouts remain reusable after the source font is removed and preserve numbered contents',async({page})=>{
 test.setTimeout(120000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-pdf-layout-font-')),f=await encryptedFixture(directory,sampleNotebook()),font=await new WorkspaceFonts(f.workspace).import(await readFile(new URL('../../src/fonts/atkinson.ttf',import.meta.url)),{embed:true}),workspaceId=(await f.workspace.outline()).metadata.id,documents=new PdfDocuments(f.workspace,workspaceId),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.locator('[data-command="new"]').click();await expect(page).toHaveURL(/#\/modules\/pdf-editor\/[a-f0-9-]{36}$/);const first=new URL(page.url()).hash.split('/').at(-1);
  await ui.getByText('Document layout',{exact:true}).click();await ui.locator('[data-pdf-layout="document"][data-key="font"]').selectOption(font.id);await expect.poll(async()=> (await documents.read('open',{id:first})).header.layout.font).toBe(font.id);
  await ui.locator('[data-pdf-library] summary').click();await ui.locator('[data-pdf-layout-name]').fill('Retained typography');await ui.locator('[data-command="layout-save-document"]').click();await expect(ui.locator('[data-pdf-preset] option:checked')).toHaveText('Retained typography');
  await f.workspace.withLock(async()=>{await f.workspace.writeMetadata('.observanda/fonts/library.json','[]');await f.workspace.removeMetadata('.observanda/fonts/'+font.id+'.json');});
  await ui.locator('[data-command="list"]').click();await ui.locator('[data-command="new"]').click();await expect(page).toHaveURL(/#\/modules\/pdf-editor\/[a-f0-9-]{36}$/);await expect.poll(()=>new URL(page.url()).hash.split('/').at(-1)).not.toBe(first);const second=new URL(page.url()).hash.split('/').at(-1);
  await ui.locator('[data-pdf-library] summary').click();await ui.locator('[data-pdf-preset]').selectOption({label:'Retained typography'});await ui.locator('[data-command="layout-apply-document"]').click();await expect.poll(async()=> (await documents.read('open',{id:second})).header.layout.font).toBe(font.id);
  await ui.getByLabel('Section title',{exact:true}).fill('Retained observation');await ui.locator('[data-pdf-structure="contents"]').evaluate(el=>el.closest('details').open=true);await ui.locator('[data-pdf-structure="contents"]').check();await ui.locator('[data-pdf-structure="numberSections"]').check();await ui.locator('[data-pdf-section="level"]').selectOption('2');await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');
  await page.reload();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue('Retained observation');const saved=await documents.read('open',{id:second});expect(saved.header.fonts).toHaveLength(1);
  const compiled=await documents.domains.run(['pdf'],async get=>{const store=get('pdf'),owner=new PdfDocumentStore(store),fonts=new Map();for(const pin of saved.header.fonts)fonts.set(pin.id,await readPdfDocumentFont(store,second,pin));return embedPdfFonts(await compilePdfDocument(saved.header,owner.content(second,saved.revision)),{customFonts:fonts});});
  expect(compiled.html.includes('1.1 Retained observation')).toBe(true);expect(compiled.html.includes('class="pdf-contents ')).toBe(true);expect(compiled.html.includes('data:font/')).toBe(true);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
