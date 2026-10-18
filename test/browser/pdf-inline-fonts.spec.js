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
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {navigate} from './preferences-helper.js';

test('inline PDF custom fonts save atomically and reopen from retained bytes after library removal',async({page,browser})=>{
 test.setTimeout(120000);page.setDefaultTimeout(10000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-pdf-inline-')),f=await encryptedFixture(directory,sampleNotebook()),library=new WorkspaceFonts(f.workspace),bytes=await readFile(new URL('../../src/fonts/atkinson.ttf',import.meta.url)),font=await library.import(bytes,{embed:true}),local=await library.import(await readFile(new URL('../../src/fonts/amatic-sc.ttf',import.meta.url)),{embed:false}),restrictedBytes=Buffer.from(bytes);
 for(let i=0;i<restrictedBytes.readUInt16BE(4);i++){const at=12+i*16;if(restrictedBytes.toString('ascii',at,at+4)==='OS/2'){restrictedBytes.writeUInt16BE(2,restrictedBytes.readUInt32BE(at+8)+8);break;}}
 const restricted=await library.import(restrictedBytes,{embed:false}),workspaceId=(await f.workspace.outline()).metadata.id,documents=new PdfDocuments(f.workspace,workspaceId),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore}),errors=[],rendered=[];page.on('pageerror',error=>errors.push(error.message));
 const uninstall=installPdfRenderer(async input=>{const view=await browser.newPage();try{await view.emulateMedia({media:'print'});await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);const preflight=await view.evaluate(measurePdfPreflight),output=await view.pdf({preferCSSPageSize:true,printBackground:true});rendered.push({html:input.html,bytes:output.length});return {preflight,bytes:input.preflightOnly?null:output};}finally{await view.close();}});
 try{
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.locator('[data-command="new"]').click();await expect(page).toHaveURL(/#\/modules\/pdf-editor\/[a-f0-9-]{36}$/);const id=new URL(page.url()).hash.split('/').at(-1),editor=ui.getByRole('textbox',{name:'Content',exact:true}),sectionId=(await documents.read('sections',{id})).items[0].id,field=ui.locator('[data-document-key="'+sectionId+'"]');
  await editor.fill('Retained inline typography');await editor.press('ControlOrMeta+A');await field.getByText('More formatting',{exact:true}).click();const picker=field.locator('[data-rich-font]');expect(await picker.locator('option').evaluateAll(options=>options.map(option=>option.value))).toContain(font.id);for(const rejected of ['modern','editorial',local.id,restricted.id])expect(await picker.locator('option').evaluateAll(options=>options.map(option=>option.value))).not.toContain(rejected);
  await field.getByRole('combobox',{name:'Selected text font',exact:true}).click();const optionIndex=await picker.evaluate((select,id)=>[...select.options].filter(option=>!option.disabled).findIndex(option=>option.value===id),font.id);expect(optionIndex).toBeGreaterThan(-1);await field.locator('[role=option][data-index="'+optionIndex+'"]').click();await expect.poll(async()=> (await documents.read('open',{id})).header.fonts?.map(pin=>pin.id)).toEqual([font.id]);await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');
  const selected=await documents.read('open',{id});expect(JSON.stringify((await documents.read('section',{id,sectionId})).section.content)).toContain(font.id);
  await ui.locator('details').filter({has:page.locator('[data-pdf-header="name"]')}).locator(':scope > summary').click();await ui.getByLabel('Document name',{exact:true}).fill('Inline retained edition');await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');expect((await documents.read('open',{id})).header.fonts).toEqual(selected.header.fonts);
  await f.workspace.withLock(async()=>{await f.workspace.writeMetadata('.observanda/fonts/library.json','[]');for(const entry of [font,local,restricted])await f.workspace.removeMetadata('.observanda/fonts/'+entry.id+'.json');});
  const edition=(await documents.read('open',{id})).revision,response=page.waitForResponse(value=>value.url().endsWith('/api/pdf/font-read')&&value.status()===200&&value.request().postDataJSON()?.revision===edition);await page.reload();await expect(editor).toHaveText('Retained inline typography');
  await expect.poll(()=>page.evaluate(id=>[...document.fonts].some(face=>face.family==='Observanda '+id&&face.status==='loaded'),font.id)).toBe(true);const received=await response;expect(received.headers()['content-length']).toBe(String(bytes.length));
  // Inspect exact font bytes in the consuming browser, alongside its actual
  // retained FontFace load, rather than the DevTools font-body representation.
  const headers=Object.fromEntries(Object.entries(received.request().headers()).filter(([key])=>key.startsWith('x-observanda-')||key==='content-type')),actual=await page.evaluate(async({url,headers,body})=>{const response=await fetch(url,{method:'POST',headers,body}),bytes=await response.arrayBuffer();return {status:response.status,size:bytes.byteLength,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('')};},{url:received.url(),headers,body:received.request().postData()});expect(actual).toEqual({status:200,size:bytes.length,sha256:font.id.slice(7)});
  await ui.locator('[data-command="preview"]').click();await expect.poll(()=>rendered.length).toBeGreaterThan(0);expect(rendered.at(-1).bytes).toBeGreaterThan(1000);expect(rendered.at(-1).html).toContain(bytes.toString('base64'));expect(errors).toEqual([]);
 }finally{uninstall();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
