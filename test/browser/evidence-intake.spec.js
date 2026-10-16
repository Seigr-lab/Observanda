import os from 'node:os';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {test,expect} from '@playwright/test';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';

test('a selection above ten thousand files reaches paged registration and recovers from an interrupted request',async({page})=>{
 test.setTimeout(120000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-intake-selection-count-')),f=await encryptedFixture(directory,sampleNotebook()),owner=(await f.workspace.read()).book.entries[0].id;
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),requests=[];
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,owner);
  await page.getByRole('button',{name:'Open evidence & analysis'}).click();const dialog=page.locator('#dialog');
  await dialog.getByRole('button',{name:'Import file set',exact:true}).click();await dialog.getByLabel('Collection title',{exact:true}).fill('Growing recording set');
  await dialog.getByLabel('Original files',{exact:true}).evaluate(input=>{const selection=new DataTransfer();for(let i=0;i<10017;i++)selection.items.add(new File([],'take-'+i+'.txt',{type:'text/plain'}));input.files=selection.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.route('**/api/research/materials/intake-selection-append',async route=>{requests.push(route.request().postDataJSON());await route.fetch();await route.abort('failed');});
  await dialog.getByRole('button',{name:'Upload file set',exact:true}).click();
  await expect.poll(()=>requests.length).toBe(1);expect(requests[0].items).toHaveLength(64);
  await expect(dialog.getByRole('button',{name:'Upload file set',exact:true})).toBeEnabled();
  await page.unroute('**/api/research/materials/intake-selection-append');
  await dialog.getByLabel('Original files',{exact:true}).setInputFiles({name:'continued.txt',mimeType:'text/plain',buffer:Buffer.from('continued')});
  await dialog.getByRole('button',{name:'Upload file set',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Verify and attach file set'})).toBeEnabled({timeout:30000});await dialog.getByRole('button',{name:'Verify and attach file set'}).click();
  await expect(dialog.getByRole('heading',{name:'File set attached',exact:true})).toBeVisible({timeout:30000});
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('folder selection retains paths, purpose and downloads in the evidence reader',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-folder-intake-ui-')),tree=path.join(directory,'source-tree');
 for(const folder of ['preparation','current','history']){await mkdir(path.join(tree,folder),{recursive:true});await writeFile(path.join(tree,folder,'analysis.json'),'{}');}
 const f=await encryptedFixture(directory,sampleNotebook()),materials=new ResearchMaterials(f.workspace),owner=(await f.workspace.read()).book.entries[0].id;
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,owner);
  await page.getByRole('button',{name:'Open evidence & analysis'}).click();const dialog=page.locator('#dialog');
  await dialog.getByRole('button',{name:'Import file set',exact:true}).click();
  await dialog.getByLabel('Collection title',{exact:true}).fill('Returned source tree');
  await dialog.getByLabel('Select source',{exact:true}).selectOption('folder');
  await dialog.getByLabel('Source purpose',{exact:true}).selectOption('current-return');
  await dialog.getByLabel('Original files',{exact:true}).setInputFiles(tree);
  await dialog.getByRole('button',{name:'Upload file set',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Verify and attach file set'})).toBeEnabled({timeout:30000});
  await page.reload();await page.getByRole('button',{name:'Open evidence & analysis'}).click();
  await dialog.getByRole('button',{name:'Unfinished file sets',exact:true}).click();
  await dialog.getByRole('button',{name:'Continue Returned source tree',exact:true}).click();
  await expect(dialog.locator('#intake-files')).toHaveAttribute('webkitdirectory','');
  for(const folder of ['preparation','current','history'])await expect(dialog.getByText('source-tree/'+folder+'/analysis.json',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Verify and attach file set'}).click();
  await expect(dialog.getByRole('heading',{name:'File set attached',exact:true})).toBeVisible({timeout:30000});
  await dialog.getByRole('button',{name:'Back to evidence',exact:true}).click();
  const row=dialog.locator('.material-list > li').filter({hasText:'source-tree/current/analysis.json'});await expect(row).toHaveCount(1);
  await expect(row).toContainText('Current return');await row.getByRole('button',{name:'Inspect',exact:true}).click();
  await expect(dialog.getByText('source-tree/current/analysis.json',{exact:true})).toBeVisible();
  const event=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download original',exact:true}).click();const download=await event;
  expect(await readFile(await download.path(),'utf8')).toBe('{}');await materials.verify();
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
test('file sets resume after lost upload replies and reload, then attach together with per-file hashes',async({page},testInfo)=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-intake-ui-'));
 const {workspace:ws,vault,deviceStore}=await encryptedFixture(directory,sampleNotebook()),materials=new ResearchMaterials(ws),owner=(await ws.read()).book.entries[0].id;
 const app=await startServer({root:ws.root,deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const files=[{name:'take-a.raw',mimeType:'application/octet-stream',buffer:Buffer.alloc(1024*1024+31,0x61)},{name:'take-b.raw',mimeType:'application/octet-stream',buffer:Buffer.alloc(1024*1024+31,0x61)},
  ...Array.from({length:73},(_,i)=>({name:'field-note-'+String(i).padStart(2,'0')+'.txt',mimeType:'text/plain',buffer:Buffer.from('Field note '+i)}))];
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,owner);
  await page.getByRole('button',{name:'Open evidence & analysis'}).click();const dialog=page.locator('#dialog');
  await dialog.getByRole('button',{name:'Import file set',exact:true}).click();
  await dialog.getByLabel('Collection title',{exact:true}).fill('Private recording session');
  await dialog.getByLabel('Provenance / acquisition notes').fill('Private path E:\\private\\recordings');
  await dialog.getByLabel('Original files',{exact:true}).setInputFiles(files);
  let lost=false;
  await page.route('**/api/research/materials/chunk/*/*',async route=>{
   if(!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();
  });
  await dialog.getByRole('button',{name:'Upload file set',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Upload selected files',exact:true})).toBeEnabled({timeout:30000});
  await expect(dialog.getByRole('button',{name:'Verify and attach file set'})).toBeDisabled();
  expect((await materials.overview(owner)).items).toHaveLength(0);const batches=await materials.intakes.list(owner);expect(batches.items).toHaveLength(1);
  await page.reload();await page.getByRole('button',{name:'Open evidence & analysis'}).click();
  await dialog.getByRole('button',{name:'Unfinished file sets',exact:true}).click();
  await dialog.getByRole('button',{name:'Continue Private recording session',exact:true}).click();
  await expect(dialog.locator('.intake-files > li')).toHaveCount(20);
  await dialog.getByRole('button',{name:'More files',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(dialog.locator('.intake-files > li').first()).toContainText('field-note-20.txt');
  await expect(dialog.locator('.intake-files > li')).toHaveCount(20);
  await dialog.getByLabel('Select remaining files to upload').setInputFiles([{...files[0],buffer:Buffer.alloc(files[0].buffer.length,0x62)}]);
  await dialog.getByRole('button',{name:'Upload selected files',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Upload selected files',exact:true})).toBeEnabled();
  await expect(dialog.getByRole('button',{name:'Verify and attach file set'})).toBeDisabled();
  await expect(dialog.locator('#intake-status')).toContainText('differ from the saved file set');
  await dialog.getByLabel('Select remaining files to upload').setInputFiles(files);
  await dialog.getByRole('button',{name:'Upload selected files',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Verify and attach file set'})).toBeEnabled({timeout:30000});
  expect((await materials.overview(owner)).items).toHaveLength(0);
  await dialog.getByRole('button',{name:'Verify and attach file set'}).click();
  await expect(dialog.getByRole('heading',{name:'File set attached',exact:true})).toBeVisible({timeout:30000});
  const attached=await materials.intakes.page({id:batches.items[0].id});expect(attached.batch.state).toBe('completed');expect(attached.items.every(f=>f.sha256&&f.completed)).toBe(true);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='150%');
  await dialog.getByText('SHA-256',{exact:true}).first().click();
  const bounds=await dialog.evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth,bodyScroll:el.querySelector('form').scrollWidth,bodyWidth:el.querySelector('form').clientWidth,footer:el.querySelector('.dialog-actions').getBoundingClientRect().bottom}));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+2);expect(bounds.bodyScroll).toBeLessThanOrEqual(bounds.bodyWidth+2);expect(bounds.footer).toBeLessThan(845);
  await page.screenshot({path:testInfo.outputPath('file-set-narrow.png')});
  await dialog.getByRole('button',{name:'Inspect collection',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Private recording session',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Inspect imported file set',exact:true}).click();await expect(dialog.getByRole('heading',{name:'File set attached',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true});}
});

test('single originals resume after a lost chunk reply, reject a changed prefix, and download exact bytes',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-original-resume-')),f=await encryptedFixture(directory,sampleNotebook()),materials=new ResearchMaterials(f.workspace),owner=(await f.workspace.read()).book.entries[0].id;
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const buffer=Buffer.alloc(2*1024*1024+47,0x71),file={name:'capture.raw',mimeType:'application/octet-stream',buffer},sizes=[];
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,owner);
  await page.getByRole('button',{name:'Open evidence & analysis'}).click();const dialog=page.locator('#dialog');
  await dialog.getByRole('button',{name:'Import original file',exact:true}).click();
  await dialog.getByLabel('Original file',{exact:true}).setInputFiles(file);
  let lost=false;
  await page.route('**/api/research/materials/chunk/*/*',async route=>{
   if(!lost){lost=true;const response=await route.fetch();const json=await response.json();sizes.push(JSON.stringify(json).length);expect(json.chunks).toBeUndefined();await route.abort('failed');}
   else await route.continue();
  });
  await dialog.getByRole('button',{name:'Import original',exact:true}).click();
  await expect(dialog.locator('#material-progress')).toContainText('fetch');
  const pending=(await materials.overview(owner)).imports[0];expect(pending.receivedChunks).toBe(1);expect(pending.receivedBytes).toBe(1024*1024);expect(sizes[0]).toBeLessThan(1024);
  await page.reload();await page.getByRole('button',{name:'Open evidence & analysis'}).click();
  await dialog.getByRole('button',{name:'Resume upload',exact:true}).click();
  const changed=Buffer.from(buffer);changed[0]^=1;
  await dialog.getByLabel('Select the same original file').setInputFiles({...file,buffer:changed});
  await dialog.getByRole('button',{name:'Resume import',exact:true}).click();
  await expect(dialog.locator('#material-progress')).toContainText('differs from the interrupted original');
  expect(materials.uploads.count(await materials.importState(pending.id))).toBe(1);
  await dialog.getByLabel('Select the same original file').setInputFiles(file);
  await dialog.getByRole('button',{name:'Resume import',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible({timeout:30000});
  const originals=(await materials.overview(owner)).items.filter(item=>item.kind==='artifact');expect(originals).toHaveLength(1);
  await dialog.locator('.material-list > li').filter({hasText:'capture.raw'}).getByRole('button',{name:'Inspect',exact:true}).click();
  const downloadEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download original'}).click();const download=await downloadEvent;
  expect(await readFile(await download.path())).toEqual(buffer);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
