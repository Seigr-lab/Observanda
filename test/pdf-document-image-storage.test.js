import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mkdir,copyFile,readFile} from 'node:fs/promises';
import {fixture} from './project-domain-fixture.js';
import {PdfDocuments} from '../src/pdf-documents.js';
import {PdfDocumentStore} from '../src/pdf-document-store.js';
import {PdfDocumentImages,preparePdfImage} from '../src/pdf-document-images.js';
import {pdfImagePlacement} from '../src/web/pdf-image-model.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {compilePdfDocument} from '../src/pdf-document-renderer.js';
import {ProjectStorage} from '../src/project-storage.js';
import {workspaceFile,atomicWrite,serialize} from '../src/storage.js';
import {backupCatalogue} from '../src/postgres.js';
import {verifyCatalogueArchive,rekeyCatalogue} from '../src/research-catalogue.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {TestDeviceStore} from './device-fixture.js';
async function renderInput(documents,id,revision){return documents.domains.run(['pdf'],async get=>{const raw=get('pdf'),owner=new PdfDocumentStore(raw),selected=await owner.open(id,{revision});return compilePdfDocument(selected.header,owner.content(id,revision),{readImage:asset=>new PdfDocumentImages(raw,id).read(asset)});});}

test('document-bound PDF images retain historical rendering through archive and fresh-key recovery',{timeout:180000},async t=>{
 const f=await fixture(t),documents=new PdfDocuments(f.storage,f.book.id),id=randomUUID(),section={id:randomUUID(),title:'Selected image',content:'Exact retained illustration.',layout:null,start:null},header={version:1,id,name:'Portable image report',language:'en',direction:'ltr',layout:pdfLayoutPreset()};
 const prepared=await preparePdfImage(await readFile(new URL('../src/preview-assets/image.png',import.meta.url))),initial=await documents.change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header,section}});
 const saved=await documents.domains.run(['pdf'],async get=>{
  const store=get('pdf'),asset=await new PdfDocumentImages(store,id).retain(prepared);section.images=[pdfImagePlacement(asset,{id:randomUUID(),alt:'Synthetic retained picture',caption:'Exact image caption',block:1,widthMm:75})];
  return new PdfDocumentStore(store).change({id,commandId:randomUUID(),expectedRevision:initial.revision,operation:{type:'section',section}});
 },{write:['pdf']});
 const first=await renderInput(documents,id,saved.revision);assert.match(first.html,/data:image\/png;base64,/);assert.ok(first.html.includes('Exact image caption'));
 const otherId=randomUUID();await assert.rejects(documents.change({id:otherId,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header:{...header,id:otherId,name:'Other document'},section:{...section,id:randomUUID()}}}),{code:'NOT_FOUND'});
 assert.equal((await documents.read('list')).items.length,1);
 const changed=await documents.change({id,commandId:randomUUID(),expectedRevision:saved.revision,operation:{type:'section',section:{...section,images:[]}}});assert.ok(!(await renderInput(documents,id,changed.revision)).html.includes('data:image/png;base64,'));assert.equal((await renderInput(documents,id,saved.revision)).html,first.html);
 await assert.rejects(documents.domains.run(['pdf'],async get=>{const store=get('pdf');await store.deleteObject('pdf:image:'+id+':'+prepared.asset);await new PdfDocumentStore(store).verify();},{write:['pdf']}),{code:'CATALOGUE_DAMAGED'});
 assert.equal((await renderInput(documents,id,saved.revision)).html,first.html);
 const descriptor=await f.storage.readFile(await workspaceFile(f.storage.root),'utf8');await verifyCatalogueArchive(f.storage,JSON.parse(descriptor));
 const archiveRoot=path.join(f.root,'image-archive');await mkdir(path.join(archiveRoot,'.observanda'),{recursive:true});for(const file of [path.basename(await workspaceFile(f.storage.root)),'.observanda/access.json'])await copyFile(path.join(f.storage.root,file),path.join(archiveRoot,file));
 const db=await f.storage.openCatalogue();try{await backupCatalogue(f.storage.root,archiveRoot,{connection:db});}finally{await db.close();}
 const archive=new ProjectStorage(archiveRoot,f.projectId,f.vault);await verifyCatalogueArchive(archive,JSON.parse(descriptor));assert.equal((await renderInput(new PdfDocuments(archive,f.book.id),id,saved.revision)).html,first.html);
 const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(f.root,'image-recovery-device')})),vault=takeCreatedVault(access);
 try{
  const target=new ProjectStorage(path.join(f.root,'image-rekeyed'),f.projectId,vault);await mkdir(path.join(target.root,'.observanda'),{recursive:true});await atomicWrite(path.join(target.root,'.observanda/access.json'),serialize(access));await target.writeFile(await workspaceFile(target.root,{secure:true}),descriptor);
  await rekeyCatalogue(f.storage,target,JSON.parse(descriptor));await verifyCatalogueArchive(target,JSON.parse(descriptor));const reopened=new PdfDocuments(target,f.book.id);
  assert.equal((await renderInput(reopened,id,saved.revision)).html,first.html);assert.deepEqual(await reopened.read('history',{id}),await documents.read('history',{id}));assert.equal((await reopened.read('open',{id})).revision,changed.revision);
 }finally{clearVault(vault);}
});
