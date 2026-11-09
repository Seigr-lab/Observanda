import {test,expect} from './document-editor-fixture.js';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {RecordWriting} from '../../src/record-writing.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {AppError} from '../../src/errors.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test.use({sourceEditor:true});
test('write across a paged outline, follow a research link, retain a draft and resume after a restart',async({page})=>{
 test.setTimeout(180000);
 page.setDefaultTimeout(12000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-focused-writing-'));
 const book=sampleNotebook(),[record,reference]=book.entries;
 const href='observanda://'+book.id+'/record/'+reference.id;
 record.body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Field reference',marks:[{type:'link',attrs:{href,title:'',target:'_self',nofollow:false}}]}]}]};
 record.sections=Array.from({length:129},(_,i)=>({id:randomUUID(),title:'Station '+(i+1),body:'Reading '+(i+1)}));
 const section=record.sections[16],target={workspaceId:book.id,recordId:record.id};
 let storage,app;const originRead=ResearchCatalogue.prototype.record;
 try{
  storage=await encryptedFixture(directory,book);
  const options={root:storage.workspace.root,deviceStore:storage.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')};
  app=await testServer(options);
  const writing=new RecordWriting(storage.workspace),field={...target,sectionId:section.id};
  const replies=[];page.on('response',response=>{if(response.url().endsWith('/records/writing/outline')&&response.ok())replies.push(response.json());});
  const focus=page.getByRole('button',{name:'Focused writing',exact:true}),dialog=page.locator('dialog.record-writing[open]');
  const nav=dialog.getByRole('navigation',{name:'Writing outline'}),editor=dialog.getByRole('textbox',{name:'Writing',exact:true});
  const save=dialog.getByRole('button',{name:'Save changes',exact:true});
  async function openReader(){await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');}
  await openReader();
  await expect(focus).toBeVisible();await expect(nav).toHaveCount(0);
  ResearchCatalogue.prototype.record=()=>{throw Error('Focused editing reconstructed an entire record');};
  await focus.click();await expect(editor).toHaveText('Field reference');
  await nav.getByRole('button',{name:'Next sections'}).click();await nav.getByRole('button',{name:'Station 17',exact:true}).click();
  await expect(editor).toHaveText('Reading 17');await editor.press('End');await page.keyboard.insertText(' observed');
  await nav.getByRole('button',{name:'Station 18',exact:true}).click();await expect(editor).toHaveText('Reading 18');
  expect((await writing.read(field)).value.body).toBe('Reading 17');
  await nav.getByRole('button',{name:'Station 17',exact:true}).click();await expect(editor).toHaveText('Reading 17 observed');
  await editor.press('Control+z');await expect(editor).toHaveText('Reading 17');await editor.press('Control+Shift+z');await expect(editor).toHaveText('Reading 17 observed');
  const originalSave=RecordWriting.prototype.save;RecordWriting.prototype.save=async()=>{throw new AppError('IO');};
  try{await save.click();await expect(dialog.locator('[data-writing-error]')).not.toBeEmpty();await expect(editor).toHaveText('Reading 17 observed');}
  finally{RecordWriting.prototype.save=originalSave;}
  const other=await writing.read(field);await writing.save({...field,expectedRevision:other.revision,value:{...other.value,body:'Concurrent note'}});
  await save.click();await expect(dialog.locator('.record-writing-conflict')).toContainText('Concurrent note');
  await dialog.getByRole('button',{name:'Keep my edit after review'}).click();await save.click();await expect(save).toBeDisabled();
  await expect(dialog.locator('[data-writing-status]')).toHaveText('Writing saved.');
  expect((await writing.read(field)).value.body.content[0].content[0].text).toBe('Reading 17 observed');
  await nav.getByRole('button',{name:'Summary',exact:true}).click();await editor.getByText('Field reference').click();
  await dialog.locator('.record-link-inspector button').click();await expect(dialog).toHaveCount(0);await expect(page).toHaveURL(new RegExp(reference.id));
  await page.goBack();await focus.click();await expect(editor).toHaveText('Field reference');
  await nav.getByRole('button',{name:'Station 1',exact:true}).click();await expect(editor).toHaveText('Reading 1');await editor.fill('Exact draft at restart.');
  await dialog.getByRole('button',{name:'Keep recovery checkpoint and close'}).click();await expect(dialog).toHaveCount(0);
  await page.goto('about:blank');await app.close();app=await testServer(options);await openReader();
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('button',{name:'Review draft',exact:true}).click();
  await expect(editor).toHaveText('Exact draft at restart.');await save.click();await expect(dialog).toHaveCount(0);
  expect((await writing.read({...target,sectionId:record.sections[0].id})).value.body.content[0].content[0].text).toBe('Exact draft at restart.');
  for(const reply of await Promise.all(replies)){expect(reply.sections.length).toBeLessThanOrEqual(16);expect(reply.total).toBe(129);for(const item of reply.sections)expect(Object.keys(item).sort()).toEqual(['id','position','title']);}
  expect(replies.length).toBeGreaterThanOrEqual(3);
 }finally{ResearchCatalogue.prototype.record=originRead;await app?.close();if(storage)await clearVault(storage.vault);await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
