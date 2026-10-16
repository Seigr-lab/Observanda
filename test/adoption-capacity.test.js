import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {authoringGrowthFixture} from './authoring-growth-fixture.js';
import {adoptionEvidenceFixture} from './adoption-capacity-fixture.js';
import {clearVault} from '../src/encryption.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {Workspace} from '../src/storage.js';
import {WorkspaceReader} from '../src/workspace-reader.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {RecordQuery} from '../src/record-query.js';
import {recordBrowse} from '../src/web/record-query.js';
import {DashboardDiscovery} from '../src/dashboard-discovery.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {recordFingerprint,reconcileResearch} from './fixtures/research-reconciliation.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {contentBuffer} from '../src/file-content.js';

test('A1-sized and tenfold authored work, physical evidence, datasets and recovery coexist within declared budgets',async t=>{
 t.diagnostic(JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,cpu:os.cpus()[0].model,memoryGiB:Math.round(os.totalmem()/1024**3)}));
 for(const copies of [1,10])await t.test(copies+' combined corpus copies',{timeout:2400000},async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-adoption-capacity-'));let f,peak=0;
  const sampler=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().heapUsed);},25);sampler.unref();
  t.after(async()=>{clearInterval(sampler);if(f)clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
  f=await authoringGrowthFixture(directory,{copies});
  async function inspect(workspace){
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
   assert.ok(measured.openMs<5000);assert.ok(measured.searchMs<15000);assert.ok(measured.discoveryMs<15000);assert.ok(measured.selectedMs<5000);assert.ok(measured.responseBytes<256*1024);
   return measured;
  }
  const before=await inspect(f.workspace),evidence=await adoptionEvidenceFixture(f,directory,{copies,exerciseRecovery:copies===1,onStage:stage=>process.stdout.write('A2 '+copies+'x '+stage+'\n')}),after=await inspect(f.workspace);
  // Attached evidence must not add reads to plain discovery, navigation or the
  // selected authoring response. The actual artifact bytes live outside them.
  assert.equal(after.queries,before.queries);assert.equal(after.responseBytes,before.responseBytes);
  const service=new ResearchRecords(f.workspace,{}),read=new WorkspaceReader(f.workspace),base=(await read.selection({workspaceId:f.book.id,ids:[f.first.id]})).book.entries[0],began=performance.now();
  const materials=new ResearchMaterials(f.workspace);
  const continued={...base,title:'Continuing after complete evidence intake',body:'Qualified synthetic observations; original evidence remains private.',figures:[structuredClone((await materials.read(evidence.retained.figure)).content.figure)]};
  const saved=await service.save({workspaceId:f.book.id,changes:[{id:base.id,expectedRevision:recordRevision(base),record:continued}]},{recordIds:[base.id]});f.expectedRecords.set(base.id,recordFingerprint({...continued,updatedAt:saved.book.entries[0].updatedAt}));
  const editMs=Math.round(performance.now()-began);assert.ok(editMs<5000);assert.equal(saved.recordScope.total,113*copies);
  const pinnedAnalysis=await materials.read(evidence.retained.analysis);assert.equal(pinnedAnalysis.content.tool,'Synthetic external analysis');
  const expected={records:f.expectedRecords,originals:evidence.originals,retained:evidence.retained,rows:evidence.metrics.rows};
  process.stdout.write('A10 '+copies+'x complete source reconciliation\n');
  const reconciled=await reconcileResearch(f.workspace,expected);
  assert.equal(reconciled.originalBytes,evidence.metrics.physicalBytes);
  // Prepare one explicit public derivative of a private authored investigation.
  // Evidence originals and every unselected run stay private at both scales.
  const outline=await f.workspace.outline(),project=outline.metadata.projects[0];
  const draft={workspaceId:f.book.id,baseEtag:outline.etag,metadata:{},projects:[{id:project.id,share:true,logoId:project.logoId}],changes:[],removed:[],selection:{defaultShare:false,includeProjects:[],records:[{id:base.id,share:true,attachments:[]}]}};
  const edition=await new PublicationJobs(f.workspace).inline({workspaceId:f.book.id,etag:outline.etag,draft,blockedValues:[f.workspace.root]});
  const editionFiles=new Map();
  for(const [name,content] of edition.files){
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
  process.stdout.write('A2 '+copies+'x ordinary copy starts\n');
  const ordinary=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'ordinary')),{vault:f.vault});recovery.ordinaryMs=Math.round(performance.now()-at);assert.ok(recovery.ordinaryMs<600000,JSON.stringify(recovery));
  process.stdout.write('A2 '+copies+'x '+JSON.stringify(recovery)+'\n');
  const access=await createAccess('','synthetic combined workload recovery'),freshVault=takeCreatedVault(access);t.after(()=>clearVault(freshVault));at=performance.now();
  const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'fresh')),access,freshVault,f.vault);recovery.freshKeyMs=Math.round(performance.now()-at);assert.ok(recovery.freshKeyMs<600000,JSON.stringify(recovery));
  process.stdout.write('A2 '+copies+'x '+JSON.stringify(recovery)+'\n');
  for(const [root,vault] of [[ordinary,f.vault],[fresh,freshVault]]){
   const ws=new Workspace(root,vault),m=new ResearchMaterials(ws),opened=await new WorkspaceReader(ws).selection({workspaceId:f.book.id,ids:[base.id]});
   assert.equal(opened.etag,saved.etag);assert.deepEqual(opened.book.entries,saved.book.entries);
   assert.deepEqual(await m.read(evidence.retained.analysis),pinnedAnalysis);
   const artifact=await m.artifact(evidence.retained.artifact);assert.equal(artifact.doc.content.sha256,evidence.sourceHash);await artifact.content.verify();
   const dataset=await m.read(evidence.retained.dataset);assert.equal(dataset.content.rowCount,evidence.metrics.rows);
   const last=await m.datasetPage(evidence.retained.dataset,dataset.content.pageIndex.count-1);assert.equal(last.rows.at(-1).cells[1],'18446744073709551615');
   assert.equal((await m.read(evidence.retained.preparation)).content.inputsIndex.count,246*copies);
   assert.equal((await m.read(evidence.retained.returned)).content.inputsIndex.count,27*copies);
   assert.deepEqual(await reconcileResearch(ws,expected),reconciled);
   const retainedEdition=await new PublicationJobs(ws).read(edition.reviewId);assert.deepEqual(new Set(retainedEdition.files.keys()),new Set(editionFiles.keys()));
   for(const [name,bytes] of editionFiles)assert.deepEqual(await contentBuffer(retainedEdition.files.get(name)),bytes);
  }
  t.diagnostic(JSON.stringify({copies,authoring:f.metrics,evidence:evidence.metrics,before,after,editMs,recovery,peakHeapMiB:Math.ceil(peak/1024/1024)}));assert.ok(peak<512*1024*1024);
 });
});
