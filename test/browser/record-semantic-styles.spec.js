import {test,expect} from './document-editor-fixture.js';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {RecordWriting} from '../../src/record-writing.js';
import {withRecordDocument} from '../../src/record-document.js';
import {changedRecordFields} from '../../src/record-document-comparison.js';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {randomUUID} from 'node:crypto';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';

test.use({sourceEditor:true});
test('an author changes a named style, sees both uses and clears one local exception',async({page,browser})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-style-'));let storage,app;
 try{
  const book=upgradeNotebook(sampleNotebook()),entry=book.entries[2];
  Object.assign(entry,{body:'First note\n\nSecond note',relations:[],sections:[],figures:[],attachments:[]});
  book.entries=[entry];storage=await encryptedFixture(directory,book);
  app=await testServer({root:storage.workspace.root,deviceStore:storage.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,entry.id);
  const open=page.getByRole('button',{name:'Edit summary / context',exact:true});
  const dialog=page.locator('dialog.record-writing[open]'),editor=dialog.getByRole('textbox',{name:'Writing',exact:true});
  const writing=new RecordWriting(storage.workspace),target={workspaceId:book.id,recordId:entry.id,sectionId:null},before=await writing.read(target);
  await open.click();await expect(editor).toHaveText('First noteSecond note');
  await editor.press('ControlOrMeta+a');await dialog.getByText('Named text styles',{exact:true}).click();
  await dialog.getByRole('combobox',{name:'Text role',exact:true}).selectOption('note');
  await dialog.getByRole('button',{name:'Apply to selection'}).click();
  const notes=editor.locator('p[data-obs-role="note"]');await expect(notes).toHaveCount(2);
  await dialog.getByText('Style appearance',{exact:true}).click();
  await dialog.getByLabel('Text size (px)',{exact:true}).fill('23');
  await dialog.getByRole('button',{name:'Update all uses'}).click();
  await expect(notes.first()).toHaveCSS('font-size','23px');await expect(notes.last()).toHaveCSS('font-size','23px');
  await notes.last().click();await editor.press('Home');await editor.press('Shift+End');
  await dialog.getByText('More formatting',{exact:true}).click();
  await dialog.getByRole('combobox',{name:'Selected text size'}).selectOption('31');
  await expect(notes.last().locator('.rt-size-31')).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Clear local formatting'})).toBeEnabled();
  await dialog.getByRole('button',{name:'Clear local formatting'}).click();
  await expect(notes.last().locator('.rt-size-31')).toHaveCount(0);
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  const saved=await writing.read(target);
  expect(saved.value.body.attrs.semanticStyles.roles.note.default.size).toBe(23);
  await storage.workspace.catalogue(store=>withRecordDocument(store,entry.id,before.storageRevision,earlier=>
   withRecordDocument(store,entry.id,saved.storageRevision,async latest=>{
    expect(await changedRecordFields(earlier,latest,['body','sections'])).toEqual(['body']);
    expect((await earlier.field(['body'])).value).toBe('First note\n\nSecond note');
    expect((await latest.field(['body'])).value).toEqual(saved.value.body);
   })));
  await open.click();await expect(editor.locator('[data-obs-role="note"]').last()).toHaveCSS('font-size','23px');
  // A private clipboard exercises the real copy and paste handlers without
  // writing to the desktop user's system clipboard.
  await editor.press('ControlOrMeta+a');
  const clipboard=await editor.evaluate(el=>{
   const data=new DataTransfer();el.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));
   return {html:data.getData('text/html'),text:data.getData('text/plain')};
  });
  expect(clipboard.html).toContain('data-obs-role="note"');
  await editor.press('ControlOrMeta+End');await editor.press('Enter');
  await editor.evaluate((el,{text,html})=>{
   const data=new DataTransfer();data.setData('text/html',html);data.setData('text/plain',text);
   el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  },clipboard);
  await expect(editor.locator('[data-obs-role="note"]').filter({hasText:'Second note'})).toHaveCount(2);
  const header={version:1,id:randomUUID(),name:'Field notes',language:'en',direction:'ltr',layout:pdfLayoutPreset()};
  const print=await compilePdfDocument(header,[{id:randomUUID(),title:'Observations',layout:null,start:null,content:saved.value.body}]);
  const reader=await browser.newPage();
  try{
   await reader.route('**/*',route=>route.abort());await reader.setContent(print.html);
   const task=getDocument({data:new Uint8Array(await reader.pdf({tagged:true,preferCSSPageSize:true})),useSystemFonts:false}),pdf=await task.promise;
   try{
    const text=await (await pdf.getPage(1)).getTextContent();
    for(const label of ['First note','Second note']){
     const item=text.items.find(item=>item.str===label);expect(item).toBeTruthy();expect(item.height).toBeCloseTo(23*72/96,1);
    }
   }finally{await task.destroy();}
  }finally{await reader.close();}
 }finally{await app?.close();if(storage)await clearVault(storage.vault);await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:80});}
});
