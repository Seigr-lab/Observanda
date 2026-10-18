import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mkdir,copyFile} from 'node:fs/promises';
import {fixture} from './project-domain-fixture.js';
import {PdfDocuments} from '../src/pdf-documents.js';
import {PdfExportJobs,verifyPdfExportJobs} from '../src/pdf-export-jobs.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {digest} from '../src/storage-format.js';
import {ProjectStorage} from '../src/project-storage.js';
import {workspaceFile,atomicWrite,serialize} from '../src/storage.js';
import {backupCatalogue} from '../src/postgres.js';
import {verifyCatalogueArchive,rekeyCatalogue} from '../src/research-catalogue.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {TestDeviceStore} from './device-fixture.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('durable PDF exports clean cancelled chunks transactionally and retain exact outputs through archive and fresh-key recovery',{timeout:180000},async t=>{
 const f=await fixture(t),documents=new PdfDocuments(f.storage,f.book.id),id=randomUUID(),jobId=randomUUID(),header={version:1,id,name:'Durable report',language:'en',direction:'ltr',layout:pdfLayoutPreset()},section={id:randomUUID(),title:'Evidence',content:'Pinned export contents',layout:null,start:null};
 const saved=await documents.change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header,section}}),bytes=Buffer.alloc(900000);for(let at=0;at<bytes.length;at++)bytes[at]=at%251;bytes.write('%PDF-1.7\n');
 const output={bytes,sha256:digest(bytes),renderer:{engine:'chromium',electron:'synthetic',chromium:'synthetic',recipeVersion:1},preflight:{version:1,status:'ok',findings:[],truncated:false}},entered=deferred(),release=deferred();let held=false;
 // Pause only after a real, committed bounded output transaction. Another
 // process instance must be able to cancel it without waiting for rendering.
 const wrapped={available:()=>documents.available(),domains:{run:async(domains,operation,options)=>{
  let captured=false;const result=await documents.domains.run(domains,get=>{const store=get('pdf'),put=store.putObject.bind(store);store.putObject=async(key,value)=>{if(key.startsWith('pdf-export:block:'+jobId+':1:'))captured=true;return put(key,value);};return operation(get);},options);
  if(captured&&!held){held=true;entered.resolve();await release.promise;}return result;
 }}};
 await documents.domains.run(['pdf'],async get=>{await get('pdf').putObject('unrelated:layout',{name:'Preserved layout'});await get('pdf').putObject('unrelated:receipt',{sequence:7});assert.deepEqual(await verifyPdfExportJobs(get('pdf')),{jobs:0,completed:0});},{write:['pdf']});
 const jobs=new PdfExportJobs(wrapped,{prepare:async pin=>{assert.deepEqual(pin,{documentId:id,revision:saved.revision});return output;},leaseMs:300000});await jobs.start({jobId,documentId:id,revision:saved.revision});const running=jobs.work(jobId);t.after(()=>release.resolve());await entered.promise;
 const prefix='pdf-export:block:'+jobId+':1:',partial=await documents.domains.run(['pdf'],async get=>{const keys=[];for await(const key of get('pdf').objectIdEntries(prefix))keys.push(key);return keys;});assert.ok(partial.length>=16);
 await assert.rejects(documents.domains.run(['pdf'],get=>get('pdf').deleteObject('unrelated:layout')),{code:'INVALID'});
 await assert.rejects(documents.domains.run(['pdf'],async get=>{const store=get('pdf');await store.deleteObject('unrelated:layout');assert.equal(await store.object('unrelated:layout'),null);await store.putObject('unrelated:temporary',{value:1});throw new Error('rollback selected deletion');},{write:['pdf']}),/rollback selected deletion/);
 const resumed=new PdfExportJobs(documents,{prepare:async()=>output});assert.equal((await resumed.cancel(jobId)).state,'cancelled');release.resolve();assert.equal((await running).state,'cancelled');
 await documents.domains.run(['pdf'],async get=>{const store=get('pdf');for await(const key of store.objectIdEntries(prefix))assert.fail('cancelled chunk remains: '+key);assert.deepEqual(await store.object('unrelated:layout'),{name:'Preserved layout'});assert.deepEqual(await store.object('unrelated:receipt'),{sequence:7});assert.equal(await store.object('unrelated:temporary'),null);assert.deepEqual(await verifyPdfExportJobs(store),{jobs:1,completed:0});for await(const row of store.verifiedObjects())assert.ok(row.id);});
 // Export work and downloads do not take the research writer. Authoring can
 // advance the current PDF edition independently of the retained request pin.
 const writer=await f.storage.openCatalogue();try{
  await writer.run('BEGIN');await writer.lock();await resumed.resume(jobId);assert.equal((await resumed.work(jobId)).state,'completed');
  await documents.change({id,commandId:randomUUID(),expectedRevision:saved.revision,operation:{type:'header',header:{...header,name:'New authoring edition'}}});assert.deepEqual((await resumed.download(jobId)).bytes,bytes);
 }finally{await writer.run('ROLLBACK');await writer.close();}
 const descriptor=await f.storage.readFile(await workspaceFile(f.storage.root),'utf8');await verifyCatalogueArchive(f.storage,JSON.parse(descriptor));
 const archiveRoot=path.join(f.root,'pdf-export-archive');await mkdir(path.join(archiveRoot,'.observanda'),{recursive:true});for(const file of [path.basename(await workspaceFile(f.storage.root)),'.observanda/access.json'])await copyFile(path.join(f.storage.root,file),path.join(archiveRoot,file));
 const db=await f.storage.openCatalogue();try{await backupCatalogue(f.storage.root,archiveRoot,{connection:db});}finally{await db.close();}
 const archive=new ProjectStorage(archiveRoot,f.projectId,f.vault);await verifyCatalogueArchive(archive,JSON.parse(descriptor));const reopened=new PdfExportJobs(new PdfDocuments(archive,f.book.id));assert.deepEqual((await reopened.download(jobId)).bytes,bytes);assert.equal((await reopened.status(jobId)).revision,saved.revision);
 const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(f.root,'pdf-export-recovery-device')})),vault=takeCreatedVault(access);
 try{const target=new ProjectStorage(path.join(f.root,'pdf-export-rekeyed'),f.projectId,vault);await mkdir(path.join(target.root,'.observanda'),{recursive:true});await atomicWrite(path.join(target.root,'.observanda/access.json'),serialize(access));await target.writeFile(await workspaceFile(target.root,{secure:true}),descriptor);await rekeyCatalogue(f.storage,target,JSON.parse(descriptor));await verifyCatalogueArchive(target,JSON.parse(descriptor));const recovered=new PdfExportJobs(new PdfDocuments(target,f.book.id));assert.deepEqual((await recovered.download(jobId)).bytes,bytes);assert.deepEqual((await recovered.download(jobId)).renderer,output.renderer);assert.equal((await recovered.status(jobId)).attempt,2);}finally{clearVault(vault);}
});
