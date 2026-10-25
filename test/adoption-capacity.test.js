import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {authoringGrowthFixture} from './authoring-growth-fixture.js';
import {adoptionEvidenceFixture} from './adoption-capacity-fixture.js';
import {clearVault} from '../src/encryption.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {Workspace} from '../src/storage.js';
import {WorkspaceReader} from '../src/workspace-reader.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {RecordQuery} from '../src/record-query.js';
import {recordBrowse} from '../src/web/record-query.js';
import {DashboardDiscovery} from '../src/dashboard-discovery.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {catalogueBinding} from '../src/postgres-activation.js';
import {recordFingerprint,reconcileResearch} from './fixtures/research-reconciliation.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {contentBuffer} from '../src/file-content.js';
import {WebsiteEditor} from '../src/website-editor.js';
import {randomUUID} from 'node:crypto';
import {sampleWorkloadCpu} from './workload-cpu-sample.js';

test('A1-sized and tenfold authored work, physical evidence, datasets and recovery coexist within declared budgets',async t=>{
 t.diagnostic(JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,cpu:os.cpus()[0].model,memoryGiB:Math.round(os.totalmem()/1024**3)}));
 for(const copies of [1,10])await t.test(copies+' combined corpus copies',{timeout:2400000},async t=>{
  const cpu=sampleWorkloadCpu();
  // A timing overrun must remain a failure without hiding independent byte,
  // privacy and recovery results later in this shared-machine workload.
  const budgetFailures=[];
  const observeTiming=(name,elapsedMs,budgetMs)=>{const measured={name,elapsedMs,budgetMs};process.stdout.write('A2 '+copies+'x '+JSON.stringify(measured)+'\n');if(elapsedMs>=budgetMs)budgetFailures.push(measured);};
  const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-adoption-capacity-'));let f,freshVault,workload,peak=0;
  const sampler=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().heapUsed);},25);sampler.unref();
  t.after(async()=>{
   // A test timeout does not stop the async workload. Drain its owned work
   // before clearing keys or removing files it may still be reading/writing.
   try{await workload;}catch{}
   clearInterval(sampler);t.diagnostic(JSON.stringify({cpuObserved:cpu.stop()}));
   if(f)clearVault(f.vault);if(freshVault)clearVault(freshVault);await rm(directory,{recursive:true,force:true});
  });
  workload=(async()=>{
  f=await authoringGrowthFixture(directory,{copies});
  async function inspect(workspace,phase){
   const measured={},read=ResearchCatalogue.prototype.record;let bodies=0;
   ResearchCatalogue.prototype.record=function(...args){bodies++;return read.apply(this,args);};
   try{
    await workspace.catalogue(async store=>{
     const run=store.db.run;let queries=0;
     store.db.run=function(...args){queries++;return run.apply(this,args);};
     try{
      let at=performance.now();const outline=await new WorkspaceReader(workspace).start();measured.openMs=Math.round(performance.now()-at);
      assert.equal(outline.total,113*copies);assert.equal(bodies,0);
      const query={projectId:null,notebookId:null,filter:'all',search:'Returned observation detail',browse:recordBrowse()};
      at=performance.now();const found=await new RecordQuery(workspace).list({workspaceId:f.book.id,query,limit:25});measured.searchMs=Math.round(performance.now()-at);
      assert.equal(found.total,70*copies);assert.equal(found.records.length,25);assert.equal(bodies,0);
      at=performance.now();const cards=await new DashboardDiscovery(workspace).read({workspaceId:f.book.id,etag:outline.etag,provider:'records',search:'Amended',offset:0,limit:12});measured.discoveryMs=Math.round(performance.now()-at);
      assert.equal(cards.total,copies);assert.equal(bodies,0);
      at=performance.now();const selected=await new WorkspaceReader(workspace).selection({workspaceId:f.book.id,ids:[f.first.id]});measured.selectedMs=Math.round(performance.now()-at);
      assert.equal(bodies,1);assert.equal(selected.book.entries[0].body,f.first.body);
      measured.responseBytes=Math.max(...[outline,found,cards,selected].map(value=>Buffer.byteLength(JSON.stringify(value))));
      measured.queries=queries;
     }finally{store.db.run=run;}
    });
   }finally{ResearchCatalogue.prototype.record=read;}
   for(const [name,budget] of [['openMs',5000],['searchMs',15000],['discoveryMs',15000],['selectedMs',5000]])observeTiming(phase+'.'+name,measured[name],budget);assert.ok(measured.responseBytes<256*1024);
   return measured;
  }
  const before=await inspect(f.workspace,'before'),evidence=await adoptionEvidenceFixture(f,directory,{copies,exerciseRecovery:true,onStage:stage=>process.stdout.write('A2 '+copies+'x '+stage+'\n'),observeTiming}),after=await inspect(f.workspace,'after');
  // Attached evidence must not add reads to plain discovery, navigation or the
  // selected authoring response. The actual artifact bytes live outside them.
  assert.equal(after.queries,before.queries);assert.equal(after.responseBytes,before.responseBytes);
  const service=new ResearchRecords(f.workspace,{}),read=new WorkspaceReader(f.workspace),base=(await read.selection({workspaceId:f.book.id,ids:[f.first.id]})).book.entries[0],began=performance.now();
  const materials=new ResearchMaterials(f.workspace);
  const continued={...base,share:true,title:'Continuing after complete evidence intake',body:'Qualified synthetic observations; original evidence remains private.',figures:[{...structuredClone((await materials.read(evidence.retained.figure)).content.figure),source:evidence.retained.figure}]};
  const saved=await service.save({workspaceId:f.book.id,changes:[{id:base.id,expectedRevision:recordRevision(base),record:continued}]},{recordIds:[base.id]});f.expectedRecords.set(base.id,recordFingerprint({...continued,updatedAt:saved.book.entries[0].updatedAt}));
  const editMs=Math.round(performance.now()-began);observeTiming('editMs',editMs,5000);assert.equal(saved.recordScope.total,113*copies);
  const pinnedAnalysis=await materials.read(evidence.retained.analysis);assert.equal(pinnedAnalysis.content.tool,'Synthetic external analysis');
  const expected={records:f.expectedRecords,originals:evidence.originals,retained:evidence.retained,rows:evidence.metrics.rows};
  process.stdout.write('A10 '+copies+'x complete source reconciliation\n');
  const reconciled=await reconcileResearch(f.workspace,expected);
  assert.equal(reconciled.originalBytes,evidence.metrics.physicalBytes);
  // Consent belongs to the authored source. The saved website narrows that
  // consent to one record; originals and every other run remain private.
  const outline=await f.workspace.outline(),project=outline.metadata.projects[0],editor=new WebsiteEditor(f.workspace),website={workspaceId:f.book.id,websiteId:null};
  let site=await editor.execute('open',website);
  site=await editor.execute('change',{...website,websitePin:site.websitePin,draftId:site.draft?.id??null,expectedRevision:site.draft?.revision??null,commandId:randomUUID(),operations:[
   {type:'settings',path:['projects'],value:outline.metadata.projects.map(({id,logoId})=>({id,share:id===project.id,logoId}))},
   {type:'settings',path:['selection'],value:{defaultShare:false,includeProjects:[],records:[{id:base.id,share:true,attachments:[]}]}}
  ]});
  site=await editor.execute('save',{...website,draftId:site.draft.id,expectedRevision:site.draft.revision,commandId:randomUUID()});
  const edition=await new PublicationJobs(f.workspace).inline({etag:site.websitePin.researchSnapshotId,websitePin:site.websitePin,blockedValues:[f.workspace.root]});
  const editionFiles=new Map();
  for await(const [name,content] of edition.files){
   const bytes=await contentBuffer(content);editionFiles.set(name,bytes);
   if(/\.(html|json|csv|svg|css)$/.test(name)){
    const text=bytes.toString('utf8');for(const secret of ['Returned observation detail.','Amended method','18446744073709551615','returned-00000.raw',f.workspace.root])assert.ok(!text.includes(secret),'Private material in '+name);
   }
  }
  assert.ok(editionFiles.get('entries/'+base.id+'.html').includes(Buffer.from(continued.body)));
  assert.equal([...editionFiles.keys()].filter(name=>/^entries\/[^/]+\.html$/.test(name)).length,1);
  const recovery={};let at=performance.now();
  // Larger physical evidence has a separate, declared ten-minute copy budget;
  // record-only backup qualification retains its tighter three-minute budget.
  // Match the application's ordinary copy: fully verify and activate its own
  // database before completion. Cold portable-archive admission is measured
  // separately by research-reconciliation.benchmark.js.
  process.stdout.write('A2 '+copies+'x ordinary copy starts\n');
  const ordinary=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'ordinary'),{vault:f.vault}),{vault:f.vault,activateCatalogue:true});recovery.ordinaryMs=Math.round(performance.now()-at);observeTiming('ordinaryMs',recovery.ordinaryMs,600000);
  const ordinaryBinding=await catalogueBinding(ordinary);assert.ok(ordinaryBinding);assert.notEqual(ordinaryBinding.id,(await catalogueBinding(f.workspace.root)).id);
  process.stdout.write('A2 '+copies+'x '+JSON.stringify(recovery)+'\n');
  const access=await createWorkspaceAccess('','synthetic combined workload recovery',f.deviceStore);freshVault=takeCreatedVault(access);at=performance.now();
  process.stdout.write('A2 '+copies+'x fresh-key copy starts\n');
  const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'fresh'),{vault:f.vault}),access,freshVault,f.vault);recovery.freshKeyMs=Math.round(performance.now()-at);observeTiming('freshKeyMs',recovery.freshKeyMs,600000);
  process.stdout.write('A2 '+copies+'x '+JSON.stringify(recovery)+'\n');
  const recoveredCopies=[['ordinary',ordinary,f.vault],['fresh-key',fresh,freshVault]],recoveredStates=new Map([[f.workspace.root,saved],...recoveredCopies.map(([,root])=>[root,saved])]);
  for(const [name,root,vault] of recoveredCopies){
   process.stdout.write('A10 '+copies+'x '+name+' copy reconciliation starts\n');
   const ws=new Workspace(root,vault),m=new ResearchMaterials(ws),opened=await new WorkspaceReader(ws).selection({workspaceId:f.book.id,ids:[base.id]});
   assert.equal(opened.etag,saved.etag);assert.deepEqual(opened.book.entries,saved.book.entries);
   assert.deepEqual(await m.read(evidence.retained.analysis),pinnedAnalysis);
   const artifact=await m.artifact(evidence.retained.artifact);assert.equal(artifact.doc.content.sha256,evidence.sourceHash);await artifact.content.verify();
   const dataset=await m.read(evidence.retained.dataset);assert.equal(dataset.content.rowCount,evidence.metrics.rows);
   const last=await m.datasetPage(evidence.retained.dataset,dataset.content.pageIndex.count-1);assert.equal(last.rows.at(-1).cells[1],'18446744073709551615');
   assert.equal((await m.read(evidence.retained.preparation)).content.inputsIndex.count,246*copies);
   assert.equal((await m.read(evidence.retained.returned)).content.inputsIndex.count,27*copies);
   assert.deepEqual(await reconcileResearch(ws,expected),reconciled);
   const retainedEdition=await new PublicationJobs(ws).read(edition.reviewId);assert.deepEqual(new Set(await Array.fromAsync(retainedEdition.files.keys())),new Set(editionFiles.keys()));
   for(const [name,bytes] of editionFiles)assert.deepEqual(await contentBuffer(await retainedEdition.files.get(name)),bytes);
   process.stdout.write('A10 '+copies+'x '+name+' copy reconciled\n');
   // Continue through the public writer, then open fresh readers for the saved
   // revision, its searchable title and the unchanged historical snapshot.
   const prior=opened.book.entries[0],title='Independent '+name+' recovery authoring '+copies,record={...prior,title};
   const edited=await new ResearchRecords(ws,{}).save({workspaceId:f.book.id,baseEtag:opened.etag,changes:[{id:base.id,expectedRevision:recordRevision(prior),record}]},{recordIds:[base.id]});
   assert.notEqual(edited.etag,opened.etag);
   const reopened=await new WorkspaceReader(new Workspace(root,vault)).selection({workspaceId:f.book.id,ids:[base.id]});
   assert.equal(reopened.etag,edited.etag);assert.deepEqual(reopened.book.entries,[{...record,updatedAt:edited.book.entries[0].updatedAt}]);
   const query={projectId:null,notebookId:null,filter:'all',search:title,browse:recordBrowse()};
   const found=await new RecordQuery(new Workspace(root,vault)).list({workspaceId:f.book.id,query,limit:25});
   assert.equal(found.snapshotId,edited.etag);assert.equal(found.total,1);assert.deepEqual(found.records.map(({id,title})=>({id,title})),[{id:base.id,title}]);
   const previous=await new WorkspaceReader(new Workspace(root,vault)).selection({workspaceId:f.book.id,ids:[base.id],snapshotId:opened.etag});
   assert.equal(previous.etag,opened.etag);assert.deepEqual(previous.book.entries,opened.book.entries);
   recoveredStates.set(root,edited);
   for(const [,otherRoot,otherVault] of [['source',f.workspace.root,f.vault],...recoveredCopies])if(otherRoot!==root){
    const unchanged=await new WorkspaceReader(new Workspace(otherRoot,otherVault)).selection({workspaceId:f.book.id,ids:[base.id]}),expectedState=recoveredStates.get(otherRoot);
    assert.equal(unchanged.etag,expectedState.etag);assert.deepEqual(unchanged.book.entries,expectedState.book.entries);
   }
   process.stdout.write('A10 '+copies+'x '+name+' post-recovery authoring verified\n');
  }
  t.diagnostic(JSON.stringify({copies,authoring:f.metrics,evidence:evidence.metrics,before,after,editMs,recovery,peakHeapMiB:Math.ceil(peak/1024/1024)}));assert.ok(peak<512*1024*1024);
  assert.deepEqual(budgetFailures,[],'Elapsed budgets exceeded under observed machine load; integrity and recovery checks completed.');
  })();
  await workload;
 });
});
