import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './project-domain-fixture.js';
import {PdfDocuments} from '../src/pdf-documents.js';
import {PdfDocumentStore} from '../src/pdf-document-store.js';
import {PdfDocumentImages,preparePdfImage} from '../src/pdf-document-images.js';
import {preparePdfBleedImage,pdfBleedImageBytes} from '../src/pdf-bleed-artwork.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {ProjectStorage} from '../src/project-storage.js';
import {backupCatalogue} from '../src/postgres.js';
import {workspaceFile} from '../src/storage.js';
import {verifyCatalogueArchive} from '../src/research-catalogue.js';
import {bleedPicture} from './fixtures/pdf-bleed-image.js';
async function image(documents,id,revision){return documents.domains.run(['pdf'],async get=>{const store=get('pdf'),saved=await new PdfDocumentStore(store).open(id,{revision});return {press:saved.header.press,image:await preparePdfBleedImage(saved.header.press,asset=>new PdfDocumentImages(store,id).read(asset))};});}
test('decorative bleed keeps document-owned image bytes and historical pins through archive reopening',{timeout:120000},async t=>{
 const f=await fixture(t),documents=new PdfDocuments(f.storage,f.book.id),id=randomUUID(),header={version:1,id,name:'Retained decorative background',language:'en',direction:'ltr',layout:pdfLayoutPreset()},section={id:randomUUID(),title:'Original content',content:'Exact retained source',layout:null,start:null};
 const first=await documents.change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header,section}}),prepared=await preparePdfImage(bleedPicture().content),asset=await documents.domains.run(['pdf'],get=>new PdfDocumentImages(get('pdf'),id).retain(prepared),{write:['pdf']});
 const press={version:2,bleedMm:4,cropMarks:true,artwork:{background:'#eeeeee',image:{asset:asset.asset,crop:{x:100,y:25}},pages:'first'}},command={id,commandId:randomUUID(),expectedRevision:first.revision,operation:{type:'header',header:{...header,press}}},saved=await documents.change(command);assert.deepEqual(await documents.change(command),{...saved,replayed:true});
 const selected=await image(documents,id,saved.revision),expected=pdfBleedImageBytes(press,selected.image);assert.equal(selected.image.asset,asset.asset);assert.deepEqual(selected.press,press);
 await assert.rejects(documents.change({...command,commandId:randomUUID(),expectedRevision:saved.revision,operation:{type:'header',header:{...header,press:{...press,artwork:{...press.artwork,image:{asset:'f'.repeat(64),crop:{x:0,y:0}}}}}}}),{code:'NOT_FOUND'});assert.equal((await documents.read('open',{id})).revision,saved.revision);
 const secondId=randomUUID();await assert.rejects(documents.change({id:secondId,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header:{...header,id:secondId,press},section:{...section,id:randomUUID()}}}),{code:'NOT_FOUND'});
 await documents.change({id,commandId:randomUUID(),expectedRevision:saved.revision,operation:{type:'header',header}});assert.equal((await image(documents,id,(await documents.read('open',{id})).revision)).image,undefined);assert.deepEqual(pdfBleedImageBytes(press,(await image(documents,id,saved.revision)).image),expected);assert.equal((await documents.read('verify')).documents,1);
 const descriptor=await f.storage.readFile(await workspaceFile(f.storage.root),'utf8'),archiveRoot=path.join(f.root,'archive');await mkdir(path.join(archiveRoot,'.observanda'),{recursive:true});for(const file of [path.basename(await workspaceFile(f.storage.root)),'.observanda/access.json'])await copyFile(path.join(f.storage.root,file),path.join(archiveRoot,file));const db=await f.storage.openCatalogue();try{await backupCatalogue(f.storage.root,archiveRoot,{connection:db});}finally{await db.close();}
 const archive=new ProjectStorage(archiveRoot,f.projectId,f.vault);await verifyCatalogueArchive(archive,JSON.parse(descriptor));const restored=await image(new PdfDocuments(archive,f.book.id),id,saved.revision);assert.deepEqual(restored,selected);assert.deepEqual(pdfBleedImageBytes(press,restored.image),expected);
});
