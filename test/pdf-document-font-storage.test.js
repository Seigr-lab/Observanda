import {executePdfRequest} from '../src/pdf-document-requests.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mkdir,copyFile,readFile} from 'node:fs/promises';
import {fixture} from './project-domain-fixture.js';
import {PdfDocuments} from '../src/pdf-documents.js';
import {PdfDocumentStore} from '../src/pdf-document-store.js';
import {preparePdfFont,retainPdfDocumentFont,readPdfDocumentFont} from '../src/pdf-document-fonts.js';
import {WorkspaceFonts} from '../src/workspace-fonts.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {compilePdfDocument} from '../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../src/pdf-font-assets.js';
import {ProjectStorage} from '../src/project-storage.js';
import {workspaceFile,atomicWrite,serialize} from '../src/storage.js';
import {backupCatalogue} from '../src/postgres.js';
import {verifyCatalogueArchive,rekeyCatalogue} from '../src/research-catalogue.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {TestDeviceStore} from './device-fixture.js';

async function renderInput(documents,id,revision){
 return documents.domains.run(['pdf'],async get=>{
  const store=get('pdf'),owner=new PdfDocumentStore(store),selected=await owner.open(id,{revision}),customFonts=new Map();
  for(const pin of selected.header.fonts??[])customFonts.set(pin.id,await readPdfDocumentFont(store,id,pin));
  return embedPdfFonts(await compilePdfDocument(selected.header,owner.content(id,revision)),{customFonts});
 });
}

test('retained PDF custom fonts survive source removal, historical editions, archive reopen and fresh-key recovery', {timeout:180000},async t=>{
 const f=await fixture(t),documents=new PdfDocuments(f.storage,f.book.id),id=randomUUID(),section={id:randomUUID(),title:'Observation',content:'Retained exact custom font',layout:null,start:null};
 const bytes=await readFile(new URL('../src/fonts/atkinson.ttf',import.meta.url)),library=new WorkspaceFonts(f.storage),font=await library.import(bytes,{embed:true});
 let prepared;const researchWriter=await f.storage.openCatalogue();
 try{await researchWriter.run('BEGIN');await researchWriter.lock();prepared=await preparePdfFont(f.storage,font.id);}
 finally{await researchWriter.run('ROLLBACK');await researchWriter.close();}
 const header={version:1,id,name:'Portable retained font',language:'en',direction:'ltr',layout:{...pdfLayoutPreset(),font:font.id}};
 await documents.domains.initialize(['pdf']);
 const saved=await documents.domains.run(['pdf'],async get=>{
  const store=get('pdf'),pin=await retainPdfDocumentFont(store,id,prepared);header.fonts=[pin];
  return new PdfDocumentStore(store).change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header,section}});
 },{write:['pdf']});
 const first=await renderInput(documents,id,saved.revision);assert.ok(first.html.includes(bytes.toString('base64')));
 const request={pdf:'font-retain'},input={workspaceId:f.book.id,id,commandId:randomUUID(),expectedRevision:saved.revision,fontId:font.id};
 const retained=await executePdfRequest(f.storage,request,input);assert.equal(retained.revision,saved.revision);
 // The old edition must no longer consult the source font library at all.
 await f.storage.withLock(async()=>{await f.storage.writeMetadata('.observanda/fonts/library.json','[]');await f.storage.removeMetadata('.observanda/fonts/'+font.id+'.json');});
 await assert.rejects(library.get(font.id),{code:'FONT_MISSING'});
 assert.deepEqual(await executePdfRequest(f.storage,request,input),{revision:retained.revision,replayed:true});
 await assert.rejects(executePdfRequest(f.storage,request,{...input,fontId:'custom-'+'f'.repeat(64)}),{code:'MODULE_REPLAY'});
 assert.equal((await renderInput(documents,id,saved.revision)).html,first.html);
 const changed=await documents.change({id,commandId:randomUUID(),expectedRevision:saved.revision,operation:{type:'header',header:{...header,name:'Bundled current edition',layout:pdfLayoutPreset(),fonts:[]}}});
 assert.equal((await renderInput(documents,id,saved.revision)).html,first.html);assert.notEqual(changed.revision,saved.revision);
 // A missing historical font is not excused because the current edition uses
 // a bundled font. The intentional mutation remains inside a rolled-back tx.
 await assert.rejects(documents.domains.run(['pdf'],async get=>{
  const store=get('pdf'),key='pdf-font:value:'+id+':'+header.fonts[0].revision,value=await store.object(key);await store.putObject(key,{...value,size:value.size+1});await new PdfDocumentStore(store).verify();
 },{write:['pdf']}),{code:'CATALOGUE_DAMAGED'});
 const descriptor=await f.storage.readFile(await workspaceFile(f.storage.root),'utf8');await verifyCatalogueArchive(f.storage,JSON.parse(descriptor));
 const archiveRoot=path.join(f.root,'font-archive');await mkdir(path.join(archiveRoot,'.observanda'),{recursive:true});
 for(const file of [path.basename(await workspaceFile(f.storage.root)),'.observanda/access.json'])await copyFile(path.join(f.storage.root,file),path.join(archiveRoot,file));
 const db=await f.storage.openCatalogue();try{await backupCatalogue(f.storage.root,archiveRoot,{connection:db});}finally{await db.close();}
 const archive=new ProjectStorage(archiveRoot,f.projectId,f.vault);await verifyCatalogueArchive(archive,JSON.parse(descriptor));assert.equal((await renderInput(new PdfDocuments(archive,f.book.id),id,saved.revision)).html,first.html);
 const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(f.root,'font-recovery-device')})),vault=takeCreatedVault(access);
 try{
  const target=new ProjectStorage(path.join(f.root,'font-rekeyed'),f.projectId,vault);await mkdir(path.join(target.root,'.observanda'),{recursive:true});await atomicWrite(path.join(target.root,'.observanda/access.json'),serialize(access));await target.writeFile(await workspaceFile(target.root,{secure:true}),descriptor);
  await rekeyCatalogue(f.storage,target,JSON.parse(descriptor));await verifyCatalogueArchive(target,JSON.parse(descriptor));
  const reopened=new PdfDocuments(target,f.book.id);assert.equal((await renderInput(reopened,id,saved.revision)).html,first.html);assert.deepEqual(await reopened.read('history',{id}),await documents.read('history',{id}));assert.equal((await reopened.read('open',{id})).revision,changed.revision);
 }finally{clearVault(vault);}
});
