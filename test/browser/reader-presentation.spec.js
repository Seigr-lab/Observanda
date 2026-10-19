import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {researchReference} from '../../src/web/research-reference.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {attemptFixture} from '../fixtures/attempts.js';

const edits='[data-action="writing-edit"],[data-action^="record-value-"],[data-action^="stored-section-"],[data-action^="stored-figure-"],[data-action^="stored-media-"],[data-action="record-activity-create"],[data-action="workflow-new-run"],[data-action="record-removal-open"],[data-action="record-location-open"],[data-action="material-repeat"],[contenteditable=true]';
test('reading is distinct from editing and preserves readable tables and retained sources through book navigation',async({page},info)=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-reading-presentation-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0],related=book.entries[1];
 record.title='Measured observation';related.title='Related method';related.notebookId=record.notebookId;
 record.figures=[];record.attachments=[];record.sections=[{id:randomUUID(),title:'Detailed observation',body:'Readable preserved writing.'}];
 const columns=Array.from({length:16},(_,i)=>'Measurement '+(i+1)),table={type:'book_table',attrs:{version:1,id:randomUUID(),title:'Complete measurement table',headers:columns,rows:[columns.map((_,i)=>'Exact retained value '+(i+1))]}};
 record.body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Follow the related method',marks:[{type:'link',attrs:{href:researchReference({workspaceId:book.id,kind:'record',id:related.id}),title:'Related method',target:'_self',nofollow:false}}]}]},table]};
 book.entries=[record,related];book.title='workspace';
 const f=await encryptedFixture(directory,book),materials=new ResearchMaterials(f.workspace),bytes=Buffer.from('Original synthetic observation');
 const upload=await materials.startImport({recordId:record.id,name:'observations.txt',size:bytes.length,provenance:'Synthetic reader qualification'});await materials.appendImport(upload.id,0,[bytes]);const artifact=await materials.finishImport(upload.id);
 const analysis=await materials.analysis({recordId:record.id,title:'Retained method analysis',inputs:[artifact],tool:'Synthetic reader',version:'1',parameters:'Exact retained method',outputs:[]});
 const next={...record,attempt:attemptFixture(),results:{version:1,statements:[{id:randomUUID(),kind:'number',title:'Retained reading result',text:'Exact recorded outcome',basis:'retained',source:{...analysis,workspaceId:book.id,label:'Retained method analysis'},limitations:'Synthetic observations'}]}};
 await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:next}]},{receipt:true});
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[],wholeReads=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\/api\/workspace\/read\/(selection|page)$/.test(new URL(r.url()).pathname))wholeReads.push(r.url());});
 const reader=page.locator('.record-reader'),dialog=page.locator('#dialog');
 const checkTable=async(surface)=>{
  const viewport=surface.getByRole('region',{name:'Complete measurement table',exact:true});await expect(viewport).toBeVisible();
  const dimensions=await viewport.evaluate(node=>{node.scrollLeft=node.scrollWidth;const table=node.querySelector('table'),last=table.querySelector('tr').lastElementChild;return {scrollable:node.scrollWidth>node.clientWidth,scrolled:node.scrollLeft>0,lastVisible:last.getBoundingClientRect().right<=node.getBoundingClientRect().right+2,contained:document.documentElement.scrollWidth<=innerWidth+1};});
  expect(dimensions).toEqual({scrollable:true,scrolled:true,lastVisible:true,contained:true});
  await expect(viewport.locator('xpath=preceding-sibling::*[1]')).toHaveText('Scroll sideways to see all columns. You can also focus the table and use the arrow keys.');
  const heading=viewport.locator('th').first();expect(await heading.evaluate(node=>getComputedStyle(node).overflowWrap)).toBe('normal');
  await viewport.evaluate(node=>{node.scrollLeft=0;node.scrollIntoView({block:'center'});});
 };
 try{
  await page.setViewportSize({width:1920,height:1032});await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');await expect(reader.getByRole('heading',{name:record.title,exact:true})).toBeVisible();const before=(await f.workspace.outline()).etag;
  await expect(reader.locator(edits)).toHaveCount(0);await expect(page.locator('.record-toolbar [data-action="record-edit"]')).toBeVisible();
  expect(await reader.evaluate(node=>node.getBoundingClientRect().width/node.parentElement.getBoundingClientRect().width)).toBeGreaterThan(.85);
  await checkTable(reader);await page.screenshot({path:info.outputPath('record-reader-wide-table.png')});
  await reader.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:/Create dataset|Record external analysis|Import file set/})).toHaveCount(0);
  await dialog.locator('.material-list li').filter({hasText:'Retained method analysis'}).getByRole('button',{name:'Inspect',exact:true}).click();await expect(dialog).toContainText('Exact retained method');await expect(dialog.locator('[data-action="material-attach"]')).toHaveCount(0);await dialog.getByRole('button',{name:'Back to evidence',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(reader.locator(edits)).toHaveCount(0);
  await page.getByRole('button',{name:'Edit record',exact:true}).click();await expect(page.locator('.record-editing [data-action="writing-edit"]').first()).toBeVisible();await page.getByRole('button',{name:'Read record',exact:true}).click();await expect(reader.locator(edits)).toHaveCount(0);
  await page.goto(app.origin+'/#/notebooks/'+record.notebookId+'/read');const card=page.locator('[data-reading-record="'+record.id+'"]');await expect(card).toBeVisible();await expect(card.locator(edits)).toHaveCount(0);await expect(card).not.toContainText('Supporting analysis is retained privately');
  await card.getByRole('button',{name:/Retained method analysis/}).click();await expect(dialog).toContainText('Exact retained method');await expect(dialog.locator('[data-action="material-attach"]')).toHaveCount(0);await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(card).toBeVisible();await checkTable(card);
  await page.setViewportSize({width:390,height:844});await checkTable(card);await page.screenshot({path:info.outputPath('lab-book-reader-phone.png')});await page.setViewportSize({width:1440,height:1000});
  await card.getByRole('link',{name:'Follow the related method',exact:true}).first().click();await expect(reader.getByRole('heading',{name:related.title,exact:true})).toBeVisible();await expect(reader.locator(edits)).toHaveCount(0);await expect(page).toHaveURL(/\/read$/);
  await page.getByRole('button',{name:'Back to records',exact:true}).click();await expect(card).toBeVisible();await expect(page).toHaveURL(new RegExp('/notebooks/'+record.notebookId+'/read$'));
  expect((await f.workspace.outline()).etag).toBe(before);expect(wholeReads).toEqual([]);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
