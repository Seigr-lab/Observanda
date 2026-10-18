import {executePdfRequest,pdfDocumentRequest} from '../src/pdf-document-requests.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mkdir,copyFile} from 'node:fs/promises';
import {fixture} from './project-domain-fixture.js';
import {makePdfPrinterProfile} from './fixtures/pdf-icc.js';
import {PdfDocuments} from '../src/pdf-documents.js';
import {PdfDocumentStore} from '../src/pdf-document-store.js';
import {PdfPrintProfiles} from '../src/pdf-print-profiles.js';
import {retainPdfPrintProfile} from '../src/pdf-print-profile-requests.js';
import {prepareSavedPdf} from '../src/pdf-export-service.js';
import {installPdfRenderer} from '../src/pdf-render-service.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {digest,serialize} from '../src/storage-format.js';
import {ProjectStorage} from '../src/project-storage.js';
import {copyProjectLocation} from '../src/project-transfer.js';
import {workspaceFile,atomicWrite} from '../src/storage.js';
import {backupCatalogue} from '../src/postgres.js';
import {verifyCatalogueArchive,rekeyCatalogue} from '../src/research-catalogue.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {TestDeviceStore} from './device-fixture.js';
import {AppError} from '../src/errors.js';

async function inventory(documents){return documents.domains.run(['pdf'],async get=>{const rows=[],store=get('pdf');for await(const id of store.objectIdEntries(''))rows.push([id,digest(serialize(await store.object(id)))]);return rows;});}
async function compiled(documents,documentId,revision){let input;const remove=installPdfRenderer(async value=>{input=value;return {compiled:true};});try{assert.deepEqual(await prepareSavedPdf(documents,{documentId,revision}),{compiled:true});return input;}finally{remove();}}

