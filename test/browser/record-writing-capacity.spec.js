import {test,expect} from './document-editor-fixture.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {RecordContent} from '../../src/record-content.js';
import {RecordWriting} from '../../src/record-writing.js';
import {RecordSectionCommands} from '../../src/record-section-commands.js';
import {AppError} from '../../src/errors.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {MaterialUploadChunks} from '../../src/material-upload-chunks.js';
import {richTextAdmission,RICH_TEXT_LIMITS} from '../../src/web/rich-text-model.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';

test.use({sourceEditor:true});

async function withRecord(page,body,run){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-capacity-'));
 let storage,app;
 try{
  const book=upgradeNotebook(sampleNotebook()),entry=book.entries[2];
  Object.assign(entry,{title:'Boundary study',body,relations:[],sections:[],figures:[],attachments:[]});
  book.entries=[entry];storage=await encryptedFixture(directory,book);
  app=await testServer({root:storage.workspace.root,deviceStore:storage.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,entry.id);
  const open=page.getByRole('button',{name:'Edit summary / context',exact:true}),dialog=page.locator('dialog.record-writing[open]');
  await run({workspace:storage.workspace,target:{workspaceId:book.id,recordId:entry.id},open,dialog,editor:dialog.getByRole('textbox',{name:'Writing',exact:true})});
 }finally{await app?.close();if(storage)await clearVault(storage.vault);await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:80});}
}
async function paste(editor,{text='',html=''}){
 await editor.evaluate((el,{text,html})=>{
  const data=new DataTransfer();data.setData('text/plain',text);if(html)data.setData('text/html',html);
  el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
 },{text,html});
}

test('a rejected paste can become private, named, linked sections or an exact retained original',async({page})=>{
 test.setTimeout(150000);
 await withRecord(page,'Accepted field note.',async({workspace,target,open,dialog,editor})=>{
  const history=new RecordContent(workspace),previous=await history.read({...target,header:false});
  await open.click();await expect(editor).toHaveText('Accepted field note.');
  await editor.press('End');await editor.press('!');await expect(editor).toHaveText('Accepted field note.!');
  const link='https://example.org/records/spectrum',sample='x'.repeat(59999)+'𝄞'+'mark of sample',html='<p><a href="'+link+'">'+sample+'</a></p>';
  await paste(editor,{text:sample,html});await expect(editor).toHaveText('Accepted field note.!');
  await dialog.getByRole('button',{name:'Split into private sections'}).click();
  await dialog.getByLabel('Section name prefix').fill('Acquisition');
  // The server commits, then the first reply is lost. Retry the exact intent.
  const commit=RecordSectionCommands.prototype.appendPrivate;let firstResult;
  RecordSectionCommands.prototype.appendPrivate=async function(command){firstResult=await commit.call(this,command);throw new AppError('IO');};
  const saveParts=dialog.getByRole('button',{name:'Save private sections'});
  try{
   await saveParts.click();await expect(dialog.locator('[data-paste-review] [role="status"]')).not.toHaveText('This will append 2 private sections to the record in the order shown in the source.',{timeout:20000});
   expect(firstResult.saved).toBe(true);
  }finally{RecordSectionCommands.prototype.appendPrivate=commit;}
  await saveParts.click();await expect(dialog.locator('[data-writing-capacity]')).toHaveText('Saved 2 private sections.',{timeout:20000});
  const {sections}=await history.read({...target,header:false});
  expect(sections.values.map(s=>s.title)).toEqual(['Acquisition 1','Acquisition 2']);
  expect(sections.values.every(s=>s.share===false&&s.sharePdf===false)).toBe(true);
  const inlines=sections.values.flatMap(s=>s.body.content.flatMap(p=>p.content));
  expect(inlines.map(n=>n.text).join('')).toBe(sample);expect(inlines.every(n=>n.marks?.some(m=>m.attrs?.href===link))).toBe(true);
  expect((await history.read({...target,snapshotId:previous.etag,header:false})).sections.total).toBe(0);
  expect((await history.read({...target,header:false,search:'Acquisition 2'})).found).toBeTruthy();
  const original='<table><tr><td>unmapped α</td></tr></table>';
  await paste(editor,{text:'unmapped α',html:original});
  const keep=dialog.getByRole('button',{name:'Keep original with this record'});
  const start=ResearchMaterials.prototype.startImport;let firstUpload;
  ResearchMaterials.prototype.startImport=async function(command){firstUpload=await start.call(this,command);throw new AppError('IO');};
  try{
   await keep.click();await expect(dialog.locator('[data-paste-review] [role="status"]')).not.toBeEmpty({timeout:20000});
   expect(firstUpload.recordId).toBe(target.recordId);
  }finally{ResearchMaterials.prototype.startImport=start;}
  const {id}=firstUpload,summary=MaterialUploadChunks.prototype.summary;
  const feedback=dialog.locator('[data-paste-review] [role="status"]');
  let wrongStart=true;
  MaterialUploadChunks.prototype.summary=async function(session){
   const receipt=await summary.call(this,session);
   if(session.id!==id)return receipt;
   if(wrongStart){wrongStart=false;return {...receipt,requestId:randomUUID(),fingerprint:'e'.repeat(64)};}
   if(receipt.completed)return {...receipt,completed:{...receipt.completed,revision:'a'.repeat(64)}};
   return receipt;
  };
  try{
   await keep.click();await expect(feedback).toContainText('selection or record has changed');
   await keep.click();await expect(feedback).toContainText('proposal is available to retry',{timeout:30000});
  }finally{MaterialUploadChunks.prototype.summary=summary;}
  await keep.click();
  await expect(dialog.locator('[data-writing-capacity]')).toContainText('original is in this record',{timeout:30000});
  const materials=new ResearchMaterials(workspace),saved=await materials.importState(id);
  expect(saved.recordId).toBe(target.recordId);const {content}=await materials.artifact(saved.completed);
  expect(Buffer.concat(await Array.fromAsync(content.read())).toString()).toBe(original);
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).toHaveCount(0);
  await open.click();await expect(editor).toHaveText('Accepted field note.!');
 });
});

