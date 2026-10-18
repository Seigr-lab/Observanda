import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mkdir,copyFile} from 'node:fs/promises';
import {fixture} from './project-domain-fixture.js';
import {PdfDocuments} from '../src/pdf-documents.js';
import {PdfDocumentStore} from '../src/pdf-document-store.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {ProjectStorage} from '../src/project-storage.js';
import {workspaceFile,atomicWrite,serialize} from '../src/storage.js';
import {backupCatalogue} from '../src/postgres.js';
import {verifyCatalogueArchive,rekeyCatalogue} from '../src/research-catalogue.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {TestDeviceStore} from './device-fixture.js';

test('PDF documents save independently, roll back failed writes, and reopen from archives and fresh-key recovery', {timeout:180000},async t=>{
 const f=await fixture(t),documents=new PdfDocuments(f.storage,f.book.id),id=randomUUID(),section={id:randomUUID(),title:'Observation',content:'9007199254740993',layout:null,start:null};
 assert.deepEqual(await documents.read('list'),{items:[],next:null});assert.equal(await documents.available(),false);
 await assert.rejects(documents.change({id}),{code:'INVALID'});assert.equal(await documents.available(),false);
 const create={id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header:{version:1,id,name:'Portable report',language:'en',direction:'ltr',layout:pdfLayoutPreset()},section}},created=await documents.change(create);
 // Holding the research writer must not queue an ordinary PDF save.
 const lock=await f.storage.openCatalogue();let changed;
 try{await lock.run('BEGIN');await lock.lock();changed=await documents.change({id,commandId:randomUUID(),expectedRevision:created.revision,operation:{type:'section',section:{...section,content:'Updated observation'}}});}
 finally{await lock.run('ROLLBACK');await lock.close();}
 const command={id,commandId:randomUUID(),expectedRevision:changed.revision,operation:{type:'section',section:{...section,content:'Must roll back'}}};
 await assert.rejects(documents.domains.run(['pdf'],async get=>{await new PdfDocumentStore(get('pdf')).change(command);throw new Error('interrupted');},{write:['pdf']}),/interrupted/);
 assert.equal((await documents.read('section',{id,sectionId:section.id})).section.content,'Updated observation');
 const restored=await documents.change({id,commandId:randomUUID(),expectedRevision:changed.revision,operation:{type:'restore',revision:created.revision}});
 assert.equal(restored.revision,created.revision);assert.equal((await documents.read('history',{id})).items.length,3);
 await documents.change({id,commandId:randomUUID(),expectedRevision:restored.revision,operation:{type:'section',section}});assert.equal((await documents.read('history',{id})).items.length,3);
 const descriptor=await f.storage.readFile(await workspaceFile(f.storage.root),'utf8');await verifyCatalogueArchive(f.storage,JSON.parse(descriptor));
 const targetRoot=path.join(f.root,'pdf-archive');await mkdir(path.join(targetRoot,'.observanda'),{recursive:true});
 for(const file of [path.basename(await workspaceFile(f.storage.root)),'.observanda/access.json'])await copyFile(path.join(f.storage.root,file),path.join(targetRoot,file));
 const db=await f.storage.openCatalogue();try{await backupCatalogue(f.storage.root,targetRoot,{connection:db});}finally{await db.close();}
 const archive=new ProjectStorage(targetRoot,f.projectId,f.vault);await verifyCatalogueArchive(archive,JSON.parse(descriptor));
 assert.equal((await new PdfDocuments(archive,f.book.id).read('section',{id,sectionId:section.id})).section.content,section.content);
 const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(f.root,'fresh-device')})),vault=takeCreatedVault(access);
 try{
  const target=new ProjectStorage(path.join(f.root,'pdf-rekeyed'),f.projectId,vault);await mkdir(path.join(target.root,'.observanda'),{recursive:true});await atomicWrite(path.join(target.root,'.observanda/access.json'),serialize(access));await target.writeFile(await workspaceFile(target.root,{secure:true}),descriptor);
  await rekeyCatalogue(f.storage,target,JSON.parse(descriptor));await verifyCatalogueArchive(target,JSON.parse(descriptor));
  const reopened=new PdfDocuments(target,f.book.id);assert.deepEqual(await reopened.read('history',{id}),await documents.read('history',{id}));assert.equal((await reopened.read('section',{id,sectionId:section.id,revision:changed.revision})).section.content,'Updated observation');
  await reopened.change({id,commandId:randomUUID(),expectedRevision:created.revision,operation:{type:'header',header:{...create.operation.header,name:'Independent recovered report'}}});assert.equal((await documents.read('open',{id})).header.name,'Portable report');
 }finally{clearVault(vault);}
});