// Synthetic ICC tables qualify exact retention and transport, not the colour
// accuracy of a real printer. This case does not claim a PDF/X profile.
test('retained printer profiles import atomically, bind command retries and preserve historical payloads through copy and recovery',{timeout:180000},async t=>{
 const f=await fixture(t),documents=new PdfDocuments(f.storage,f.book.id),id=randomUUID(),header={version:1,id,name:'Retained printer condition',language:'en',direction:'ltr',layout:pdfLayoutPreset()},section={id:randomUUID(),title:'Evidence',content:'Synthetic output-profile transport.',layout:null,start:null},initial=await documents.change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header,section}}),rgb=makePdfPrinterProfile({colorSpace:'RGB'}),cmyk=makePdfPrinterProfile({colorSpace:'CMYK'}),route=pdfDocumentRequest('/api/pdf/print-profile-import'),input={id,commandId:randomUUID(),expectedRevision:initial.revision,bytes:rgb.toString('base64'),label:'Synthetic RGB paper',renderingIntent:'relative-colorimetric'},request=data=>executePdfRequest(f.storage,route,{workspaceId:f.book.id,...data});
 assert.equal(route.write,true);const before=await inventory(documents);
 await assert.rejects(request({...input,bytes:rgb.subarray(0,128).toString('base64')}),{code:'PDF_PRINT_PROFILE'});assert.deepEqual(await inventory(documents),before);
 await assert.rejects(request({...input,label:''}),{code:'INVALID'});assert.deepEqual(await inventory(documents),before);
 await assert.rejects(executePdfRequest(f.storage,route,{workspaceId:f.book.id,...input},{check:async()=>{throw new AppError('ACCESS_LOCKED');}}),{code:'ACCESS_LOCKED'});assert.deepEqual(await inventory(documents),before);
 const faulted={available:()=>documents.available(),domains:{run:(domains,operation,options)=>documents.domains.run(domains,async get=>{await operation(get);assert.equal((await get('pdf').object('owner')).pdfFormat,3);throw new Error('rollback retained profile');},options)}};
 await assert.rejects(retainPdfPrintProfile(faulted,input),/rollback retained profile/);assert.deepEqual(await inventory(documents),before);
 const saved=await request(input),selected=await documents.read('open',{id,revision:saved.revision}),condition=selected.header.printCondition;assert.equal(condition.profile.sha256,digest(rgb));assert.equal(condition.label,input.label);assert.equal(condition.renderingIntent,input.renderingIntent);assert.equal((await documents.domains.run(['pdf'],get=>get('pdf').object('owner'))).pdfFormat,3);
 await documents.domains.run(['pdf'],async get=>{const profiles=new PdfPrintProfiles(get('pdf'),id),descriptor=await profiles.descriptor(condition.profile);assert.equal(descriptor.colorSpace,'RGB');assert.equal(descriptor.channels,3);assert.equal(descriptor.size,rgb.length);assert.deepEqual(await profiles.read(condition.profile),rgb);});
 assert.deepEqual(await request(input),{revision:saved.revision,replayed:true,printCondition:condition});const retained=await inventory(documents);
 for(const change of [{label:'Changed retry'},{bytes:cmyk.toString('base64')},{renderingIntent:'perceptual'}]){await assert.rejects(request({...input,...change}),{code:'MODULE_REPLAY'});assert.deepEqual(await inventory(documents),retained);}
 await assert.rejects(request({...input,commandId:randomUUID(),bytes:cmyk.toString('base64')}),{code:'CONFLICT'});assert.deepEqual(await inventory(documents),retained);
 const another=randomUUID();await assert.rejects(documents.change({id:another,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header:{...header,id:another,printCondition:condition},section:{...section,id:randomUUID()}}}),{code:'CATALOGUE_DAMAGED'});assert.deepEqual(await inventory(documents),retained);
 await assert.rejects(documents.change({id,commandId:randomUUID(),expectedRevision:saved.revision,operation:{type:'header',header:{...selected.header,outputProfile:'pdfa-2u'}}}),{code:'INVALID'});
 const archivalId=randomUUID(),archival=await documents.change({id:archivalId,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header:{...header,id:archivalId,outputProfile:'pdfa-2u'},section:{...section,id:randomUUID()}}}),withArchival=await inventory(documents);await assert.rejects(request({...input,id:archivalId,commandId:randomUUID(),expectedRevision:archival.revision}),{code:'PDF_PRINT_CONFLICT'});assert.deepEqual(await inventory(documents),withArchival);
 const secondInput={...input,commandId:randomUUID(),expectedRevision:saved.revision,bytes:cmyk.toString('base64'),label:'Synthetic CMYK paper',renderingIntent:'perceptual'},second=await request(secondInput),secondHeader=(await documents.read('open',{id})).header;
 const plain=await documents.change({id,commandId:randomUUID(),expectedRevision:second.revision,operation:{type:'header',header}});assert.equal((await compiled(documents,id,plain.revision)).iccProfile,undefined);
 // Missing historical ICC bytes fail reverse verification even when the current
 // edition no longer selects any printer condition. The corruption rolls back.
 await assert.rejects(documents.domains.run(['pdf'],async get=>{const store=get('pdf');await store.deleteObject('pdf:print-profile:'+id+':'+condition.profile.revision);await new PdfDocumentStore(store).verify();},{write:['pdf']}),{code:'CATALOGUE_DAMAGED'});
 const restored=await documents.change({id,commandId:randomUUID(),expectedRevision:plain.revision,operation:{type:'restore',revision:saved.revision}});assert.equal(restored.revision,saved.revision);const now=await inventory(documents);assert.deepEqual(await request(input),{revision:saved.revision,replayed:true,printCondition:condition});assert.deepEqual(await inventory(documents),now);
 const rgbCompiled=await compiled(documents,id,saved.revision),cmykCompiled=await compiled(documents,id,second.revision);assert.deepEqual(rgbCompiled.printCondition,condition);assert.deepEqual(Buffer.from(rgbCompiled.iccProfile,'base64'),rgb);assert.deepEqual(cmykCompiled.printCondition,secondHeader.printCondition);assert.deepEqual(Buffer.from(cmykCompiled.iccProfile,'base64'),cmyk);
 const history=await documents.read('history',{id}),descriptor=await f.storage.readFile(await workspaceFile(f.storage.root),'utf8');await verifyCatalogueArchive(f.storage,JSON.parse(descriptor));
 async function checkCopy(storage){const copied=new PdfDocuments(storage,f.book.id);assert.equal((await copied.domains.run(['pdf'],get=>get('pdf').object('owner'))).pdfFormat,3);assert.deepEqual(await copied.read('history',{id}),history);assert.equal((await copied.read('open',{id})).revision,saved.revision);for(const [revision,expected,profile] of [[saved.revision,rgb,condition],[second.revision,cmyk,secondHeader.printCondition]]){const value=await compiled(copied,id,revision);assert.deepEqual(value.printCondition,profile);assert.deepEqual(Buffer.from(value.iccProfile,'base64'),expected);}await verifyCatalogueArchive(storage,JSON.parse(descriptor));return copied;}
 const destination=path.join(f.root,'printer-copy','project');await mkdir(path.dirname(destination));const copied=await copyProjectLocation(f.storage,destination,{id:randomUUID()});await checkCopy(copied);
 const archiveRoot=path.join(f.root,'printer-archive');await mkdir(path.join(archiveRoot,'.observanda'),{recursive:true});for(const file of [path.basename(await workspaceFile(f.storage.root)),'.observanda/access.json'])await copyFile(path.join(f.storage.root,file),path.join(archiveRoot,file));const db=await f.storage.openCatalogue();try{await backupCatalogue(f.storage.root,archiveRoot,{connection:db});}finally{await db.close();}await checkCopy(new ProjectStorage(archiveRoot,f.projectId,f.vault));
 const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(f.root,'printer-recovery-device')})),vault=takeCreatedVault(access);
 try{const target=new ProjectStorage(path.join(f.root,'printer-rekeyed'),f.projectId,vault);await mkdir(path.join(target.root,'.observanda'),{recursive:true});await atomicWrite(path.join(target.root,'.observanda/access.json'),serialize(access));await target.writeFile(await workspaceFile(target.root,{secure:true}),descriptor);await rekeyCatalogue(f.storage,target,JSON.parse(descriptor));await checkCopy(target);}finally{clearVault(vault);}
 assert.equal((await documents.read('open',{id})).revision,saved.revision);
});
