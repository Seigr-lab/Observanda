// Data written by a previous Observanda build must open, verify completely and
// stay editable in the current source. A separate process writes a broad
// workspace with the previous build's own code; this file reopens it here.
// OBSERVANDA_PREVIOUS_SERVICE names the previous build's service folder (the
// folder holding its src/, node_modules/ and package.json).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {TestDeviceStore} from './device-fixture.js';
import {seal,unseal,clearVault} from '../src/encryption.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {readAccess,verifyAccess} from '../src/access.js';
import {Workspace} from '../src/storage.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {catalogueDescriptor} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {workspaceModules} from '../src/modules/index.js';
import {ModuleReader} from '../src/modules/reader.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../src/security/dashboard-storage.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {PdfDocuments} from '../src/pdf-documents.js';

const previous=process.env.OBSERVANDA_PREVIOUS_SERVICE,writer=fileURLToPath(new URL('./upgrade/previous-build-writer.js',import.meta.url));
const skip=previous?false:'Set OBSERVANDA_PREVIOUS_SERVICE to the service folder of a previous Observanda build to run the upgrade test.';

function runWriter(work,signal){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[writer,path.resolve(previous),work],{env:process.env,stdio:['ignore','pipe','pipe'],windowsHide:true,signal:AbortSignal.any([signal,AbortSignal.timeout(1200000)])});
  const output=[],errors=[];child.stdout.on('data',bytes=>output.push(bytes));child.stderr.on('data',bytes=>errors.push(bytes));
  child.once('error',reject);
  child.once('close',code=>{
   const stderr=Buffer.concat(errors).toString('utf8');
   if(code!==0)return reject(Error('The previous build writer failed ('+code+'):\n'+stderr.slice(-8000)));
   const line=Buffer.concat(output).toString('utf8').trim().split(/\r?\n/).at(-1);
   try{resolve(JSON.parse(line));}catch{reject(Error('The previous build writer printed no result:\n'+stderr.slice(-8000)));}
  });
 });
}

// The current product's complete check of one catalogue owner, as the command line validates a workspace.
async function verifyCatalogue(storage){
 const {metadata}=await storage.outline();
 await storage.catalogue(store=>store.verify(catalogueDescriptor(metadata)));
 return metadata;
}

