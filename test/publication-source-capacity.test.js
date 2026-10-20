import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
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
import {ResearchMaterials} from '../src/research-materials.js';
import {defaultEditionRecord} from '../src/web/publication-selection.js';
import {openPublicationInput} from '../src/publication-input-reader.js';
import {verifyPublicationCandidate} from '../src/retained-publication-files.js';
import {privateDirectory,digest,serialize} from '../src/storage.js';

function request(operation){
 const req={waitForWriter:true,checkWriter:async()=>{},socket:{timeout:60000,destroyed:false,setTimeout(){}}},res=new EventEmitter();res.setTimeout=()=>{};res.writableEnded=false;
 return requestWriterWait(req,res,operation);
}

const edit=site=>({workspaceId:site.book.id,baseEtag:site.etag,websitePin:site.websitePin,metadata:{},projects:[],changes:[],removed:[],selection:site.site.selection});

async function renderedPreview(storage,command,options){
 const {websitePin,...draft}=command,start=performance.now(),preview=await websitePreviewSource(storage,draft,{...options,websitePin});
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
     request(()=>new PublicationJobs(storages[1],{sourceReader:publicationSourceFactory(application,client,storages[1])}).inline({etag:report.etag,websitePin:report.websitePin},{signal:controller.signal})),
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
    assert.equal(home.context.recordCards.length,2);assert.equal(edition.files.output.count('entries'),2);assert.equal(pages.value.items.length,25);assert.ok(pages.value.nextCursor);
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


test('native capture separates private growth, selected output, historical links and one large page',{timeout:300000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-source-dimensions-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:id(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[],scope=new AsyncLocalStorage(),privateIds=new Set(),original=ResearchCatalogue.prototype.record,documents=ResearchCatalogue.prototype.queryDocuments;let application,storage,measuring=false;
 ResearchCatalogue.prototype.record=function(recordId,...args){
  if(measuring&&this.workspace.root===storage.root){assert.ok(!privateIds.has(recordId),'Publication read a private original');const metrics=scope.getStore();if(metrics)metrics.originals++;}
  return original.call(this,recordId,...args);
 };
 ResearchCatalogue.prototype.queryDocuments=async function*(...args){for await(const value of documents.apply(this,args)){const metrics=scope.getStore();if(metrics&&this.workspace.root===storage.root)metrics.derivatives++;yield value;}};
 try{
  const host=createNotebook('Native growth host'),fixture=await encryptedFixture(directory,host);keys.push(fixture.vault);
  const registry=new ProjectRegistry(fixture.workspace,host.id),addresses=new LabBookDirectory(registry),metadata=createNotebook('Native source project'),projectId=id();metadata.projects=[{id:projectId,title:metadata.title,description:'',share:false,logoId:null}];
  const access=await createWorkspaceAccess('','',fixture.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
  const project=await initializeProjectLocation(path.join(fixture.workspace.root,metadata.title),projectId,metadata,access,vault);await registry.attach(project,{expected:(await registry.read()).revision});
  const entry=(await new LabBookCreation(project,fixture.deviceStore,{publish:book=>addresses.register(projectId,book)}).create({id:id(),username:'',password:'',book:{id:id(),projectId,title:'Growth observations'}})).book,key=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:fixture.deviceStore});keys.push(key);storage=new LabBookStorage(entry.root,entry.labBookId,key);
  const research=new ResearchRecords(storage,new MediaStore(storage)),materials=new ResearchMaterials(storage),seed=sampleNotebook().entries[0],records=[],assets=[],history=[],png=await readFile(new URL('../src/preview-assets/image.png',import.meta.url));
  const readRecord=recordId=>storage.catalogue(async store=>{const row=await store.member(await store.snapshot(),recordId);return store.record(row.id,row.revision);});
  const saveRecord=async record=>{const previous=await readRecord(record.id);await research.save({workspaceId:entry.namespaceId,changes:[{id:record.id,expectedRevision:recordRevision(previous),record}]},{receipt:true});return readRecord(record.id);};
  for(let index=0;index<13;index++){
   const asset={id:id(),kind:'image',caption:index===12?'WITHHELD_PRIVATE_MEDIA':'Public evidence '+index,alt:'Synthetic observation '+index,share:index!==12,transcript:''},folder=await privateDirectory(storage.root,'.observanda/media/'+asset.id),descriptor={id:asset.id,kind:'image',extension:'png',mime:'image/png',bytes:png.length,sha256:digest(png),originalBytes:png.length,originalSha256:digest(png)};
   await storage.writeFile(path.join(folder,'asset.json'),serialize(descriptor));await storage.writeFile(path.join(folder,'public.png'),png);await storage.writeFile(path.join(folder,'original'),png);assets.push(asset);
  }
  for(let index=0;index<12;index++)records.push({...structuredClone(seed),id:id(),notebookId:entry.labBookId,title:'Public observation '+index,occurredOn:'2026-01-'+String(index+1).padStart(2,'0'),body:'Public observation text. '.repeat(128),share:true,attachments:index===11?[]:[assets[index]],figures:[],relations:[],sections:[]});
  records[0].attachments.push(assets[12]);records[0].sections=[{id:id(),title:'Public conditions',body:'Selected public conditions',share:true},{id:id(),title:'WITHHELD_PRIVATE_SECTION',body:'WITHHELD_PRIVATE_SECTION_BODY',share:false}];
  records[11].body='Exact historical method 0';
  await research.save({workspaceId:entry.namespaceId,changes:records.map(record=>({id:record.id,expectedRevision:null,record}))},{receipt:true});
  for(let index=0;index<records.length;index++)records[index]=await readRecord(records[index].id);
  for(let index=0;index<8;index++){
   const method=records[11],revision=recordRevision(method);await materials.pinRecord(method.id,revision);history.push({record:method,revision,target:{workspaceId:entry.namespaceId,kind:'record',id:method.id,revision}});
   records[11]=await saveRecord({...method,title:'Public observation 11',body:index===7?'Amended method for current work':'Exact historical method '+(index+1),attachments:index===7?[assets[11]]:[]});
  }
  const linkHistory=count=>history.slice(0,count).map((item,index)=>({id:id(),type:'Method used',label:'Exact method '+index,target:item.target}));
  records[0]=await saveRecord({...records[0],relations:linkHistory(1)});
  const addPrivate=async count=>{
   while(privateIds.size<count){const batch=Array.from({length:Math.min(32,count-privateIds.size)},()=>({...structuredClone(seed),id:id(),notebookId:entry.labBookId,title:'WITHHELD_PRIVATE_RECORD',body:'WITHHELD_PRIVATE_BODY',share:false,attachments:[],figures:[],relations:[],sections:[]}));
    await research.save({workspaceId:entry.namespaceId,changes:batch.map(record=>({id:record.id,expectedRevision:null,record}))},{receipt:true});for(const record of batch)privateIds.add(record.id);
   }
  };
  const sites=new WebsiteSites(fixture.workspace),created=await sites.change({workspaceId:host.id,etag:(await fixture.workspace.outline()).etag,operation:'create',name:'Independent growth journal'}),scoped=websiteWorkspace(fixture.workspace,created.id),client={};application=new ProjectApplication(fixture.workspace,{deviceStore:fixture.deviceStore});
  const baseReader=publicationSourceFactory(application,client,scoped),sourceReader=async options=>{const reader=await baseReader(options);return {...reader,use:async(sourceId,snapshotId,consume,settings)=>reader.use(sourceId,snapshotId,async(store,...args)=>{
   const metrics=scope.getStore(),run=store.db.run;if(metrics)metrics.sourceUses++;store.db.run=function(...values){if(metrics)metrics.queries++;return run.apply(this,values);};try{return await consume(store,...args);}finally{store.db.run=run;}
  },settings)};},releases=new PublicationJobs(scoped,{sourceReader}),measurements=[];
  let site,previousSelection='';
  const stages=[{name:'A',privateCount:80,currentCount:2,historyCount:1},{name:'B',privateCount:800,currentCount:2,historyCount:1},{name:'C',privateCount:800,currentCount:12,historyCount:1},{name:'D',privateCount:800,currentCount:12,historyCount:8},{name:'E',privateCount:800,currentCount:12,historyCount:8,large:true}];
  for(const stage of stages){
   await addPrivate(stage.privateCount);
   if(stage.name==='D')records[0]=await saveRecord({...records[0],relations:linkHistory(stage.historyCount)});
   if(stage.large){const sections=Array.from({length:8},(_,index)=>{const unit='Selected section '+index+' observation. ',bytes=48*1024;return {id:id(),title:'Extended observations '+index,body:unit.repeat(Math.floor(bytes/unit.length))+'x'.repeat(bytes%unit.length),share:true};});assert.equal(sections.reduce((bytes,section)=>bytes+Buffer.byteLength(section.body),0),384*1024);records[0]=await saveRecord({...records[0],sections:[...records[0].sections,...sections]});}
   const selectionKey=stage.currentCount+'/'+stage.historyCount;
   if(selectionKey!==previousSelection){
    site=await sites.read(created.id);const source=emptyPublicationSource(entry.namespaceId,entry.labBookId);source.projectIds=[projectId];source.selection.records=records.slice(0,stage.currentCount).map(record=>({id:record.id,share:true,attachments:record.id===records[0].id?[{id:assets[12].id,share:true}]:[]}));source.selection.records.push({id:[...privateIds][0],share:true,attachments:[]});
    source.edition={version:1,records:[],history:history.slice(0,stage.historyCount).map(item=>defaultEditionRecord(item.record,item.revision))};
    const command=edit(site);command.metadata.website={...site.book.website,researchSources:[source],footer:'Independent growth journal',home:{...site.book.website.home,enabled:true,sections:[newElement('records',id)]}};site=await sites.save(created.id,command);previousSelection=selectionKey;
   }
   const pinned=structuredClone(site.websitePin),sourceSnapshot=(await storage.outline()).etag,metrics={stage:stage.name,privateRecords:stage.privateCount,currentRecords:stage.currentCount,historicalRecords:stage.historyCount,queries:0,sourceUses:0,originals:0,derivatives:0},started=performance.now(),signal=AbortSignal.any([t.signal,AbortSignal.timeout(30000)]);let phase='preview';measuring=true;
   try{
    const preview=await scope.run(metrics,()=>renderedPreview(scoped,edit(site),{designTarget:'entry:'+publicationOwnerId(host.id,entry.namespaceId,'record',records[0].id),sourceReader,signal}));metrics.previewMs=preview.previewMs;
    assert.ok(preview.previewMs<5000,'Selected preview exceeded the existing five-second budget');assert.doesNotMatch(preview.html,/WITHHELD_PRIVATE_/);assert.match(preview.html,/Selected public conditions/);assert.equal(preview.context.entries.length,1);assert.equal(preview.context.entries[0].body,records[0].body);assert.deepEqual(preview.context.entries[0].sections.map(section=>section.body),records[0].sections.filter(section=>section.share!==false).map(section=>section.body));
    phase='capture and preparation';const candidate=await request(()=>releases.inline({etag:site.etag,websitePin:pinned},{signal}));assert.deepEqual(candidate.websitePin,pinned);assert.equal(candidate.websiteId,created.id);metrics.requestMs=Math.round(performance.now()-started);assert.equal(signal.aborted,false,'Connected publication exceeded the existing 30-second deadline');
    // Independent retained verification has its own test cancellation. The
    // connected preview/capture/preparation request retains the existing limit.
    const validationStarted=performance.now();phase='retained input';await scoped.catalogue(async()=>{const captured=await releases.source(candidate.jobId),input=await openPublicationInput(scoped,captured,{signal:t.signal});await input.verify();const rows=await Array.fromAsync(input.records()),current=rows.filter(row=>!row.historical),historic=rows.filter(row=>row.historical),groups=await Array.fromAsync(input.sourceGroups());
    assert.equal(current.length,stage.currentCount);assert.equal(historic.length,stage.historyCount);assert.equal(groups.find(group=>group.workspaceId===entry.namespaceId).snapshotId,sourceSnapshot);assert.deepEqual(captured.websitePin,pinned);
    const first=await input.recordTarget({workspaceId:entry.namespaceId,kind:'record',id:records[0].id}),selected=await input.record(first.id);assert.equal(first.revision,recordRevision(records[0]));assert.equal(selected.body,records[0].body);assert.deepEqual(selected.sections.map(section=>section.body),records[0].sections.filter(section=>section.share!==false).map(section=>section.body));assert.equal(selected.attachments.length,1);
    const historicalPages=new Map();for(const item of history.slice(0,stage.historyCount)){const row=await input.recordTarget(item.target);assert.ok(row.historical);assert.equal(row.revision,item.revision);assert.equal((await input.record(row.id)).body,item.record.body);historicalPages.set('entries/'+row.id+'.html',item.record.body);}
    const media=await Array.fromAsync(input.items('retainedMedia'));assert.equal(media.length,stage.currentCount);const expectedMedia=new Set(media.map(asset=>'media/'+asset.id+'.png'));
    phase='retained output';const opened=await releases.read(candidate.reviewId);assert.equal(opened.id,candidate.id);assert.deepEqual(opened.websitePin,pinned);assert.equal(opened.files.output.count('entries'),stage.currentCount+stage.historyCount);await verifyPublicationCandidate(opened,{signal:t.signal});
    const pages=await Array.fromAsync(opened.files.output.items('pages')),expectedPages=new Set(pages.map(({value})=>value.path)),seen=new Set(),seenMedia=new Set(),seenPages=new Set();let entryFiles=0;
    for await(const {file,content} of opened.files.contents({signal:t.signal})){
     assert.ok(!seen.has(file.name));seen.add(file.name);
     if(expectedMedia.has(file.name)){assert.deepEqual(await contentBuffer(content),png);seenMedia.add(file.name);}
     else assert.ok(!file.name.startsWith('media/'),'Unexpected media entered the edition');
     if(file.name.startsWith('entries/')&&file.name.endsWith('.html'))entryFiles++;
     if(file.name.endsWith('.html')){
      const html=(await contentBuffer(content)).toString();assert.doesNotMatch(html,/WITHHELD_PRIVATE_/);
      if(expectedPages.has(file.name))seenPages.add(file.name);
      if(file.name==='entries/'+first.id+'.html'){assert.ok(html.includes(records[0].body.trimEnd()),'The complete selected body is retained without truncation');for(const section of records[0].sections.filter(section=>section.share!==false))assert.ok(html.includes(section.body.trimEnd()),'A selected section was truncated');assert.match(html,/Selected public conditions/);for(const target of historicalPages.keys())assert.ok(html.includes(target.slice('entries/'.length)),'Exact historical link lost its retained destination');}
      if(historicalPages.has(file.name)){assert.ok(html.includes(historicalPages.get(file.name)));assert.ok(!html.includes('Amended method for current work'));}
     }
    }
    assert.equal(seen.size,opened.files.size);assert.deepEqual(seenMedia,expectedMedia);assert.deepEqual(seenPages,expectedPages);assert.equal(entryFiles,stage.currentCount+stage.historyCount);assert.equal(pages.length,opened.files.output.count('pages'));
    metrics.files=seen.size;metrics.pages=pages.length;metrics.selectedProseBytes=Buffer.byteLength(records[0].body)+records[0].sections.filter(section=>section.share!==false).reduce((bytes,section)=>bytes+Buffer.byteLength(section.body),0);});metrics.validationMs=Math.round(performance.now()-validationStarted);metrics.elapsedMs=Math.round(performance.now()-started);measurements.push(metrics);t.diagnostic(JSON.stringify(metrics));
   }catch(error){t.diagnostic(JSON.stringify({stage:stage.name,phase,elapsedMs:Math.round(performance.now()-started),code:error.code,message:error.message}));throw error;}finally{measuring=false;}
  }
  const [small,privateGrowth,selectedGrowth,historyGrowth,heavyPage]=measurements;
  assert.ok(privateGrowth.queries<small.queries*2,'Tenfold private growth exceeded the existing indexed traversal tolerance');for(const key of ['sourceUses','originals','derivatives','files','pages'])assert.equal(privateGrowth[key],small[key],key+' changed solely with private growth');
  assert.ok(selectedGrowth.files>privateGrowth.files);assert.ok(historyGrowth.files>selectedGrowth.files);assert.equal(heavyPage.files,historyGrowth.files);assert.equal(heavyPage.pages,historyGrowth.pages);
 }finally{ResearchCatalogue.prototype.record=original;ResearchCatalogue.prototype.queryDocuments=documents;await application?.close();await runtime.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-source-dimensions-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
