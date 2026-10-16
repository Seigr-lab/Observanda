import {defaultEditionRecord} from '../src/web/publication-selection.js';
import {AnalysisPublicationReview} from '../src/analysis-publication-review.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID as id} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {privateDirectory,digest,serialize} from '../src/storage.js';
import {recordRevision,ResearchRecords} from '../src/research.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {MediaStore} from '../src/media.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectApplication} from '../src/project-application.js';
import {publicationSourceReader} from '../src/project-publication-sources.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {readPublicationRecord} from '../src/publication-input.js';
import {contentBuffer} from '../src/file-content.js';
import {researchReference} from '../src/web/research-reference.js';
import {publicationText} from './publication-fixture.js';

test('a combined edition pins explicit owners once and renders their copied identities after access closes',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-publication-owners-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:id(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[];let application;const recordMethod=ResearchCatalogue.prototype.record;
 try{
  const host=sampleNotebook();host.entries=[];host.notebooks=[];host.projects=[];
  const f=await encryptedFixture(directory,host);keys.push(f.vault);const registry=new ProjectRegistry(f.workspace,host.id),client={},template=sampleNotebook(),mediaId=id(),one=structuredClone(template),two=structuredClone(template);
  one.id=id();two.id=id();two.projects[0].id=id();two.notebooks[0].projectId=two.projects[0].id;
  one.title=one.projects[0].title='First project';two.title=two.projects[0].title='Second project';
  for(const [book,label] of [[one,'First'],[two,'Second']]){
   book.entries=[book.entries[0],book.entries[2]];const record=book.entries[0];record.title=label+' selected observation';record.attachments=[{id:mediaId,kind:'image',share:true,caption:label+' image',alt:label+' observation',transcript:''}];record.body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:label+' pinned content'}]},{type:'book_figure',attrs:{version:1,id:id(),figureId:mediaId,alternative:'Observation image'}}]};
   book.entries[1].title='WITHHELD_'+label+'_RECORD';book.entries[1].body='WITHHELD_'+label+'_BODY';
  }
  one.entries[0].sections=[{id:id(),title:'Chosen conditions',body:'Selected conditions'},{id:id(),title:'WITHHELD_SECTION',body:'WITHHELD_SECTION_BODY'}];
  one.entries[0].relations=[{id:id(),type:'Related to',label:'Selected observation',target:{workspaceId:two.id,kind:'record',id:two.entries[0].id,selector:{version:1,kind:'figure',id:mediaId}}}];
  const owners=[];
  for(const [book,password,asset] of [[one,'','image.png'],[two,'Separate project password','logo.png']]){
   const access=await createWorkspaceAccess('',password,f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);const storage=await initializeProjectLocation(path.join(f.workspace.root,book.title),book.projects[0].id,{...book,entries:[]},access,vault);
   const bytes=await readFile(new URL('../src/preview-assets/'+asset,import.meta.url)),folder=await privateDirectory(storage.root,'.observanda/media/'+mediaId),metadata={id:mediaId,kind:'image',extension:'png',mime:'image/png',bytes:bytes.length,sha256:digest(bytes),originalBytes:bytes.length,originalSha256:digest(bytes)};
   await storage.writeFile(path.join(folder,'asset.json'),serialize(metadata));await storage.writeFile(path.join(folder,'public.png'),bytes);await storage.writeFile(path.join(folder,'original'),bytes);
   await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:book.id,changes:book.entries.map(record=>({id:record.id,expectedRevision:null,record}))});await registry.attach(storage,{expected:(await registry.read()).revision});book.entries[0]=await storage.catalogue(async store=>store.record(book.entries[0].id,(await store.member(await store.snapshot(),book.entries[0].id)).revision));owners.push({storage,bytes});
  }
  application=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore});
  const sources=[one,two].map(book=>({workspaceId:book.id,projectIds:[book.projects[0].id],selection:{defaultShare:false,includeProjects:[],records:[{id:book.entries[0].id,share:true,attachments:[]}]}}));
  const choice=defaultEditionRecord(one.entries[0],recordRevision(one.entries[0]));choice.sections=[one.entries[0].sections[0].id];sources[0].edition={version:1,records:[choice]};
  const releases=new PublicationJobs(f.workspace,{sources,sourceReader:options=>publicationSourceReader(application,client,{workspaceId:host.id,...options})}),command={workspaceId:host.id,etag:(await f.workspace.outline()).etag};
  await assert.rejects(f.workspace.withLock(()=>releases.pin(command)),error=>{if(!['ACCESS_LOCKED','DEVICE_UNKNOWN'].includes(error.code))throw error;return error.projectId===two.projects[0].id;});
  await application.unlock(client,two.projects[0].id,{password:'Separate project password'});
  const loaded=[];ResearchCatalogue.prototype.record=function(recordId,...args){loaded.push(recordId);return recordMethod.call(this,recordId,...args);};
  const pinned=await f.workspace.withLock(()=>releases.pin(command));ResearchCatalogue.prototype.record=recordMethod;
  assert.deepEqual(loaded,[one.entries[0].id,two.entries[0].id]);assert.equal(pinned.records.length,2);assert.equal(pinned.retainedMedia.length,2);assert.equal(new Set(pinned.records.map(row=>row.id)).size,2);assert.equal(new Set(pinned.retainedMedia.map(row=>row.id)).size,2);assert.equal(pinned.researchReview.references.count,0);
  for(const [index,book] of [one,two].entries())assert.deepEqual(await readPublicationRecord(f.workspace,pinned,pinned.records[index]),book.entries[0]);
  const review=new AnalysisPublicationReview(f.workspace,{sourceReader:options=>publicationSourceReader(application,client,{workspaceId:host.id,...options})});await review.fresh(pinned);await assert.rejects(new AnalysisPublicationReview(f.workspace).fresh(pinned),{code:'ACCESS_LOCKED'});
  const revision=recordRevision(one.entries[0]),changed={...one.entries[0],title:'Later research title'};await new ResearchRecords(owners[0].storage,new MediaStore(owners[0].storage)).save({workspaceId:one.id,changes:[{id:changed.id,expectedRevision:revision,record:changed}]});
  await assert.rejects(review.fresh(pinned),{code:'STALE'});
  await application.close();application=null;owners.forEach(owner=>clearVault(owner.storage.vault));
  const resumed=new PublicationJobs(f.workspace),job={id:pinned.id,lease:{token:id()}},candidate=await resumed.prepare(job,{signal:new AbortController().signal,progress:async()=>{}});await f.workspace.withLock(()=>resumed.commit(job,candidate));
  const result=await resumed.read(candidate.reviewId),text=await publicationText(result);assert.match(text,/First pinned content/);assert.match(text,/Second pinned content/);assert.ok(!text.includes('Later research title'));assert.ok(!text.includes('WITHHELD_'));assert.ok(!text.includes(one.id));assert.ok(!text.includes(two.id));
  for(const [index,owner] of owners.entries()){const media=pinned.records[index].media[0].id;assert.deepEqual(await contentBuffer(result.files.get('media/'+media+'.png')),owner.bytes);}
  const firstPage=(await contentBuffer(result.files.get('entries/'+pinned.records[0].id+'.html'))).toString();assert.ok(firstPage.includes(pinned.records[1].id+'.html#record-figure-'+pinned.records[1].media[0].id));assert.ok(!firstPage.includes(researchReference(one.entries[0].relations[0].target)));
 }finally{ResearchCatalogue.prototype.record=recordMethod;await application?.close();await runtime.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-publication-owners-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
