import {openRecordActions} from './record-editing-helper.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {journeyBook,block} from '../book-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {MediaStore} from '../../src/media.js';
import {convertPublicationRecord} from '../../src/publication-conversion-render.js';
import {routeRecordCopy} from './record-copy-page.js';

test('author book blocks and follow a saved reading journey through exact methods and linked results',async({page,browser},testInfo)=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-ui-')),f=journeyBook(),{book,concept,experiment,run2,method,result}=f,storage=await encryptedFixture(directory,book),materials=new ResearchMaterials(storage.workspace);
 for(const r of book.entries)await storage.workspace.withLock(()=>materials.retainRecord(r));
 const media=new MediaStore(storage.workspace.root,storage.vault),original=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><path d="M10 10H110V70H10Z" fill="orange"/></svg>'),asset=await media.import(original,'image');
 const current={...concept,attachments:[{id:asset.id,kind:'image',alt:'Apparatus path',caption:'Apparatus diagram',transcript:'Input then output.',share:true}]};
 await new ResearchRecords(storage.workspace,media).save({workspaceId:book.id,changes:[{id:concept.id,expectedRevision:recordRevision(concept),record:current},{id:method.id,expectedRevision:recordRevision(method),record:{...method,body:'Later method; original retained.'}}]});
 const app=await startServer({root:storage.workspace.root,deviceStore:storage.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[],requests=[],dialog=page.locator('#dialog');page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));
 const writing=page.locator('dialog.record-writing[open]'),save=async()=>{await writing.getByRole('button',{name:'Save changes',exact:true}).click();await expect(writing).toHaveCount(0);};
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,concept.id);await page.getByRole('button',{name:'Edit summary / context',exact:true}).click();
  const editor=writing,panel=page.getByRole('dialog',{name:'Book content',exact:true});
  // Expanded formatting belongs to the toolbar and must not obscure writing.
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   const more=editor.locator('.text-more').first();await more.locator('summary').click();
   const bounds=await editor.evaluate(el=>{
    const button=el.querySelector('[data-rich-command=book]'),tools=el.querySelector('.document-tools').getBoundingClientRect(),extra=el.querySelector('.text-more>div').getBoundingClientRect(),content=el.querySelector('.document-content').getBoundingClientRect();
    return {buttonFits:button.scrollWidth<=button.clientWidth,inside:extra.top>=tools.top&&extra.bottom<=tools.bottom,writingBelow:content.top>=extra.bottom,overflow:el.scrollWidth>el.clientWidth+1};
   });expect(bounds).toEqual({buttonFits:true,inside:true,writingBelow:true,overflow:false});
   await page.screenshot({path:testInfo.outputPath('formatting-'+width+'.png')});await more.locator('summary').click();
  }
  await page.setViewportSize({width:1440,height:1000});
  await editor.getByRole('textbox').click();await page.keyboard.press('Control+End');await page.keyboard.press('ArrowDown');await editor.getByRole('button',{name:'Book content',exact:true}).click();
  await panel.getByLabel('Title / caption',{exact:true}).fill('Authored readings');await panel.getByLabel('Column headings 1',{exact:true}).fill('Native digits');await panel.getByLabel('Column headings 2',{exact:true}).fill('Exact value');await panel.getByLabel('Row 1, 1',{exact:true}).fill('0005');await panel.getByLabel('Row 1, 2',{exact:true}).fill('9007199254740993');await panel.getByRole('button',{name:'Apply content'}).click();
  await editor.locator('.book-content-node').filter({has:page.locator('caption',{hasText:'Exact measurements'})}).getByRole('button',{name:'Edit selected content',exact:true}).click();await panel.getByLabel('Title / caption',{exact:true}).fill('Renamed exact measurements');await panel.getByRole('button',{name:'Apply content'}).click();
  await editor.locator('.book-content-node').filter({has:page.locator('caption',{hasText:'Renamed exact measurements'})}).dragTo(editor.locator('.book-citation').first(),{targetPosition:{x:12,y:8}});
  await editor.getByRole('button',{name:'Book content',exact:true}).click();await panel.getByLabel('Content kind').selectOption('book_preserved');await panel.getByLabel('Source format / language').fill('Raw text');await panel.getByLabel('Original source',{exact:true}).fill('x'.repeat(60000));await panel.getByLabel('Preservation or mapping explanation').fill('Keep source.');await panel.getByRole('button',{name:'Apply content'}).click();await expect(panel.locator('[data-book-error]')).toContainText('Your entered content is still here');await expect(panel.getByLabel('Original source',{exact:true})).toHaveValue('x'.repeat(60000));await panel.getByRole('button',{name:'Cancel',exact:true}).click();
  await editor.getByRole('button',{name:'Book content',exact:true}).click();await panel.getByLabel('Content kind').selectOption('book_equation');await panel.getByLabel('Original source',{exact:true}).fill(String.raw`\frac{a}{b}`);await panel.getByLabel('Accessible description').fill('Ratio of a to b');await panel.getByRole('button',{name:'Apply content'}).click();
  await editor.getByRole('button',{name:'Book content',exact:true}).click();await panel.getByLabel('Content kind').selectOption('book_citation');await panel.getByLabel('Title / caption',{exact:true}).fill('Authored citation');await panel.getByLabel('Authors',{exact:true}).fill('An observer');await panel.getByLabel('Source URL').fill('https://example.org/source');await panel.getByRole('button',{name:'Apply content'}).click();
  await editor.getByRole('button',{name:'Book content',exact:true}).click();await panel.getByLabel('Content kind').selectOption('book_figure');await panel.getByLabel('Ordered text alternative (one step per line)').fill('Read input at left.\nFollow the path to the output.');await panel.getByRole('button',{name:'Apply content'}).click();await save();
  await page.reload();await page.getByRole('button',{name:'Read record',exact:true}).click();await expect(page.locator('.record-reader')).toContainText('Authored readings');await expect(page.locator('.record-reader')).toContainText('9007199254740993');await expect(page.locator('.record-reader')).toContainText('Authored citation');await expect(page.locator('.record-reader math')).toHaveCount(2);await expect(page.locator('.book-figure-placement img')).toBeVisible();
  const saved=(await storage.workspace.read()).book.entries.find(r=>r.id===concept.id);expect(saved.body.content.find(n=>n.type==='code_block').content[0].text).toBe('  EMIT 105\n\tFORM 0005  \n');expect(saved.body.content.filter(n=>n.type==='book_table')).toHaveLength(2);expect(saved.body.content.find(n=>n.attrs?.id===f.table.attrs.id).attrs.title).toBe('Renamed exact measurements');expect(saved.body.content.findIndex(n=>n.attrs?.id===f.table.attrs.id)).toBeGreaterThan(saved.body.content.findIndex(n=>n.attrs?.id===f.equation.attrs.id));
  await openRecordActions(page);await page.getByRole('button',{name:'Copy section, figure or table reference',exact:true}).click();const referencePicker=page.getByRole('dialog',{name:'Copy content reference',exact:true});await referencePicker.getByLabel('Content destination').selectOption({label:'Authored readings'});await referencePicker.getByLabel('Reference version').selectOption('exact');await page.context().grantPermissions(['clipboard-read','clipboard-write']);await referencePicker.getByRole('button',{name:'Copy reference',exact:true}).click();await expect(referencePicker).not.toBeVisible();
  await page.getByRole('button',{name:'Back to records',exact:true}).click();await page.getByText('Filters',{exact:true}).click();await page.getByLabel('Reading journey').selectOption('concepts');await page.getByLabel('Tags',{exact:true}).fill('a7');await expect(page.locator('.records-table tbody tr')).toHaveCount(1);
  await page.getByRole('button',{name:'Saved views',exact:true}).click();await dialog.getByRole('button',{name:'Save current view',exact:true}).click();await dialog.getByLabel('View name').fill('Concept reading');await dialog.getByRole('button',{name:'Save view',exact:true}).click();await expect(dialog).toContainText('Concepts and definitions');await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:concept.title,exact:true}).click();await page.getByRole('button',{name:experiment.title,exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText(experiment.title);
  await page.locator('.record-workflow').getByRole('link',{name:run2.title,exact:true}).click();await page.getByRole('button',{name:method.title,exact:true}).click();await expect(dialog).toContainText('Original setup instructions');await expect(dialog).not.toContainText('Later method');await expect(dialog.locator('#record-section-'+method.sections[0].id)).toBeFocused();await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Show linked records',exact:true}).click();await page.locator('.record-activity').getByRole('link',{name:result.title,exact:true}).click();await expect(page.locator('.record-reader')).toContainText('Both attempts remain distinct');await page.getByRole('button',{name:'Back to records',exact:true}).click();await expect(page.getByLabel('Reading journey')).toHaveValue('concepts');await expect(page.getByLabel('Tags',{exact:true})).toHaveValue('a7');
  await page.getByRole('button',{name:concept.title,exact:true}).click();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.setProperty('--app-font-size','32px'));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.getByText('Read table row by row',{exact:true}).first().focus();await page.keyboard.press('Enter');await expect(page.locator('.book-table-linear').first()).toHaveAttribute('open','');await page.screenshot({path:testInfo.outputPath('book-reader-phone.png')});
  await page.emulateMedia({media:'print'});await expect(page.locator('.book-table-scroll').first()).toBeHidden();await expect(page.locator('.book-table-linear ol').first()).toBeVisible();await page.emulateMedia({media:'screen'});
  // The website copy of the shared concept shows its placed figure and no private record.
  await page.setViewportSize({width:1440,height:1000});
  const current=(await storage.workspace.read()).book,copy=await convertPublicationRecord(storage.workspace,current,{...current.entries.find(e=>e.id===concept.id),share:true}),context=await browser.newContext(),published=await context.newPage();
  try{await published.goto(await routeRecordCopy(context,'https://book.invalid',copy));await expect(published.locator('.book-figure-placement img')).toBeVisible();await expect(published.locator('body')).not.toContainText(f.privateRecord.title);}finally{await context.close();}
  expect(requests.filter(p=>p==='/api/notebook'||p==='/api/workspace/read/page')).toEqual([]);expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(storage.vault);await rm(directory,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
});

