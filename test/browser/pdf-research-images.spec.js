import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {PdfDocumentImages} from '../../src/pdf-document-images.js';
import {PdfDocumentStore} from '../../src/pdf-document-store.js';
import {executePdfRequest,pdfDocumentRequest} from '../../src/pdf-document-requests.js';
import {readPdfResearchImages,retainPdfResearchImage,verifyPdfResearchImages} from '../../src/pdf-research-images.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {PublicationConversion} from '../../src/publication-conversion.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {MediaStore} from '../../src/media.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {navigate} from './preferences-helper.js';
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
function comment(png){const value=Buffer.from('Comment\0private-camera-marker'),chunk=Buffer.alloc(value.length+12);chunk.writeUInt32BE(value.length);chunk.write('tEXt',4);value.copy(chunk,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);return Buffer.concat([png.subarray(0,-12),chunk,png.subarray(-12)]);}

test('PDF author inserts permitted pixels and a remote withdrawal refreshes its placement and open preview',async({page,browser})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-source-images-')),book=sampleNotebook();book.title='workspace';book.entries[0].share=false;book.entries[0].sharePdf=false;book.notebooks.find(value=>value.id===book.entries[0].notebookId).sharePdf=true;
 const f=await encryptedFixture(directory,book),workspaceId=(await f.workspace.outline()).metadata.id,media=new MediaStore(f.workspace),records=new ResearchRecords(f.workspace,media),files=new WebsiteFileStore(f.workspace),conversion=new PublicationConversion(f.workspace,{store:files}),documents=new PdfDocuments(f.workspace,workspaceId,{publicationFiles:files}),pixels=comment(await readFile(new URL('../../src/preview-assets/image.png',import.meta.url))),asset=await media.import(pixels,'image'),recordId=book.entries[0].id,errors=[],commands=[],rendered=[];
 const currentRecord=()=>f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),recordId);return store.record(row.id,row.revision);});
 const editSource=async edit=>{const record=await currentRecord(),expectedRevision=recordRevision(record);edit(record);const data={workspaceId,changes:[{id:recordId,expectedRevision,record}]};await conversion.mutate(f.workspace,{route:'/api/research/records/save',data},()=>records.save(data));return record;};
 const record=await editSource(record=>{record.sharePdf=true;record.attachments.push({...asset,alt:'Retained image choice',caption:'Private caption marker',transcript:'',share:false,sharePdf:true});});
 const removeRenderer=installPdfRenderer(async input=>{const view=await browser.newPage();try{await view.route('**/*',route=>route.abort());await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);rendered.push({html:input.html,images:await view.locator('img').evaluateAll(images=>images.map(image=>({alt:image.alt,caption:image.closest('figure')?.querySelector('figcaption')?.textContent??''})))});const preflight=await view.evaluate(measurePdfPreflight),bytes=await view.pdf({preferCSSPageSize:true,printBackground:true});return {bytes,preflight,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};}finally{await view.close();}});
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().endsWith('/api/pdf/source-image-retain'))commands.push(request.postDataJSON());});
 try{
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name:'New document',exact:true}).click();await expect(page).toHaveURL(/#\/modules\/pdf-editor\/[a-f0-9-]{36}$/);const id=new URL(page.url()).hash.split('/').at(-1),sectionId=(await documents.read('sections',{id})).items[0].id;
  const chooseRecord=async()=>{await ui.getByRole('button',{name:'Add research',exact:true}).click();await ui.getByLabel('Search record titles').fill(record.title);await ui.getByRole('button',{name:'Search',exact:true}).click();await ui.locator('.pdf-source-list').getByRole('button',{name:record.title,exact:true}).click();};
  await chooseRecord();await ui.getByRole('button',{name:'Image attachments',exact:true}).click();await ui.getByRole('button',{name:'Retained image choice',exact:true}).click();await ui.getByRole('button',{name:'Add selected image',exact:true}).click();await expect(page.locator('#notice')).toContainText('Describe the image before adding it.');expect(commands).toHaveLength(0);
  await ui.locator('[data-pdf-source-image-field="alt"]').fill('Selected research image');await ui.locator('[data-pdf-source-image-field="caption"]').fill('Author-approved observation');await ui.getByRole('button',{name:'Add selected image',exact:true}).click();await expect(ui).toHaveAttribute('aria-busy','false');await expect(ui.locator('[data-pdf-image]')).toHaveCount(1);
  const {workspaceId:_,...firstCommand}=commands[0],first=(await documents.read('section',{id,sectionId})).section.images[0];expect(first.asset).toMatch(/^[a-f0-9]{64}$/);expect(first.alt).toBe('Selected research image');expect(firstCommand.source.collection).toBe('attachments');const savedRevision=await f.workspace.catalogue(async store=>(await store.member(await store.snapshot(),recordId)).revision);expect(firstCommand.source.recordRevision).toBe(savedRevision);expect((await retainPdfResearchImage(documents,files,firstCommand)).replayed).toBe(true);await assert.rejects(retainPdfResearchImage(documents,files,{...firstCommand,caption:'Different request'}),{code:'MODULE_REPLAY'});
  await chooseRecord();await expect(ui.getByRole('button',{name:'Evidence image files',exact:true})).toHaveCount(0);
  const imageInputs={sourceId:workspaceId,snapshotId:firstCommand.source.snapshotId,recordId,collection:'artifacts',offset:0,cursor:null};expect((await readPdfResearchImages(files,imageInputs)).items).toEqual([]);

  const stored=await documents.domains.run(['pdf'],async get=>{const store=get('pdf'),receipt=await store.object('pdf-source-image:'+id+':'+firstCommand.imageId),image=await new PdfDocumentImages(store,id).read(first.asset);expect((await verifyPdfResearchImages(store)).images).toBe(1);return {receipt,image};});expect(stored.receipt.command.source).toEqual(firstCommand.source);expect(stored.image.content.includes(Buffer.from('private-camera-marker'))).toBe(false);expect(JSON.stringify(stored.receipt)).not.toContain('unexported-evidence-name');expect((await documents.read('verify')).documents).toBe(1);
  await page.reload();await expect(ui.locator('[data-pdf-image]')).toHaveCount(1);const downloadEvent=page.waitForEvent('download',{timeout:45000});await ui.getByRole('button',{name:'Download PDF',exact:true}).click();const download=await downloadEvent;expect((await readFile(await download.path())).subarray(0,5).toString()).toBe('%PDF-');expect(rendered.at(-1).images).toEqual([{alt:'Selected research image',caption:'Author-approved observation'}]);for(const forbidden of ['Private caption marker','Retained image choice','unexported-evidence-name','private-camera-marker',firstCommand.source.recordRevision])expect(rendered.at(-1).html).not.toContain(forbidden);await ui.locator('[data-command="preview"]').click();const frame=ui.locator('[data-pdf-preview] iframe');await expect(frame).toHaveAttribute('src',/^blob:/);const oldPreview=await frame.getAttribute('src');expect(await page.evaluate(()=>document.visibilityState)).toBe('visible');
  const sourceReads=[],observe=request=>{const route=new URL(request.url()).pathname;if(['/api/pdf/section','/api/pdf/sections','/api/workspace/read/version'].includes(route))sourceReads.push(route);};
  page.on('request',observe);await page.waitForResponse(response=>response.url().endsWith('/api/website-files/pdf-version'),{timeout:10000});page.off('request',observe);expect(sourceReads).toEqual([]);
  const copiedId=randomUUID(),head=await documents.read('open',{id});
  const details=await documents.libraryDetails({id,revision:head.revision,cursor:null});
  expect(details.exported.item).toMatchObject({state:'completed',revision:head.revision});expect(details.protected).toBe(true);
  const copyCommand={id:copiedId,commandId:randomUUID(),expectedRevision:null,operation:{type:'duplicate',id,expectedRevision:head.revision,name:'Image permissions copy'}};
  const interrupted={...copyCommand,id:randomUUID(),commandId:randomUUID()};
  await assert.rejects(documents.domains.run(['pdf'],get=>new PdfDocumentStore(get('pdf')).change(interrupted,{publicationFiles:files,check:()=>{throw Error('Copy interrupted before saving');}}),{write:['pdf']}),/Copy interrupted before saving/);
  await documents.domains.run(['pdf'],async get=>{
   const store=get('pdf');
   for(const key of ['pdf:head:'+interrupted.id,'pdf:image:'+interrupted.id+':'+first.asset,'pdf-copy-image:'+interrupted.id+':'+first.id,'pdf:command:'+interrupted.id+':'+interrupted.commandId])expect(await store.object(key)).toBeNull();
  });
  const copyResult=await documents.change(copyCommand);
  expect(await documents.change(copyCommand)).toEqual({revision:copyResult.revision,replayed:true});
  const copiedSection=(await documents.read('sections',{id:copiedId})).items[0].id;
  expect(copiedSection).not.toBe(sectionId);
  expect((await documents.read('section',{id:copiedId,sectionId:copiedSection})).section.images[0]).toEqual(first);
  const libraryPage=await page.context().newPage();await libraryPage.goto(app.url);await navigate(libraryPage,'PDF editor');
  const library=libraryPage.locator('[data-pdf-editor]'),copyRow=library.locator('[data-library-item="'+copiedId+'"]');
  await copyRow.getByRole('button',{name:'Details',exact:true}).click();await expect(copyRow.locator('.pdf-library-detail ul')).toBeVisible();
  await expect(copyRow.locator('.pdf-library-detail')).toContainText('No PDF exports yet.');
  await copyRow.getByRole('button',{name:'Image permissions copy',exact:true}).click();
  const downloadCopy=libraryPage.waitForEvent('download',{timeout:45000});
  await library.getByRole('button',{name:'Download PDF',exact:true}).click();
  const reader=getDocument({data:new Uint8Array(await readFile(await (await downloadCopy).path())),useSystemFonts:true}),pdf=await reader.promise;
  try{
   let text='';for(let number=1;number<=pdf.numPages;number++)text+=(await (await pdf.getPage(number)).getTextContent()).items.map(item=>item.str).join(' ');
   expect(text).toContain('Author-approved observation');expect(text).not.toContain('Private caption marker');
  }finally{await reader.destroy();}
  await library.getByRole('button',{name:'Documents',exact:true}).click();await copyRow.getByRole('button',{name:'Details',exact:true}).click();
  await expect(copyRow.locator('.pdf-library-detail')).toContainText('Ready to download');
  await documents.domains.run(['pdf'],async get=>{
   const owner=get('pdf');expect((await new PdfDocumentImages(owner,copiedId).read(first.asset)).content).toEqual(stored.image.content);
   expect((await verifyPdfResearchImages(owner)).images).toBe(2);
  });
  const layoutTab=await page.context().newPage();await layoutTab.goto(app.url);await navigate(layoutTab,'PDF editor');
  const layoutUI=layoutTab.locator('[data-pdf-editor]');
  await layoutUI.locator('[data-library-item="'+copiedId+'"]').getByRole('button',{name:'Image permissions copy',exact:true}).click();
  const advanced=layoutUI.locator('[data-disclosure="pdf-section-options"]');await advanced.locator(':scope > summary').click();
  const canvasEditor=layoutUI.locator('[data-pdf-composition-editor]');await canvasEditor.locator(':scope > summary').click();
  await canvasEditor.getByRole('combobox',{name:'Layout mode',exact:true}).selectOption('page');
  await expect(canvasEditor.locator('[data-pdf-proof-status]')).toContainText('Saved PDF content area',{timeout:20000});
  await canvasEditor.locator('[data-pdf-composition-handle^="image:"]').first().dblclick();
  await expect(layoutUI.getByRole('dialog')).toBeVisible();
  const measured=await documents.read('open',{id:copiedId});
  // This independent writer has no renderer, BroadcastChannel or focus event.
  // The foreground PDF editor must observe only the file generation change.
  await editSource(record=>{record.attachments[0].sharePdf=false;});await expect(ui.locator('[data-pdf-image]')).toHaveCount(0,{timeout:15000});await expect(frame).toHaveAttribute('src',/^blob:/);await expect(frame).not.toHaveAttribute('src',oldPreview);expect(rendered.at(-1).images).toEqual([]);expect((await documents.read('section',{id,sectionId})).section.images??[]).toEqual([]);expect(errors).toEqual([]);
  await expect(copyRow.locator('.pdf-library-detail')).toHaveCount(0,{timeout:15000});
  expect((await documents.read('section',{id:copiedId,sectionId:copiedSection})).section.images).toEqual([]);
  await assert.rejects(executePdfRequest(f.workspace,pdfDocumentRequest('/api/pdf/image-read'),{workspaceId,id:copiedId,asset:first.asset},{publicationFiles:files,binary:()=>assert.fail('A withdrawn asset was delivered')}),{code:'PDF_SOURCE_CONTENT'});
  await expect(canvasEditor.locator('[data-pdf-composition-proof]')).toBeHidden({timeout:15000});
  await expect(layoutUI.getByRole('dialog')).toHaveCount(0);
  await expect(canvasEditor.locator('[data-pdf-composition-handle^="image:"]')).toHaveCount(0);
  await assert.rejects(executePdfRequest(f.workspace,pdfDocumentRequest('/api/pdf/composition-proof'),{workspaceId,id:copiedId,sectionId:copiedSection,revision:measured.revision},{publicationFiles:files,binary:()=>assert.fail('A withdrawn layout proof was delivered')}),error=>['PDF_COMPOSITION_STALE','PDF_PLACEMENT_REVIEW'].includes(error.code));
  await layoutTab.close();
  await libraryPage.close();
 }finally{await app.close();removeRenderer();await clearVault(f.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-source-images-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