test('a workspace written by the previous build opens, verifies and stays editable in the current source',{skip,timeout:2400000},async t=>{
 const parent=path.resolve(os.tmpdir()),work=await mkdtemp(path.join(parent,'observanda-previous-build-upgrade-')),vaults=[];let runtime,detach;
 t.after(async()=>{
  await runtime?.close();detach?.();for(const vault of vaults)await clearVault(vault);await closeIdleMutationFiles();
  assert.equal(path.dirname(work),parent);assert.ok(path.basename(work).startsWith('observanda-previous-build-upgrade-'));
  await rm(work,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 });
 const written=await runWriter(work,t.signal),{root,deviceFile,ownerId,ids}=written;
 t.diagnostic('Previous build '+written.version+' wrote the workspace.');
 assert.equal(path.dirname(root),work);

 // The same device key, protected the same way, now read by the current code.
 let protector;
 if(process.platform!=='win32'){
  const secret=Buffer.from(await readFile(deviceFile+'.secret','utf8'),'hex');
  protector={available:()=>true,protect:async bytes=>seal(bytes,secret,'CI secret store'),unprotect:async bytes=>unseal(bytes,secret,'CI secret store')};
 }
 const deviceStore=new TestDeviceStore({file:deviceFile,...(protector?{protector}:{})});
 runtime=new WorkspaceDatabases({directory:path.join(work,'current-runtime'),ownerId,env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});detach=installDatabaseProvider(runtime);
 const unlock=async folder=>{const vault=await verifyAccess(await readAccess(folder),'','',{deviceStore});vaults.push(vault);return vault;};
 const ws=new Workspace(root,await unlock(root)),project=new ProjectStorage(ids.projectRoot,ids.projectId,await unlock(ids.projectRoot)),labBook=new LabBookStorage(ids.labBookRoot,ids.labBookId,await unlock(ids.labBookRoot));
 const verifyAll=async()=>{
  assert.equal((await verifyCatalogue(ws)).id,ids.workspaceId);
  assert.equal((await verifyCatalogue(project)).id,ids.projectNamespaceId);
  assert.equal((await verifyCatalogue(labBook)).id,ids.labBookNamespaceId);
 };
 await verifyAll();

 // Records, their sections, tags, relation and image.
 const book=(await ws.read()).book,find=id=>book.entries.find(entry=>entry.id===id);
 assert.equal(book.id,ids.workspaceId);for(const id of ids.sampleRecordIds)assert.ok(find(id),'Sample record '+id);
 const method=find(ids.methodRecordId),run=find(ids.runRecordId);
 assert.equal(method.title,'Upgrade method');assert.deepEqual(method.tags,['upgrade','method']);
 assert.equal(method.sections[0].id,ids.methodSectionId);assert.equal(method.sections[0].body,'Weigh the sample, record the mass, repeat.');
 assert.equal(method.attachments[0].id,ids.imageId);assert.equal((await new MediaStore(ws).metadata(ids.imageId)).metadata.kind,'image');
 assert.equal(run.relations[0].id,ids.relationId);assert.equal(run.relations[0].target.id,ids.methodRecordId);

 // Project and lab book directories.
 const registry=new ProjectRegistry(ws,ids.workspaceId);
 assert.equal(path.resolve((await registry.locate(ids.projectId)).root),path.resolve(ids.projectRoot));
 const address=await new LabBookDirectory(registry).read(ids.labBookNamespaceId);assert.equal(address.labBookId,ids.labBookId);assert.equal(address.projectId,ids.projectId);
 const books=new LabBookRegistry(project),row=await books.state(ids.labBookId);assert.equal(row.state,'active');assert.equal(path.resolve(books.location(row.entry).root),path.resolve(ids.labBookRoot));
 const labRecord=(await labBook.read()).book.entries.find(entry=>entry.id===ids.labBookRecordId);assert.equal(labRecord.title,'Lab book observation');

 // Datasets read back with the exact cells the previous build showed.
 const materials=new ResearchMaterials(ws);
 assert.equal((await materials.read(ids.dataset)).kind,'dataset');
 assert.deepEqual((await materials.datasetPage(ids.dataset,0)).rows.map(item=>item.cells),ids.datasetCells);
 assert.deepEqual((await materials.datasetPage(ids.derived,0)).rows.map(item=>item.cells),ids.derivedCells);
 assert.equal(ids.datasetCells.length,3);assert.equal(ids.derivedCells.length,2);

 // Module entities: inventory and laboratory.
 const reader=new ModuleReader(ws),selected=async id=>(await reader.selected({workspaceId:ids.workspaceId,id})).entity;
 const resource=await selected(ids.resourceId);assert.equal(resource.type,'resource');assert.equal(resource.data.name,'Upgrade reagent');
 const lab=await selected(ids.labSpaceId),sample=await selected(ids.sampleId),analysis=await selected(ids.analysisId);
 assert.equal(lab.data.name,'Upgrade laboratory');assert.equal(sample.data.values.mass,'12.5');assert.equal(analysis.data.values.result,'Within range');assert.equal(analysis.data.labId,ids.labSpaceId);

 // Dashboard, website and PDF document.
 const dashboard=await readWorkspaceDashboard(ws);assert.equal(dashboard.settings.views.find(view=>view.id===ids.dashboardViewId).name,'Upgrade dashboard');
 const sites=new WebsiteFileStore(ws),found=await sites.searchLibrary({search:'Upgrade source'});assert.deepEqual(found.items.map(item=>item.id),[ids.sourceId]);
 const site=await sites.open(ids.siteId);assert.match(site.html,/Retained source text/);assert.match(site.html,/Site introduction/);
 const documents=new PdfDocuments(project,ids.projectNamespaceId),opened=await documents.read('open',{id:ids.pdfDocumentId});
 assert.equal(opened.header.name,'Upgrade report');assert.equal(opened.revision,ids.pdfRevision);
 assert.equal((await documents.read('section',{id:ids.pdfDocumentId,sectionId:ids.pdfSectionId})).section.content,'Retained PDF text');

 // One write per area with the current code.
 const media=new MediaStore(ws);
 await new ResearchRecords(ws,media).save({workspaceId:ids.workspaceId,changes:[{id:run.id,expectedRevision:recordRevision(run),record:{...run,title:'Observation edited after upgrade'}}]});
 await new ResearchRecords(labBook,new MediaStore(labBook)).save({workspaceId:ids.labBookNamespaceId,changes:[{id:labRecord.id,expectedRevision:recordRevision(labRecord),record:{...labRecord,title:'Lab book record edited after upgrade'}}]});
 const counted=await materials.dataset({recordId:ids.runRecordId,title:'Counts after upgrade',aggregation:{version:1,source:ids.dataset,keys:[0],values:[{column:1,operation:'count',name:'Count'}],missing:'skip',note:''}});
 const execute=(action,payload)=>workspaceModules(ws).execute({workspaceId:ids.workspaceId,commandId:randomUUID(),action,payload});
 await execute('resource.save',{id:resource.id,expectedRevision:resource.revision,data:{...resource.data,name:'Reagent renamed after upgrade'}});
 await execute('lab-entry.save',{id:sample.id,expectedRevision:sample.revision,data:{...sample.data,notes:'Noted after upgrade'}});
 const settings=structuredClone(dashboard.settings);settings.views.find(view=>view.id===ids.dashboardViewId).name='Dashboard after upgrade';await writeWorkspaceDashboard(ws,settings,dashboard.etag);
 await sites.save(ids.siteId,{expectedRevision:site.site.revision,html:site.html.replace('Site introduction','Introduction edited after upgrade'),css:site.css??''});
 await documents.change({id:ids.pdfDocumentId,commandId:randomUUID(),expectedRevision:opened.revision,operation:{type:'section',section:{id:ids.pdfSectionId,title:'Observation',content:'PDF text edited after upgrade',layout:null,start:null}}});

 // The edits read back through the current readers, and every owner still verifies.
 const edited=(await ws.read()).book;assert.equal(edited.entries.find(entry=>entry.id===ids.runRecordId).title,'Observation edited after upgrade');assert.equal(edited.entries.find(entry=>entry.id===ids.methodRecordId).title,'Upgrade method');
 assert.equal((await labBook.read()).book.entries.find(entry=>entry.id===ids.labBookRecordId).title,'Lab book record edited after upgrade');
 assert.deepEqual((await materials.datasetPage(counted,0)).rows.map(item=>item.cells[0]),ids.derivedCells.map(cells=>cells[0]));
 assert.equal((await selected(ids.resourceId)).data.name,'Reagent renamed after upgrade');assert.equal((await selected(ids.sampleId)).data.notes,'Noted after upgrade');
 assert.equal((await readWorkspaceDashboard(ws)).settings.views.find(view=>view.id===ids.dashboardViewId).name,'Dashboard after upgrade');
 assert.match((await sites.open(ids.siteId)).html,/Introduction edited after upgrade/);
 assert.equal((await documents.read('section',{id:ids.pdfDocumentId,sectionId:ids.pdfSectionId})).section.content,'PDF text edited after upgrade');
 // A whole workspace save moves the previous build's workspace format to the current one.
 const saved=await ws.read();
 await ws.save({...saved.book,title:'Workspace saved after upgrade'},saved.etag);
 const upgraded=(await ws.read()).book;assert.equal(upgraded.formatVersion,22);assert.equal(upgraded.title,'Workspace saved after upgrade');
 await materials.verify();await documents.read('verify');
 await verifyAll();
});
