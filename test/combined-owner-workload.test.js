import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {AsyncLocalStorage} from 'node:async_hooks';
import {EventEmitter} from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {randomUUID as id} from 'node:crypto';
import {createNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {MediaStore} from '../src/media.js';
import {ProjectApplication} from '../src/project-application.js';
import {publicationSourceFactory} from '../src/project-publication-sources.js';
import {WebsiteSites} from '../src/website-sites.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {websitePreviewSource} from '../src/website-preview-source.js';
import {renderWebsitePreview} from '../src/website-preview.js';
import {WorkspaceFonts} from '../src/workspace-fonts.js';
import {contentBuffer} from '../src/file-content.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {publicationOwnerId} from '../src/publication-owner-identities.js';
import {emptyPublicationSource} from '../src/web/publication-sources-model.js';
import {newElement} from '../src/web/composition-tree.js';
import {requestWriterWait} from '../src/writer-wait.js';
import {ProjectModuleCommands} from '../src/project-module-commands.js';
import {ProjectDomains} from '../src/project-domains.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {inventoryOperationAccessFactory} from '../src/inventory-operation-access.js';
import {planningTaskAccessFactory} from '../src/planning-task-access.js';
import {readPlanningTask} from '../src/planning-task-reader.js';
import {assertInventoryObligationsSettled} from '../src/inventory-obligation-lifecycle.js';
import {blankBOM,bomLine} from '../src/web/modules/bom-model.js';

const edit=site=>({workspaceId:site.book.id,baseEtag:site.etag,metadata:{},projects:[],changes:[],removed:[],selection:site.site.selection});
const task=(dependencies=[],status='todo')=>({title:'Combined work',description:'',status,priority:'normal',dueOn:null,assignees:[],checklist:[],dependencies,links:[]});
const command=(owner,action,payload)=>({workspaceId:owner.entry.namespaceId,commandId:id(),action,payload});
function request(operation){
 const req={waitForWriter:true,checkWriter:async()=>{},socket:{timeout:60000,destroyed:false,setTimeout(){}}},res=new EventEmitter();res.setTimeout=()=>{};res.writableEnded=false;
 return requestWriterWait(req,res,operation);
}
const selected=(owner,domain,item)=>new ProjectDomains(owner.storage,owner.entry.namespaceId).run([domain],async access=>{const catalogue=new ModuleCatalogue(access(domain));return catalogue.selected(await catalogue.head(owner.entry.namespaceId),item);});

// Keep the published corpus fixed while only an unrelated owner's payload grows.
// Stock and task commands use the production authorized cross-owner readers.
test('full publication and selected authoring remain isolated from unrelated growth during cross-owner stock and task writes',{timeout:600000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-combined-owners-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:id(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[],scope=new AsyncLocalStorage();
 const original=ResearchCatalogue.prototype.record,documents=ResearchCatalogue.prototype.queryDocuments;let application,releaseBusy,busy;
 ResearchCatalogue.prototype.record=function(...args){const metrics=scope.getStore();if(metrics){metrics.originals++;assert.notEqual(this.workspace.root,metrics.unrelatedRoot);}return original.apply(this,args);};
 ResearchCatalogue.prototype.queryDocuments=async function*(...args){for await(const value of documents.apply(this,args)){const metrics=scope.getStore();if(metrics)metrics.derivatives++;yield value;}};
 try{
  const host=createNotebook('Combined workload'),fixture=await encryptedFixture(directory,host);keys.push(fixture.vault);
  const registry=new ProjectRegistry(fixture.workspace,host.id),addresses=new LabBookDirectory(registry),metadata=createNotebook('Research project'),projectId=id();metadata.projects=[{id:projectId,title:metadata.title,description:'',share:false,logoId:null}];
  const access=await createWorkspaceAccess('','',fixture.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
  const project=await initializeProjectLocation(path.join(fixture.workspace.root,metadata.title),projectId,metadata,access,vault);await registry.attach(project,{expected:(await registry.read()).revision});
  const books=[];
  for(const title of ['Selected measurements','Selected calculations','Unrelated observations']){
   const entry=(await new LabBookCreation(project,fixture.deviceStore,{publish:entry=>addresses.register(projectId,entry)}).create({id:id(),username:'',password:'',book:{id:id(),projectId,title}})).book,key=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:fixture.deviceStore});keys.push(key);
   const storage=new LabBookStorage(entry.root,entry.labBookId,key),commands=new ProjectModuleCommands(storage,entry.namespaceId);await commands.initialize();books.push({entry,title,storage,commands,records:[],research:new ResearchRecords(storage,new MediaStore(storage))});
  }
  application=new ProjectApplication(fixture.workspace,{deviceStore:fixture.deviceStore});const client={},measurements=[];
  const options=owner=>({inventorySourceAccess:inventoryOperationAccessFactory(application,client,{scope:projectId,labBookId:owner.entry.labBookId}),taskSourceAccess:planningTaskAccessFactory(application,client,{scope:projectId,labBookId:owner.entry.labBookId})});
  const sources=books.slice(0,2).map(book=>{const source=emptyPublicationSource(book.entry.namespaceId,book.entry.labBookId);source.projectIds=[projectId];source.selection.includeProjects=[projectId];return source;});
  const sites=new WebsiteSites(fixture.workspace),ids=[];
  for(const name of ['Complete journal','Independent report'])ids.push((await sites.change({workspaceId:host.id,etag:(await fixture.workspace.outline()).etag,operation:'create',name})).id);
  async function grow(book,count){
   const added=Array.from({length:count-book.records.length},(_,index)=>({...structuredClone(sampleNotebook().entries[0]),id:id(),notebookId:book.entry.labBookId,title:book.title+' '+(book.records.length+index),body:'Observation text '.repeat(512),share:true,attachments:[],figures:[],relations:[],sections:[]}));
   if(added.length)await book.research.save({workspaceId:book.entry.namespaceId,changes:added.map(record=>({id:record.id,expectedRevision:null,record}))},{receipt:true});book.records.push(...added);
  }
  for(const book of books.slice(0,2))await grow(book,360);
  for(const [index,siteId] of ids.entries()){
   const site=await sites.read(siteId),draft=edit(site),selectedSources=structuredClone(sources);
   if(index)for(const [owner,source] of selectedSources.entries())source.selection={defaultShare:false,includeProjects:[],records:[{id:books[owner].records[0].id,share:true,attachments:[]}]};
   draft.metadata.website={...site.book.website,researchSources:selectedSources,footer:index?'Independent report':'Complete journal',home:{...site.book.website.home,enabled:true,sections:[newElement('records',id)]}};await sites.save(siteId,draft);
  }
  const resourceId=id(),sourceTask=id();
  for(const owner of books.slice(0,2))await owner.commands.execute(command(owner,'resource.create',{id:resourceId,data:{projectId:null,placementId:null,name:'Exact material',code:resourceId,kind:'material',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'items',capacity:1,status:'available',links:[]},openingStock:{quantity:'10',projectId:null}}));
  await books[1].commands.execute(command(books[1],'task.save',{id:sourceTask,expectedRevision:null,data:task([],'done')}));
  const sourceRef={workspaceId:books[1].entry.namespaceId,type:'task',id:sourceTask},sourceFact=await readPlanningTask(books[1].storage,sourceRef);
  for(const count of [80,800]){
   await grow(books[2],count);
   const bomId=id(),foreign={workspaceId:books[1].entry.namespaceId,type:'resource',id:resourceId},lines=[{...bomLine(),value:'Local part',resourceId,quantity:'2'},{...bomLine(),value:'Foreign part',resourceId:foreign,quantity:'3'}];
   await books[0].commands.execute(command(books[0],'bom.save',{id:bomId,expectedRevision:null,data:{...blankBOM(),title:'Combined build '+count,recordId:books[0].records[0].id,lines}}),options(books[0]));
   const resources=await Promise.all(books.slice(0,2).map(async(owner,index)=>({id:index?foreign:resourceId,revision:(await selected(owner,'inventory',resourceId)).revision})));
   const metrics={unrelatedRecords:count,selectedRecords:720,queries:0,sourceUses:0,originals:0,derivatives:0,unrelatedRoot:books[2].storage.root},storages=ids.map(siteId=>websiteWorkspace(fixture.workspace,siteId));
   const journal=await sites.read(ids[0]),report=await sites.read(ids[1]),base=publicationSourceFactory(application,client,storages[0]);
   const sourceReader=async opts=>{const reader=await base(opts);return {...reader,use:async(sourceId,snapshotId,consume,readOptions)=>{assert.notEqual(sourceId,books[2].entry.namespaceId);metrics.sourceUses++;return reader.use(sourceId,snapshotId,async(store,...args)=>{const run=store.db.run;store.db.run=function(...args){metrics.queries++;return run.apply(this,args);};try{return await consume(store,...args);}finally{store.db.run=run;}},readOptions);}};};
   let admitted;const entered=new Promise(resolve=>admitted=resolve),held=new Promise(resolve=>releaseBusy=resolve);busy=books[2].storage.withLock(async()=>{admitted();await held;});await entered;
   const controller=new AbortController(),timer=setTimeout(()=>{controller.abort();releaseBusy();},180000);timer.unref();let editionFinished=false;
   let captureEntered;const capturing=new Promise(resolve=>captureEntered=resolve);
   const captureReader=async opts=>{const reader=await base(opts);return {...reader,use:(sourceId,snapshotId,consume,readOptions)=>reader.use(sourceId,snapshotId,(...args)=>{captureEntered();return consume(...args);},readOptions)};};
   captureReader.materialAccess=base.materialAccess;
   const started=performance.now(),preparing=request(()=>new PublicationJobs(storages[0],{sourceReader:captureReader}).inline({etag:journal.etag},{signal:controller.signal}));
   preparing.finally(()=>{editionFinished=true;}).catch(()=>{});
   const measured=async(name,fn)=>{assert.equal(editionFinished,false);const at=performance.now(),value=await request(fn);metrics[name]=Math.round(performance.now()-at);assert.equal(editionFinished,false,'Foreground operation did not overlap publication');return value;};
   try{
    // Begin foreground work only after the edition is reading an authorized
    // source snapshot, not merely waiting for publication admission.
    await Promise.race([capturing,preparing.then(()=>{throw Error('Publication completed without entering source capture');})]);
    const results=await Promise.allSettled([
     preparing,
     scope.run(metrics,()=>measured('previewMs',async()=>{const preview=await websitePreviewSource(storages[0],edit(journal),{designTarget:'entry:'+publicationOwnerId(host.id,sources[0].workspaceId,'record',books[0].records[0].id),sourceReader,signal:controller.signal});const candidate=await renderWebsitePreview(preview.context,{designTarget:'entry:'+publicationOwnerId(host.id,sources[0].workspaceId,'record',books[0].records[0].id),media:preview.media,fonts:new WorkspaceFonts(storages[0]),signal:controller.signal});const html=(await contentBuffer(candidate.files.get(candidate.defaultPage))).toString();assert.match(html,/Complete journal/);assert.equal(preview.context.entries.length,1);metrics.responseBytes=Buffer.byteLength(JSON.stringify({context:preview.context,editor:preview.editor}));return preview;})),
     measured('authoringMs',async()=>{const owner=books[1],current=await owner.storage.catalogue(async store=>{const row=await store.member(await store.snapshot(),owner.records[1].id);return store.record(row.id,row.revision);}),record={...current,body:'Independent amendment '+count};await owner.research.save({workspaceId:owner.entry.namespaceId,changes:[{id:record.id,expectedRevision:recordRevision(current),record}]},{receipt:true});owner.records[1]=record;}),
     measured('settingsMs',async()=>{const draft=edit(report);draft.metadata.website={...report.book.website,footer:'Settings during full edition '+count};await sites.save(ids[1],draft);}),
     measured('stockMs',async()=>{const reserve=command(books[0],'bom.reserve',{id:bomId,expectedRevision:1,resources}),reserved=await books[0].commands.execute(reserve,options(books[0]));assert.equal(reserved.operationPending,undefined,JSON.stringify(reserved.operation));assert.equal(reserved.entities[0].data.status,'reserved');const finish=command(books[0],'bom.finish',{id:bomId,expectedRevision:2,usage:lines.map(line=>({lineId:line.id,used:'0.5',scrapped:'0.25'}))}),finished=await books[0].commands.execute(finish,options(books[0]));assert.equal(finished.entities[0].data.status,'finished');assert.equal((await books[0].commands.execute(finish,options(books[0]))).replayed,true);for(const allocation of finished.entities[0].data.allocations){const owner=books.find(book=>book.entry.namespaceId===allocation.workspaceId),reservation=await selected(owner,'inventory',allocation.reservationId);assert.equal(reservation.revision,2);assert.deepEqual([reservation.data.managed.settlement.used,reservation.data.managed.settlement.scrapped],['0.5','0.25']);}}),
     measured('taskMs',async()=>{const saved=await books[0].commands.execute(command(books[0],'task.save',{id:id(),expectedRevision:null,data:task([sourceRef],'done')}),options(books[0]));assert.equal(saved.entities[0].data.status,'done');const observed=saved.entities[0].data.prerequisiteObservations;assert.equal(observed.length,1);assert.deepEqual(observed[0].reference,sourceRef);assert.equal(observed[0].hash,sourceFact.hash);assert.equal(observed[0].constraintHash,sourceFact.constraintHash);})
    ]);
    metrics.elapsedMs=Math.round(performance.now()-started);delete metrics.unrelatedRoot;t.diagnostic(JSON.stringify(metrics));
    for(const [index,result] of results.entries())if(result.status==='rejected')t.diagnostic(JSON.stringify({task:index,code:result.reason.code,message:result.reason.message}));
    for(const result of results)if(result.status==='rejected')throw result.reason;
    assert.equal(results[0].value.entries.length,720);assert.equal(controller.signal.aborted,false);assert.ok(metrics.elapsedMs<180000,'Full selected publication exceeded three minutes');
    for(const name of ['previewMs','authoringMs','settingsMs'])assert.ok(metrics[name]<5000,name+' exceeded five seconds');
    assert.equal(metrics.originals,1);assert.equal(metrics.derivatives,6);assert.ok(metrics.sourceUses<30);assert.ok(metrics.queries<500);assert.ok(metrics.responseBytes<65536);
    assert.equal((await sites.read(ids[1])).book.website.footer,'Settings during full edition '+count);assert.equal((await sites.read(ids[0])).book.website.footer,'Complete journal');
    assert.deepEqual(await readPlanningTask(books[1].storage,sourceRef),sourceFact);
    for(const owner of books.slice(0,2))await assertInventoryObligationsSettled(owner.storage);
    measurements.push(metrics);
   }finally{clearTimeout(timer);controller.abort();releaseBusy();await busy;busy=null;await preparing.catch(()=>{});}
  }
  assert.equal(measurements[1].sourceUses,measurements[0].sourceUses);assert.equal(measurements[1].originals,measurements[0].originals);assert.equal(measurements[1].derivatives,measurements[0].derivatives);assert.ok(measurements[1].queries<measurements[0].queries*2,'Unrelated growth increased selected read work');
 }finally{releaseBusy?.();await busy;ResearchCatalogue.prototype.record=original;ResearchCatalogue.prototype.queryDocuments=documents;await application?.close();await runtime.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-combined-owners-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
