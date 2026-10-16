import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {encryptedFixture} from './encrypted-fixture.js';
import {startServer} from '../../src/server.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {MediaStore} from '../../src/media.js';
import {MediaImports} from '../../src/media-imports.js';
import {preferences} from './preferences-helper.js';
const bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><!-- private source notes --><rect width="48" height="48" fill="teal"/></svg>');

test('cancelled media survives restart, downloads intact, retries and attaches only when chosen',async({page})=>{
 test.setTimeout(60000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-media-ui-')),book=sampleNotebook();book.entries[0].attachments=[];
 const f=await encryptedFixture(directory,book),options={root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')};
 let app=await startServer(options),first=true;const prepare=MediaStore.prototype.prepare;
 MediaStore.prototype.prepare=async function(...args){if(first){first=false;await delay(30000,null,{signal:args[4]?.signal});}return prepare.apply(this,args);};
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id+'/read',book.entries[0].id);
  await page.getByLabel('Add image, audio or video',{exact:true}).setInputFiles({name:'private-study.svg',mimeType:'image/svg+xml',buffer:bytes});
  await expect(page.locator('#media-upload-status')).toContainText(/process|preparing/i,{timeout:15000});
  await page.getByRole('button',{name:'Media imports',exact:true}).click();const dialog=page.locator('#dialog');
  await expect(dialog).toContainText('private-study.svg');await expect(dialog).toContainText('running');
  await dialog.getByRole('button',{name:'Cancel processing',exact:true}).click();await expect(dialog).toContainText('cancelled',{timeout:15000});
  const downloadEvent=page.waitForEvent('download');await dialog.getByRole('link',{name:'Download original',exact:true}).click();const download=await downloadEvent;expect(await readFile(await download.path())).toEqual(bytes);
  const url=await dialog.getByRole('link',{name:'Download original'}).getAttribute('href');expect((await fetch(new URL(url,app.url))).ok).toBe(false);
  const wrong=await page.request.get(new URL(url.replace(/context=[^&]+/,'context=wrong'),app.url).href);expect((await wrong.json()).code).toBe('WORKSPACE_CHANGED');
  await app.close();app=await startServer(options);await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id+'/read',book.entries[0].id);
  await page.getByRole('button',{name:'Media imports',exact:true}).click();await expect(dialog).toContainText('cancelled');
  await dialog.getByRole('button',{name:'Retry processing',exact:true}).click();await expect(dialog.getByRole('button',{name:'Use media',exact:true})).toBeVisible({timeout:15000});
  expect((await f.workspace.read()).book.entries[0].attachments).toEqual([]);
  await dialog.getByRole('button',{name:'Use media',exact:true}).click();await expect(dialog).not.toBeVisible();
  const media=page.locator('[data-record-media] img');await expect(media).toHaveCount(1);await expect(media).toBeVisible();
  expect((await f.workspace.read()).book.entries[0].attachments).toHaveLength(1);expect((await new MediaImports(f.workspace).list())).toHaveLength(1);
  await page.getByRole('button',{name:'Edit record',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'Record editing areas',exact:true})).toBeVisible();await expect(media).toBeVisible();
  await page.getByRole('button',{name:'Read record',exact:true}).click();await page.reload();
  await expect(page.locator('.record-reader h1')).toHaveText(book.entries[0].title);await expect(media).toHaveCount(1);await expect(media).toBeVisible();expect(errors).toEqual([]);
 }finally{MediaStore.prototype.prepare=prepare;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('durable SVG branding upload adds a draft, persists on Save and can be inspected on a narrow screen',async({page})=>{
 test.setTimeout(45000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-media-branding-')),f=await encryptedFixture(directory,sampleNotebook()),app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 try{
  await page.goto(app.url);await preferences(page,'Appearance');await page.getByRole('button',{name:'Logos & branding',exact:true}).click();
  await page.getByLabel('Add logo',{exact:true}).setInputFiles({name:'studio.svg',mimeType:'image/svg+xml',buffer:bytes});
  await expect(page.locator('.logo-editor img')).toBeVisible({timeout:15000});expect((await f.workspace.read()).book.branding).toEqual([]);
  await page.getByRole('button',{name:'Save branding',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.reload();await expect(page.locator('.logo-editor img')).toBeVisible();
  await page.setViewportSize({width:390,height:844});const open=page.getByRole('button',{name:'Media imports',exact:true});await open.focus();await page.keyboard.press('Enter');
  const dialog=page.locator('#dialog');await expect(dialog).toContainText('completed');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:test.info().outputPath('media-imports-narrow.png')});
  await dialog.getByRole('button',{name:'Close',exact:true}).focus();await page.keyboard.press('Enter');await expect(dialog).not.toBeVisible();
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('an interrupted upload can be reselected and used in the website editor without duplication',async({page})=>{
 test.setTimeout(45000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-media-resume-')),f=await encryptedFixture(directory,sampleNotebook()),imports=new MediaImports(f.workspace);
 const session=await imports.start({name:'reselect.svg',size:bytes.length,kind:'image'});await imports.receive(session.id,[bytes.subarray(0,12)]).catch(error=>{expect(error.code).toBe('MATERIAL_INCOMPLETE');});
 const app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 try{
  const {navigate}=await import('./preferences-helper.js'),{editorTab}=await import('./composer-helper.js');
  await page.goto(app.url);await navigate(page,'Website editor');await editorTab(page,'Media');
  await page.getByRole('button',{name:'Media imports',exact:true}).click();const dialog=page.locator('#dialog');
  await expect(dialog).toContainText('Upload interrupted');await dialog.getByLabel('Reselect original file',{exact:true}).setInputFiles({name:'reselect.svg',mimeType:'image/svg+xml',buffer:bytes});
  await expect(dialog.getByRole('button',{name:'Use media',exact:true})).toBeVisible({timeout:15000});
  await expect(dialog.getByRole('button',{name:'Cancel upload',exact:true})).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('media-imports-website.png')});
  await dialog.getByRole('button',{name:'Use media',exact:true}).click();await expect(page.locator('.website-media-library img')).toHaveCount(1);
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.reload();await editorTab(page,'Media');await expect(page.locator('.website-media-library img')).toHaveCount(1);
  await page.getByRole('button',{name:'Media imports',exact:true}).click();await dialog.getByRole('button',{name:'Use media',exact:true}).click();
  await expect(page.locator('.website-media-library img')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Save website',exact:true})).toBeDisabled();await expect(page.locator('#save-status')).toHaveText('Saved');
  expect((await f.workspace.read()).book.website.assets).toHaveLength(1);
  expect((await imports.list()).map(s=>s.id)).toEqual([session.id]);expect((await f.workspace.read()).book.website.assets[0].id).toBe(session.id);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('older imports remain selectable with keyboard paging while processing completes',async({page})=>{
 test.setTimeout(60000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-media-pages-')),f=await encryptedFixture(directory,sampleNotebook()),imports=new MediaImports(f.workspace);let oldest;
 for(let i=0;i<23;i++){const session=await imports.start({name:'study-'+String(i).padStart(2,'0')+'.svg',size:bytes.length,kind:'image'});if(i===0){oldest=session;await imports.receive(session.id,bytes);}}
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 try{
  await page.goto(app.url);await preferences(page,'Appearance');await page.getByRole('button',{name:'Logos & branding',exact:true}).click();await page.getByRole('button',{name:'Media imports',exact:true}).click();const dialog=page.locator('#dialog');
  await expect(dialog.locator('[data-media-import-row]')).toHaveCount(20);await expect(dialog).toContainText('study-22.svg');await expect(dialog).not.toContainText('study-00.svg');
  const older=dialog.getByRole('button',{name:'Older imports'});await older.focus();await page.keyboard.press('Enter');await expect(dialog.locator('[data-media-import-row]')).toHaveCount(3);await expect(dialog).toContainText('Page 2');await expect(older).toBeDisabled();
  const row=dialog.locator('[data-media-import-row="'+oldest.id+'"]');await row.getByRole('button',{name:'Prepare media'}).click();await expect(row.getByRole('button',{name:'Use media'})).toBeVisible({timeout:15000});await expect(dialog).toContainText('Page 2');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await expect(dialog.getByRole('button',{name:'Close',exact:true})).toBeInViewport();await page.screenshot({path:test.info().outputPath('media-pages-narrow.png')});
  await row.getByRole('button',{name:'Use media'}).click();await expect(page.locator('.logo-editor img')).toBeVisible();expect((await f.workspace.read()).book.branding).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