test('resolving a competing save preserves the pending paste until the author chooses what to do',async({page})=>{
 await withRecord(page,'First reading',async({open,dialog,editor,target,workspace})=>{
  const writing=new RecordWriting(workspace),selected={...target,sectionId:null};
  await open.click();await expect(editor).toHaveText('First reading');await editor.press('End');await editor.press('!');
  const other=await writing.read(selected);
  await writing.save({...selected,expectedRevision:other.revision,value:{body:'Second reading'}});
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  const useSaved=dialog.getByRole('button',{name:'Use saved writing'}),keepEdit=dialog.getByRole('button',{name:'Keep my edit after review'});
  await expect(useSaved).toBeVisible();await editor.focus();
  await paste(editor,{text:'observation '.repeat(7000)});
  const proposal=dialog.locator('[data-paste-review]');
  for(const action of [keepEdit,useSaved]){
   await action.click();await expect(proposal).toBeVisible();await expect(proposal.locator('p').first()).toBeFocused();
   await expect(editor).toHaveText('First reading!');
  }
  await proposal.getByRole('button',{name:'Dismiss proposal'}).click();await useSaved.click();await expect(editor).toHaveText('Second reading');
 });
});

test('the admitted maximum can be edited, saved and reopened with its table, nesting and exact text',async({page})=>{
 test.setTimeout(150000);
 // Reference desktop source workflow budgets. Measure each interaction from
 // its initiating control through the visible result, including persistence.
 const budget={open:15000,edit:2000,save:25000,reopen:15000};
 const table={type:'book_table',attrs:{version:1,id:randomUUID(),title:'Readings',headers:Array.from({length:20},(_,i)=>'Station '+i),
  rows:Array.from({length:500},()=>Array(20).fill(''))}};
 table.attrs.rows[499][19]='x'.repeat(10000);
 const leaf={type:'text',text:'x'};
 let deep={type:'paragraph',content:[leaf]};for(let i=0;i<22;i++)deep={type:'blockquote',content:[deep]};
 const doc={type:'doc',content:[deep,table]};
 doc.content.push(...Array.from({length:RICH_TEXT_LIMITS.nodes-richTextAdmission(doc).nodes},()=>({type:'paragraph'})));
 leaf.text+='a'.repeat(RICH_TEXT_LIMITS.characters-richTextAdmission(doc).characters-1);
 expect(richTextAdmission(doc)).toMatchObject({valid:true,characters:59999,nodes:12000,depth:24});
 await withRecord(page,doc,async({workspace,target,open,dialog,editor})=>{
  const elapsed={};
  async function timed(key,action){const start=performance.now();await action();elapsed[key]=Math.round(performance.now()-start);expect(elapsed[key],key).toBeLessThan(budget[key]);}
  await timed('open',async()=>{await open.click();await expect(editor.locator('.book-table table tr')).toHaveCount(501);});
  await expect(dialog.locator('[data-writing-capacity]')).toContainText('1 of 60000');
  const first=editor.locator('p').first();
  await first.evaluate(p=>{p.closest('[contenteditable]').focus();const range=document.createRange();range.selectNodeContents(p);range.collapse(false);const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);});
  await timed('edit',async()=>{await page.keyboard.insertText('!');await expect(dialog.locator('[data-writing-capacity]')).toContainText('0 of 60000');});
  await page.keyboard.insertText('?');await expect(page.locator('#notice')).toContainText('0 of 60000');
  await timed('save',async()=>{await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).toHaveCount(0,{timeout:budget.save});});
  leaf.text+='!';
  const saved=await new RecordWriting(workspace).read({...target,sectionId:null});
  expect(richTextAdmission(saved.value.body)).toMatchObject({valid:true,characters:60000,nodes:12000,depth:24});
  // ProseMirror fills default attributes. Every authored node and cell should survive.
  const {schema}=await import('../../src/editor/schema.js');expect(schema.nodeFromJSON(saved.value.body).eq(schema.nodeFromJSON(doc))).toBe(true);
  await timed('reopen',async()=>{await open.click();await expect(editor.locator('.book-table table tr')).toHaveCount(501);});
  await expect(dialog.locator('[data-writing-capacity]')).toContainText('0 of 12000');
  console.log('Record capacity on reference desktop (ms)',elapsed);
 });
});

