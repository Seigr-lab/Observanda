import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {deflateRawSync,crc32} from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

function zip(entries){
 const locals=[],central=[];let offset=0;
 for(const [name,value] of entries){
  const bytes=Buffer.from(value),packed=deflateRawSync(bytes),file=Buffer.from(name),crc=crc32(bytes);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(file.length,26);
  const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(8,10);record.writeUInt32LE(crc,16);record.writeUInt32LE(packed.length,20);record.writeUInt32LE(bytes.length,24);record.writeUInt16LE(file.length,28);record.writeUInt32LE(offset,42);
  locals.push(local,file,packed);central.push(record,file);offset+=local.length+file.length+packed.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,directory,end]);
}
const page=(title,body='')=>'<!doctype html><html lang="en"><head><title>'+title+'</title><link rel="stylesheet" href="style.css"></head><body><main><h1>'+title+'</h1>'+body+'</main></body></html>';

async function workspace(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-import-'));
 const book=sampleNotebook();book.entries=[];const fixture=await encryptedFixture(directory,book);
 const store=new WebsiteFileStore(fixture.workspace),id=randomUUID();
 await store.importFiles(id,{name:'Existing atlas',files:new Map([['index.html',page('Existing atlas','<p>Working notes.</p>')],['style.css','body{margin:0}']])});
 const app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
 return {store,id,app,close:async()=>{try{await app.close();await clearVault(fixture.vault);}finally{await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});}}};
}

test('an author imports a website ZIP after correcting every listed file, then offers a paper for download',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const ws=await workspace();
 try{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(ws.app.url);await page.evaluate(hash=>location.hash=hash,'#/websites/'+ws.id+'/editor');
  const canvas=page.frameLocator('#website-files-canvas'),commands=page.locator('.website-page-controls');
  await expect(canvas.getByRole('heading',{name:'Existing atlas'})).toBeVisible();
  const before=(await ws.store.list({limit:100})).items.length;
  await commands.getByRole('button',{name:'New website',exact:true}).click();
  await page.getByLabel('Website name',{exact:true}).fill('Weather station');
  await page.getByRole('radio',{name:'A website ZIP file'}).check();
  await expect(page.getByText(/Research from your lab books is never copied/)).toBeVisible();
  const placed='<section data-observanda-source="'+'a'.repeat(64)+'" data-observanda-source-revision="'+'b'.repeat(64)+'"><p>Withheld assay</p></section>';
  await page.locator('[data-website-import-zip]').setInputFiles({name:'station.zip',mimeType:'application/zip',buffer:zip([['station/index.html',page('Weather station','\n<script>track()</script>')],['station/results.html',page('Results',placed)],['station/style.css','body{margin:0}']])});
  await page.getByRole('button',{name:'Import website',exact:true}).click();
  const problems=page.getByRole('alert').filter({hasText:'The website was not imported'});
  await expect(problems).toContainText('index.html, line 2');
  await expect(problems).toContainText('Only approved website scripts may run');
  await expect(problems).toContainText('This page contains research placed by Observanda');
  expect((await ws.store.list({limit:100})).items.length).toBe(before);
  await page.locator('[data-website-import-zip]').setInputFiles({name:'station.zip',mimeType:'application/zip',buffer:zip([['station/index.html',page('Weather station','<p>Hourly readings from the mast.</p>')],['station/style.css','body{margin:0}'],['station/.DS_Store','x']])});
  await page.getByRole('button',{name:'Import website',exact:true}).click();
  await expect(canvas.getByRole('heading',{name:'Weather station'})).toBeVisible();
  const imported=(await ws.store.list({limit:100})).items.find(site=>site.name==='Weather station');
  expect(imported).toBeTruthy();
  // Offer a paper for download from the new website.
  await canvas.getByText('Hourly readings from the mast.').click();
  await page.locator('[data-website-file-block]').selectOption('download');await page.getByRole('button',{name:'Insert element',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Download'});
  await expect(dialog).toContainText('Observanda cannot check its contents for private lab book information');
  await dialog.getByLabel('File',{exact:true}).setInputFiles({name:'Station paper.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7 station paper')});
  await expect(dialog.getByLabel('Link text')).toHaveValue('Station paper');
  await dialog.getByRole('button',{name:'Insert download link'}).click();await expect(dialog).toHaveCount(0);
  const link=canvas.getByRole('link',{name:'Station paper'});
  await expect(link).toHaveAttribute('href','downloads/Station-paper.pdf');
  const saved=await ws.store.open(imported.id);
  expect(saved.html).toContain('href="downloads/Station-paper.pdf"');
  const exported=await ws.store.export(imported.id,{expectedRevision:saved.site.revision});
  expect(exported.files.has('downloads/Station-paper.pdf')).toBe(true);
  expect(errors).toEqual([]);
 }finally{await page.close();await ws.close();}
});

test('a malformed legacy review address opens the standalone website editor',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(15000);
 const ws=await workspace();
 try{
  await page.goto(ws.app.url);await expect(page.locator('#main-navigation')).toBeVisible();
  await page.evaluate(()=>location.hash='#/review/not-a-review');
  await expect(page.locator('#website-files-canvas')).toBeVisible();
  await expect(page.locator('.website-toolbar')).toHaveCount(0);
  expect(page.url()).toMatch(/#\/website/);
 }finally{await page.close();await ws.close();}
});
