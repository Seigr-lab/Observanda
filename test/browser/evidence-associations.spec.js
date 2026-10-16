import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchMaterials} from '../../src/research-materials.js';

test('attach a stored disk image to another run from the reader and download from both records',async({page},info)=>{
 test.setTimeout(150000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-evidence-reuse-ui-')),book=upgradeNotebook(sampleNotebook()),[first,second]=book.entries;
 book.entries=[first,second];for(const r of book.entries){r.figures=[];r.sections=[];r.attachments=[];r.relations=[];r.share=false;}
 first.title='Prepared image';second.title='Run using the prepared image';
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences')}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));const dialog=page.locator('#dialog');
 const bytes=Buffer.alloc(16*1024*1024+79,0xa7);bytes.write('Synthetic disk image');const name='prepared-image.img',hash=createHash('sha256').update(bytes).digest('hex');
 const open=async id=>{await page.evaluate(value=>location.hash='#/records/'+value+'/read',id);await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();};
 try{
  await page.goto(app.url);await open(first.id);
  await dialog.getByRole('button',{name:'Import original file',exact:true}).click();await dialog.getByLabel('Original file',{exact:true}).setInputFiles({name,mimeType:'application/octet-stream',buffer:bytes});
  await dialog.getByLabel('Provenance / acquisition notes').fill('Prepared once; used by several runs.');await dialog.getByRole('button',{name:'Import original',exact:true}).click();
  await expect(dialog.locator('.material-list')).toContainText(name,{timeout:45000});await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await open(second.id);await dialog.getByRole('button',{name:'Attach existing originals',exact:true}).click();
  await expect(dialog.getByLabel('Sources for Stored original files',{exact:true})).toHaveValue('all');
  await dialog.getByRole('button',{name:'Inspect '+name,exact:true}).click();
  await expect(dialog.locator('[data-original-preview]')).toContainText('Prepared image');await expect(dialog.locator('[data-original-preview]')).toContainText(hash);await expect(dialog.locator('[data-original-preview]')).toContainText('Prepared once; used by several runs.');
  await dialog.getByRole('checkbox').check();
  const attached=page.waitForResponse(r=>r.url().endsWith('/api/research/materials/association-step'));await dialog.getByRole('button',{name:'Attach selected files',exact:true}).click();expect((await attached).ok()).toBe(true);
  for(const record of [second,first]){
   if(record===first){await dialog.getByRole('button',{name:'Close',exact:true}).click();await open(first.id);}
   await expect(dialog.locator('.material-list li')).toHaveCount(1);await expect(dialog.locator('.material-list')).toContainText(hash);await expect(dialog.locator('.material-list')).toContainText(bytes.length+' bytes');
   const downloading=page.waitForEvent('download');await dialog.getByRole('link',{name:'Download '+name,exact:true}).click();const download=await downloading;expect(download.suggestedFilename()).toBe(name);expect(await readFile(await download.path())).toEqual(bytes);
  }
  const materials=new ResearchMaterials(f.workspace);expect(await readdir(await materials.directory('originals'))).toHaveLength(1);
  await page.setViewportSize({width:390,height:844});await expect(dialog.locator('.material-list')).toBeVisible();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('shared-original-phone.png')});
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('select files across pages and resume attachment after a lost committed reply and application reload',async({page},info)=>{
 test.setTimeout(180000);page.setDefaultTimeout(20000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-evidence-batch-ui-')),book=upgradeNotebook(sampleNotebook()),[first,second]=book.entries;
 book.entries=[first,second];for(const r of book.entries){r.figures=[];r.sections=[];r.attachments=[];r.relations=[];r.share=false;}
 const f=await encryptedFixture(directory,book),materials=new ResearchMaterials(f.workspace),refs=[];
 for(let i=0;i<45;i++){
  const bytes=Buffer.from('Prepared input '+i),upload=await materials.startImport({recordId:first.id,name:'input-'+String(i).padStart(2,'0')+'.bin',size:bytes.length});
  await materials.appendImport(upload.id,0,[bytes]);refs.push(await materials.finishImport(upload.id));
 }
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences')}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));const dialog=page.locator('#dialog'),picker=dialog.locator('#material-picker-reuse');
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id+'/read',second.id);
  await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();await dialog.getByRole('button',{name:'Attach existing originals',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Attach selected files',exact:true})).toBeDisabled();
  await expect(picker.getByRole('checkbox')).toHaveCount(20);
  await picker.getByRole('button',{name:'Select displayed sources',exact:true}).click();await expect(picker.locator('[data-selection]')).toContainText('20 selected');
  await picker.getByRole('button',{name:'More sources',exact:true}).click();await picker.getByRole('button',{name:'Select displayed sources',exact:true}).click();await expect(picker.locator('[data-selection]')).toContainText('40 selected');
  await picker.getByRole('button',{name:'More sources',exact:true}).click();await expect(picker.getByRole('checkbox')).toHaveCount(5);
  await picker.getByRole('button',{name:'Select displayed sources',exact:true}).click();await expect(picker.locator('[data-selection]')).toContainText('45 selected');
  await picker.getByRole('button',{name:'Deselect displayed sources',exact:true}).click();await expect(picker.locator('[data-selection]')).toContainText('40 selected');
  await picker.getByRole('checkbox').first().check();await expect(picker.locator('[data-selection]')).toContainText('41 selected');
  const selected=JSON.parse(await picker.locator('[data-value]').inputValue());
  const expected=(await materials.choices.page({recordId:second.id,kind:'artifact',selection:selected.selection,limit:64})).items;
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='150%');
  expect(await picker.evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBe(true);await dialog.screenshot({path:info.outputPath('batch-selection-phone.png')});
  let lost=false;
  await page.route('**/api/research/materials/association-step',async route=>{if(!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();});
  await dialog.getByRole('button',{name:'Attach selected files',exact:true}).click();
  await expect(dialog.locator('[data-association-error]')).not.toBeEmpty();await expect(dialog.getByRole('button',{name:'Continue attaching',exact:true})).toBeVisible();
  expect((await materials.associations.list({recordId:second.id})).items[0].attached).toBe(32);
  await page.reload();await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();
  await expect(dialog).toContainText('32 of 41 files attached');const completion=page.waitForResponse(r=>r.url().endsWith('/api/research/materials/association-step'));
  await dialog.getByRole('button',{name:'Continue attaching',exact:true}).click();expect((await (await completion).json()).state).toBe('completed');
  await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible();await expect(dialog.getByRole('heading',{name:'Unfinished attachments',exact:true})).toHaveCount(0);
  const attached=[];let cursor=null;
  do{const result=await materials.list({recordId:second.id,cursor});attached.push(...result.items);cursor=result.next;}while(cursor);
  expect(attached).toHaveLength(41);
  const actual=[];await materials.readSnapshot(async()=>{for(const ref of attached)actual.push((await materials.read(ref)).content.inputs[0]);});
  expect(actual.map(r=>r.id).sort()).toEqual(expected.map(r=>r.id).sort());
  expect(await readdir(await materials.directory('originals'))).toHaveLength(45);
  // Pause at an actual committed batch boundary, then end the task. Existing
  // associations and downloads remain; cancellation only stops further work.
  await dialog.getByRole('button',{name:'Attach existing originals',exact:true}).click();
  for(let i=0;i<3;i++){
   if(i)await picker.getByRole('button',{name:'More sources',exact:true}).click();
   await picker.getByRole('button',{name:'Select displayed sources',exact:true}).click();await expect(picker.locator('[data-selection]')).toContainText(((i+1)*20)+' selected');
  }
  await page.unroute('**/api/research/materials/association-step');let release,entered;
  const committed=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);
  await page.route('**/api/research/materials/association-step',async route=>{const response=await route.fetch();entered();await held;await route.fulfill({response});});
  await dialog.getByRole('button',{name:'Attach selected files',exact:true}).click();await committed;
  await dialog.getByRole('button',{name:'Pause attaching',exact:true}).click();release();
  await expect(dialog.getByRole('button',{name:'End this attachment task',exact:true})).toBeVisible();await expect(dialog).toContainText('32 of 60 files attached');
  const cancelled=page.waitForResponse(r=>r.url().endsWith('/api/research/materials/association-cancel'));
  await dialog.getByRole('button',{name:'End this attachment task',exact:true}).click();expect((await (await cancelled).json()).state).toBe('cancelled');
  await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible();
  expect((await materials.associations.list({recordId:second.id})).items).toEqual([]);
  expect(await readdir(await materials.directory('originals'))).toHaveLength(45);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
