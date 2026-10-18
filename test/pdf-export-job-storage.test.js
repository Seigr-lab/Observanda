import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mkdir,copyFile} from 'node:fs/promises';
import {fixture} from './project-domain-fixture.js';
import {PdfDocuments} from '../src/pdf-documents.js';
import {PdfDocumentStore} from '../src/pdf-document-store.js';
import {ProjectDomainCatalogue} from '../src/project-domain-catalogue.js';
import {projectDomainSchema} from '../src/project-domain-schema.js';
import {databaseSchemaSession} from '../src/database-schema-session.js';
import {projectDomainLock} from '../src/project-domain-lock.js';
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
import {PDF_ARCHIVAL_VALIDATOR_SHA256} from '../src/web/pdf-archival-model.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('durable PDF exports clean cancelled chunks transactionally and retain exact outputs through archive and fresh-key recovery',{timeout:180000},async t=>{
 const f=await fixture(t),documents=new PdfDocuments(f.storage,f.book.id),id=randomUUID(),jobId=randomUUID(),header={version:1,id,name:'Durable report',language:'en',direction:'ltr',layout:pdfLayoutPreset()},section={id:randomUUID(),title:'Evidence',content:'Pinned export contents',layout:null,start:null};
 const saved=await documents.change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header,section}}),bytes=Buffer.alloc(900000);for(let at=0;at<bytes.length;at++)bytes[at]=at%251;bytes.write('%PDF-1.7\n');
 const legacyOwner=await documents.domains.run(['pdf'],get=>get('pdf').object('owner'));assert.equal(Object.hasOwn(legacyOwner,'pdfFormat'),false);
 const rollbackId=randomUUID();await assert.rejects(documents.domains.run(['pdf'],async get=>{await new PdfDocumentStore(get('pdf')).change({id:rollbackId,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header:{...header,id:rollbackId,press:{version:1,bleedMm:3,cropMarks:true}},section}});assert.equal((await get('pdf').object('owner')).pdfFormat,2);throw new Error('rollback feature acquisition');},{write:['pdf']}),/rollback feature acquisition/);
 await documents.domains.run(['pdf'],async get=>{assert.deepEqual(await get('pdf').object('owner'),legacyOwner);assert.equal(await get('pdf').object('pdf:head:'+rollbackId),null);});
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
 // A synthetic receipt tests exact archival persistence, not PDF/A conformance.
 const archivalId=randomUUID(),archivalJobId=randomUUID(),archivalHeader={...header,id:archivalId,name:'Synthetic archival receipt fixture',outputProfile:'pdfa-2u'},archivalSaved=await documents.change({id:archivalId,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header:archivalHeader,section:{...section,id:randomUUID()}}}),archivalBytes=Buffer.from('%PDF-1.7\nSynthetic receipt persistence only; no conformance claim.\n'),validation={version:1,profile:'pdfa-2u',sha256:digest(archivalBytes),validator:'veraPDF',validatorVersion:'1.30.3',validatorSha256:PDF_ARCHIVAL_VALIDATOR_SHA256,passedRules:100,passedChecks:200},archivalJobs=new PdfExportJobs(documents,{prepare:async()=>({...output,bytes:archivalBytes,sha256:validation.sha256,validation})});
 assert.deepEqual(await documents.domains.run(['pdf'],get=>get('pdf').object('owner')),{...legacyOwner,pdfFormat:2});
 await archivalJobs.start({jobId:archivalJobId,documentId:archivalId,revision:archivalSaved.revision});assert.deepEqual((await archivalJobs.work(archivalJobId)).validation,validation);await documents.change({id:archivalId,commandId:randomUUID(),expectedRevision:archivalSaved.revision,operation:{type:'remove'}});assert.deepEqual((await archivalJobs.download(archivalJobId)).validation,validation);
 // Deliberately corrupt the authenticated owner through the fixture writer.
 // Each subsequent public operation must refuse it before entering its callback.
 await documents.domains.initialize(['calculator']);
 const restoreOwner=async(domain,owner)=>{const connection=await f.storage.openCatalogue(),session=databaseSchemaSession(connection);let store;try{await connection.run('BEGIN');await projectDomainLock(connection,'Observanda/project-domain/'+connection.id+'/'+domain);store=new ProjectDomainCatalogue(f.storage,session.schema(projectDomainSchema(connection.id,domain)),domain,f.book.id,{writable:true});await store.putObject('owner',owner);await connection.run('COMMIT');}finally{store?.close();session.close();await connection.close();}};
 for(const [domain,pdfFormat,code] of [['pdf',null,'CATALOGUE_DAMAGED'],['pdf',4,'ACCESS_UPGRADE'],['calculator',2,'CATALOGUE_DAMAGED']]){
  const original=await documents.domains.run([domain],get=>get(domain).object('owner'));await documents.domains.run([domain],get=>get(domain).putObject('owner',{...original,pdfFormat}),{write:[domain]});
  try{let called=false;await assert.rejects(documents.domains.run([domain],async get=>{called=true;await get(domain).putObject('must-not-exist',{});},{write:[domain]}),{code});assert.equal(called,false);}finally{await restoreOwner(domain,original);}
  assert.equal(await documents.domains.run([domain],get=>get(domain).object('must-not-exist')),null);
 }
 const descriptor=await f.storage.readFile(await workspaceFile(f.storage.root),'utf8');await verifyCatalogueArchive(f.storage,JSON.parse(descriptor));
 const archiveRoot=path.join(f.root,'pdf-export-archive');await mkdir(path.join(archiveRoot,'.observanda'),{recursive:true});for(const file of [path.basename(await workspaceFile(f.storage.root)),'.observanda/access.json'])await copyFile(path.join(f.storage.root,file),path.join(archiveRoot,file));
 const db=await f.storage.openCatalogue();try{await backupCatalogue(f.storage.root,archiveRoot,{connection:db});}finally{await db.close();}
 const archive=new ProjectStorage(archiveRoot,f.projectId,f.vault);await verifyCatalogueArchive(archive,JSON.parse(descriptor));const reopened=new PdfExportJobs(new PdfDocuments(archive,f.book.id));assert.deepEqual((await reopened.download(jobId)).bytes,bytes);assert.equal((await reopened.status(jobId)).revision,saved.revision);assert.deepEqual((await reopened.download(archivalJobId)).bytes,archivalBytes);assert.deepEqual((await reopened.download(archivalJobId)).validation,validation);assert.deepEqual((await reopened.status(archivalJobId)).validation,validation);
 const archiveDocuments=new PdfDocuments(archive,f.book.id);assert.deepEqual(await archiveDocuments.domains.run(['pdf'],get=>get('pdf').object('owner')),{...legacyOwner,pdfFormat:2});const retainedJob=await archiveDocuments.domains.run(['pdf'],get=>get('pdf').object('pdf-export:job:'+archivalJobId));await archiveDocuments.domains.run(['pdf'],get=>get('pdf').putObject('pdf-export:job:'+archivalJobId,{...retainedJob,output:{...retainedJob.output,validation:{...validation,passedChecks:201}}}),{write:['pdf']});await assert.rejects(verifyCatalogueArchive(archive,JSON.parse(descriptor)),{code:'CATALOGUE_DAMAGED'});await archiveDocuments.domains.run(['pdf'],get=>get('pdf').putObject('pdf-export:job:'+archivalJobId,retainedJob),{write:['pdf']});await verifyCatalogueArchive(archive,JSON.parse(descriptor));
 const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(f.root,'pdf-export-recovery-device')})),vault=takeCreatedVault(access);
 try{const target=new ProjectStorage(path.join(f.root,'pdf-export-rekeyed'),f.projectId,vault);await mkdir(path.join(target.root,'.observanda'),{recursive:true});await atomicWrite(path.join(target.root,'.observanda/access.json'),serialize(access));await target.writeFile(await workspaceFile(target.root,{secure:true}),descriptor);await rekeyCatalogue(f.storage,target,JSON.parse(descriptor));await verifyCatalogueArchive(target,JSON.parse(descriptor));const recoveredDocuments=new PdfDocuments(target,f.book.id);assert.deepEqual(await recoveredDocuments.domains.run(['pdf'],get=>get('pdf').object('owner')),{...legacyOwner,vaultId:vault.id,pdfFormat:2});const recovered=new PdfExportJobs(recoveredDocuments);assert.deepEqual((await recovered.download(jobId)).bytes,bytes);assert.deepEqual((await recovered.download(jobId)).renderer,output.renderer);assert.equal((await recovered.status(jobId)).attempt,2);assert.deepEqual((await recovered.download(archivalJobId)).bytes,archivalBytes);assert.deepEqual((await recovered.download(archivalJobId)).validation,validation);assert.deepEqual((await recovered.status(archivalJobId)).validation,validation);}finally{clearVault(vault);}
});
