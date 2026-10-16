import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {AsyncLocalStorage} from 'node:async_hooks';
import {EventEmitter} from 'node:events';
import {requestWriterWait} from '../src/writer-wait.js';
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
import {publicationSourceFactory,projectPublicationSource} from '../src/project-publication-sources.js';
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

function request(operation){
 const req={waitForWriter:true,checkWriter:async()=>{},socket:{timeout:60000,destroyed:false,setTimeout(){}}},res=new EventEmitter();res.setTimeout=()=>{};res.writableEnded=false;
 return requestWriterWait(req,res,operation);
}

const edit=site=>({workspaceId:site.book.id,baseEtag:site.etag,metadata:{},projects:[],changes:[],removed:[],selection:site.site.selection});

async function renderedPreview(storage,command,options){
 const start=performance.now(),preview=await websitePreviewSource(storage,command,options);
 const sourceMs=Math.round(performance.now()-start);
 const candidate=await renderWebsitePreview(preview.context,{...options,media:preview.media,fonts:new WorkspaceFonts(storage)});
 const html=(await contentBuffer(candidate.files.get(candidate.defaultPage))).toString();
 return {...preview,html,sourceMs,previewMs:Math.round(performance.now()-start)};
}

test('independent websites preview and publish during authoring with bounded source reads at tenfold growth',{timeout:300000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-source-capacity-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:id(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[],scope=new AsyncLocalStorage(),original=ResearchCatalogue.prototype.record,documents=ResearchCatalogue.prototype.queryDocuments;let application,releaseBusy,busy;
 ResearchCatalogue.prototype.record=function(...args){const metrics=scope.getStore();if(metrics)metrics.originals++;return original.apply(this,args);};
 ResearchCatalogue.prototype.queryDocuments=async function*(...args){for await(const value of documents.apply(this,args)){const metrics=scope.getStore();if(metrics)metrics.derivatives++;yield value;}};
 try{
  const host=createNotebook('Publishing workspace'),fixture=await encryptedFixture(directory,host);keys.push(fixture.vault);
  const registry=new ProjectRegistry(fixture.workspace,host.id),addresses=new LabBookDirectory(registry),metadata=createNotebook('Field project'),projectId=id();metadata.projects=[{id:projectId,title:metadata.title,description:'',share:false,logoId:null}];
  const access=await createWorkspaceAccess('','',fixture.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
  const project=await initializeProjectLocation(path.join(fixture.workspace.root,metadata.title),projectId,metadata,access,vault);await registry.attach(project,{expected:(await registry.read()).revision});
  const books=[];
  for(const title of ['First observations','Second observations','Unrelated observations']){
   const entry=(await new LabBookCreation(project,fixture.deviceStore,{publish:entry=>addresses.register(projectId,entry)}).create({id:id(),username:'',password:'',book:{id:id(),projectId,title}})).book,key=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:fixture.deviceStore});keys.push(key);
   const storage=new LabBookStorage(entry.root,entry.labBookId,key);books.push({entry,title,storage,records:[],research:new ResearchRecords(storage,new MediaStore(storage))});
  }
  const sources=books.slice(0,2).map(book=>{const source=emptyPublicationSource(book.entry.namespaceId,book.entry.labBookId);source.projectIds=[projectId];source.selection.includeProjects=[projectId];return source;});
  const sites=new WebsiteSites(fixture.workspace),ids=[];
  for(const name of ['Full journal','Selected report'])ids.push((await sites.change({workspaceId:host.id,etag:(await fixture.workspace.outline()).etag,operation:'create',name})).id);
  application=new ProjectApplication(fixture.workspace,{deviceStore:fixture.deviceStore});const client={},measurements=[];
  const selectedId=()=>publicationOwnerId(host.id,sources[0].workspaceId,'record',books[0].records[0].id);
  async function update(book,index,body){const saved=await book.storage.catalogue(async store=>{const row=await store.member(await store.snapshot(),book.records[index].id);return store.record(row.id,row.revision);});const record={...saved,body};await book.research.save({workspaceId:book.entry.namespaceId,changes:[{id:record.id,expectedRevision:recordRevision(saved),record}]},{receipt:true});book.records[index]=record;}
  for(const count of [80,800]){
   for(const book of books){
    const added=Array.from({length:count-book.records.length},(_,index)=>({...structuredClone(sampleNotebook().entries[0]),id:id(),notebookId:book.entry.labBookId,title:book.title+' '+(book.records.length+index),body:'Observation text '.repeat(512),share:true,attachments:[],figures:[],relations:[],sections:[]}));
    await book.research.save({workspaceId:book.entry.namespaceId,changes:added.map(record=>({id:record.id,expectedRevision:null,record}))},{receipt:true});book.records.push(...added);
   }
   for(const [index,siteId] of ids.entries()){
    const site=await sites.read(siteId),command=edit(site),selected=structuredClone(sources);
    if(index)for(const [owner,source] of selected.entries())source.selection={defaultShare:false,includeProjects:[],records:[{id:books[owner].records[0].id,share:true,attachments:[]}]};
    command.metadata.website={...site.book.website,researchSources:selected,footer:index?'Selected report footer':'Full journal footer',home:{...site.book.website.home,enabled:true,sections:[newElement('records',id)]}};await sites.save(siteId,command);
   }
   const [journal,report]=await Promise.all(ids.map(siteId=>sites.read(siteId))),storages=ids.map(siteId=>websiteWorkspace(fixture.workspace,siteId)),before=books[0].records[0].body,metrics={count,queries:0,sourceUses:0,originals:0,derivatives:0};
   const base=publicationSourceFactory(application,client,storages[0]);let pinned=false;
   const sourceReader=async options=>{const reader=await base(options);return {...reader,use:async(sourceId,snapshotId,consume,options)=>{
    metrics.sourceUses++;
    const result=await reader.use(sourceId,snapshotId,async(store,...args)=>{const run=store.db.run;store.db.run=function(...args){metrics.queries++;return run.apply(this,args);};try{return await consume(store,...args);}finally{store.db.run=run;}},options);
    if(!pinned&&snapshotId===undefined&&sourceId===sources[0].workspaceId){pinned=true;await scope.exit(()=>update(books[0],0,'Concurrent amendment '+count));}
    return result;
   }};};
   let admitted;const entered=new Promise(resolve=>admitted=resolve),held=new Promise(resolve=>releaseBusy=resolve);
   busy=books[2].storage.withLock(async()=>{admitted();await held;});await entered;
   const started=performance.now(),controller=new AbortController(),timer=setTimeout(()=>{controller.abort();releaseBusy();},30000);timer.unref();
   try{
    const results=await Promise.allSettled([
     scope.run(metrics,()=>renderedPreview(storages[0],edit(journal),{designTarget:'entry:'+selectedId(),sourceReader,signal:controller.signal})),
     renderedPreview(storages[1],edit(report),{designTarget:'home',sourceReader:publicationSourceFactory(application,client,storages[1]),signal:controller.signal}),
     request(()=>new PublicationJobs(storages[1],{sourceReader:publicationSourceFactory(application,client,storages[1])}).inline({etag:report.etag},{signal:controller.signal})),
     (async()=>{const at=performance.now();await update(books[1],1,'Independent amendment '+count);metrics.editMs=Math.round(performance.now()-at);})(),
     request(async()=>{const at=performance.now(),command=edit(await sites.read(ids[0]));command.metadata.website={...journal.book.website,footer:'Saved during publication '+count};await sites.save(ids[0],command);metrics.settingsMs=Math.round(performance.now()-at);}),
     projectPublicationSource(application,client,{workspaceId:host.id,sourceId:sources[1].workspaceId,operation:'pages',query:{workspaceId:sources[1].workspaceId,snapshotId:null,source:sources[1],search:'',cursor:null,backward:false}},{signal:controller.signal})
    ]);
    for(const [index,result] of results.entries())if(result.status==='rejected')t.diagnostic(JSON.stringify({task:index,code:result.reason.code,message:result.reason.message}));
    for(const result of results)if(result.status==='rejected')throw result.reason;
    const [preview,home,edition,,,pages]=results.map(result=>result.value);metrics.elapsedMs=Math.round(performance.now()-started);metrics.responseBytes=Buffer.byteLength(JSON.stringify({context:preview.context,editor:preview.editor}));
    metrics.recordPreviewMs=preview.previewMs;metrics.homePreviewMs=home.previewMs;metrics.recordSourceMs=preview.sourceMs;metrics.homeSourceMs=home.sourceMs;
    t.diagnostic(JSON.stringify(metrics));
    assert.ok(metrics.recordPreviewMs<5000,'A selected record preview exceeded five seconds');
    assert.ok(metrics.homePreviewMs<5000,'A selected home preview exceeded five seconds');
    assert.match(preview.html,/Full journal footer/);assert.doesNotMatch(preview.html,/Selected report footer/);
    assert.match(home.html,/Selected report footer/);assert.doesNotMatch(home.html,/Full journal footer/);
    assert.match(home.html,/First observations 0/);assert.match(home.html,/Second observations 0/);
    assert.equal(controller.signal.aborted,false,'Publication exceeded its concurrent-operation deadline');
    assert.equal(preview.context.entries.length,1);assert.equal(preview.context.entries[0].body,before);assert.equal(metrics.originals,1);
    assert.equal(home.context.recordCards.length,2);assert.equal(edition.entries.length,2);assert.equal(pages.value.items.length,25);assert.ok(pages.value.nextCursor);
    assert.equal((await sites.read(ids[0])).book.website.footer,'Saved during publication '+count);assert.equal((await sites.read(ids[1])).book.website.footer,'Selected report footer');
    assert.ok(metrics.settingsMs<5000,'A website settings save exceeded five seconds');
    assert.ok(metrics.editMs<5000,'An independent authoring save exceeded five seconds');assert.ok(metrics.sourceUses<30);assert.ok(metrics.queries<500);assert.ok(metrics.responseBytes<65536);
    measurements.push(metrics);
   }finally{clearTimeout(timer);releaseBusy();await busy;busy=null;}
  }
  // Authenticated tree depth can grow; selected page work cannot grow with the corpus.
  assert.ok(measurements[1].queries<measurements[0].queries*2,'Tenfold content caused excessive indexed query growth');assert.equal(measurements[1].sourceUses,measurements[0].sourceUses);assert.equal(measurements[1].derivatives,measurements[0].derivatives);
 }finally{releaseBusy?.();await busy;ResearchCatalogue.prototype.record=original;ResearchCatalogue.prototype.queryDocuments=documents;await application?.close();await runtime.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-source-capacity-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