test('the editor distinguishes a near-limit paste, excessive nesting and an oversized scientific table',async({page})=>{
 test.setTimeout(90000);
 await withRecord(page,'Note',async({open,dialog,editor})=>{
  await open.click();await expect(editor).toHaveText('Note');await editor.press('End');
  await paste(editor,{text:'s'.repeat(7000)});await expect(dialog.locator('[data-paste-review]')).toContainText('52996 of 60000');
  await dialog.getByRole('button',{name:'Dismiss proposal'}).click();await editor.focus();
  const text='x'.repeat(55000);
  await paste(editor,{text});
  const review=dialog.locator('[data-paste-review]');
  await expect(review).toContainText('4996 of 60000');
  await expect(editor).toHaveText('Note');
  await dialog.locator('[data-writing="close"]').click();await expect(review).toBeVisible();
  await review.getByRole('button',{name:'Insert paste'}).click();
  expect(await editor.textContent()).toBe('Note'+text);
  await editor.press('Control+End');
  const nested='<p>Before</p>'+'<blockquote>'.repeat(25)+'<p>Nested</p>'+'</blockquote>'.repeat(25)+'<p>After</p>';
  await paste(editor,{text:'Before Nested After',html:nested});await expect(review).toContainText('Nesting:');
  await review.getByRole('button',{name:'Dismiss proposal'}).click();
  const table={type:'book_table',attrs:{version:1,id:randomUUID(),title:'Instrument table',headers:['Reading'],rows:Array.from({length:501},()=>['42'])}};
  await paste(editor,{text:'Instrument table',html:"<div data-book-node='"+JSON.stringify(table)+"'>Instrument table</div>"});
  await expect(review).toContainText('up to 500 rows');
  await review.getByRole('button',{name:'Dismiss proposal'}).click();
  expect(await editor.textContent()).toBe('Note'+text);
 });
});
