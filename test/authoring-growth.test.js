import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {authoringGrowthFixture} from './authoring-growth-fixture.js';
import {clearVault} from '../src/encryption.js';
import {WorkspaceReader} from '../src/workspace-reader.js';
import {workspaceReader} from '../src/web/workspace-reader.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordQuery} from '../src/record-query.js';
import {recordBrowse} from '../src/web/record-query.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {recordRevision} from '../src/research.js';
import {RecordHistory} from '../src/record-history.js';
import {StructureCommands} from '../src/structure-commands.js';
import {validateRecordScope} from '../src/web/record-scope.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {Workspace} from '../src/storage.js';

test('normal authoring, filtered browsing, structure and recovery exceed the old corpus limits at A1 counts and tenfold growth',async t=>{
 t.diagnostic(JSON.stringify({platform:process.platform,node:process.version,cpu:os.cpus()[0].model,memoryGiB:Math.round(os.totalmem()/1024**3)}));
 // The journey includes authoring, two copy audits and two independent restore
 // activations. Each recovery stage retains its own three-minute budget.
 for(const copies of [1,10])await t.test(copies+' corpus copies',{timeout:1200000},async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-authoring-growth-'));let f,peak=0;
  const sampler=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().heapUsed);},25);sampler.unref();
  t.after(async()=>{clearInterval(sampler);if(f)clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
  f=await authoringGrowthFixture(directory,{copies});assert.equal(f.ids.length,copies*113);assert.ok(f.metrics.originalBytes>5*1024*1024*copies);
  const reader=new WorkspaceReader(f.workspace),record=ResearchCatalogue.prototype.record;let bodies=0,activeBodies=0,maximumBodies=0;
  // A recording mock retains every returned original and would itself turn a
  // bounded audit into a full-corpus memory owner. Counters retain no arguments.
  ResearchCatalogue.prototype.record=async function(...args){bodies++;activeBodies++;maximumBodies=Math.max(maximumBodies,activeBodies);try{return await record.apply(this,args);}finally{activeBodies--;}};
  t.after(()=>{ResearchCatalogue.prototype.record=record;});
  const opened=performance.now(),start=await reader.start();assert.equal(start.total,copies*113);assert.equal(bodies,0);
  const client=workspaceReader((route,data,options)=>route.endsWith('/start')?reader.start(options):reader.page(data,options));
  const outline=await client.read({metadataOnly:true});assert.equal(outline.total,start.total);assert.equal(bodies,0);
  await assert.rejects(client.read(),{code:'WORKSPACE_READ_LIMIT'});await assert.rejects(f.workspace.read(),{code:'WORKSPACE_READ_LIMIT'});assert.equal(bodies,0);
  const openMs=performance.now()-opened;
  const query={projectId:null,notebookId:null,filter:'all',search:'',browse:recordBrowse({})},began=performance.now(),records=new RecordQuery(f.workspace);
  const page=await records.list({workspaceId:f.book.id,query,limit:25});assert.equal(page.total,start.total);assert.equal(bodies,0);
  const searched=await records.list({workspaceId:f.book.id,query:{...query,search:'Returned observation detail'},limit:25});assert.equal(searched.total,70*copies);assert.equal(bodies,0);
  const queryMs=performance.now()-began;
  const selected=await reader.selection({workspaceId:f.book.id,ids:[f.first.id]});validateRecordScope(selected,{workspaceId:f.book.id,ids:[f.first.id]});assert.equal(bodies,1);
  const drafts=new ResearchDrafts(f.workspace),base=selected.book.entries[0],draft={id:randomUUID(),workspaceId:f.book.id,expectedRevision:null,changes:[{record:{...base,title:'Unfinished capacity note'},expectedRevision:recordRevision(base),baseRevision:recordRevision(base)}]};
  const checkpoint=await drafts.write(draft);assert.equal(bodies,1);assert.equal((await drafts.list()).drafts.length,1);
  const saveStart=performance.now(),saved=await f.service.save({workspaceId:f.book.id,changes:[{id:base.id,expectedRevision:recordRevision(base),record:{...base,title:'Saved capacity note'}}]},{recordIds:[base.id]});
  const editMs=performance.now()-saveStart;assert.ok(bodies<=6);assert.equal(saved.recordScope.total,start.total);
  const retained=await drafts.read(draft.id);assert.deepEqual(retained.draft.changes[0].base,base);assert.equal(retained.revision,checkpoint.revision);
  const current=saved.book.entries[0],history=new RecordHistory(f.workspace,{}),versions=await history.list({workspaceId:f.book.id,recordId:base.id});assert.equal(versions.total,2);
  const oldest=versions.versions.at(-1),restored=await history.restore({workspaceId:f.book.id,recordId:base.id,...oldest,expectedRevision:recordRevision(current)},{recordIds:[base.id]});assert.equal(restored.book.entries[0].title,base.title);
  const head=await f.workspace.outline(),target={...head.metadata.notebooks[1],title:'Renamed without reading unrelated records'};bodies=0;
  const renamed=await new StructureCommands(f.workspace).execute('structure',{etag:head.etag,response:'outline',change:{kind:'notebook',value:target}});assert.equal(bodies,0);assert.equal(renamed.total,start.total);assert.equal(renamed.book.notebooks[1].title,target.title);
  const command={etag:renamed.etag,response:'outline',change:{kind:'delete-notebook',value:{id:f.book.notebooks[0].id,records:'move',destinationId:target.id,confirmed:true}}};
  const put=ResearchCatalogue.prototype.putRecord;let writes=0;
  const failure=t.mock.method(ResearchCatalogue.prototype,'putRecord',function(...args){if(++writes===8)throw Object.assign(Error('Synthetic full disk'),{code:'ENOSPC'});return put.apply(this,args);});
  await assert.rejects(new StructureCommands(f.workspace).execute('structure',command),{code:'ENOSPC'});failure.mock.restore();
  assert.equal((await f.workspace.outline()).etag,renamed.etag);assert.equal((await reader.selection({workspaceId:f.book.id,ids:[base.id]})).book.entries[0].notebookId,f.book.notebooks[0].id);
  const commit=ResearchCatalogue.prototype.commitChanges;let moveQueries=0,moveSqlMs=0;
  const metrics=t.mock.method(ResearchCatalogue.prototype,'commitChanges',async function(...args){
   const run=this.db.run;
   this.db.run=async function(...args){const start=performance.now();moveQueries++;try{return await run.apply(this,args);}finally{moveSqlMs+=performance.now()-start;}};
   try{return await commit.apply(this,args);}finally{this.db.run=run;}
  });
  maximumBodies=0;const movedAt=performance.now(),moved=await new StructureCommands(f.workspace).execute('structure',command),moveMs=performance.now()-movedAt;
  metrics.mock.restore();
  assert.equal(maximumBodies,1);assert.equal(moved.total,start.total);assert.equal(moved.notebookCounts[target.id],start.total);assert.ok(!moved.book.notebooks.some(n=>n.id===f.book.notebooks[0].id));
  const after=await reader.selection({workspaceId:f.book.id,ids:[base.id,f.last.id]});assert.ok(after.book.entries.every(r=>r.notebookId===target.id));assert.equal(after.book.entries.find(r=>r.id===base.id).body,base.body);
  await assert.rejects(new StructureCommands(f.workspace).execute('structure',command),{code:'CONFLICT'});
  assert.ok(openMs<5000);assert.ok(queryMs<15000);assert.ok(editMs<5000);assert.ok(f.metrics.maximumSaveMs<15000);
  t.diagnostic(JSON.stringify({...f.metrics,openMs:Math.round(openMs),queryMs:Math.round(queryMs),editMs:Math.round(editMs),moveMs:Math.round(moveMs),moveQueries,moveSqlMs:Math.round(moveSqlMs),simultaneousMoveOriginals:maximumBodies,outlineBytes:Buffer.byteLength(JSON.stringify(outline)),peakHeapMiB:Math.ceil(peak/1024/1024)}));
  assert.ok(moveMs<120000,JSON.stringify({moveMs,peakHeapMiB:Math.ceil(peak/1024/1024)}));assert.ok(peak<512*1024*1024);
  const recovery={},copyAt=performance.now();process.stdout.write('A2 '+copies+'x ordinary copy starts\n');
  const ordinary=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'ordinary')),{vault:f.vault});recovery.ordinaryCopyMs=Math.round(performance.now()-copyAt);
  process.stdout.write(JSON.stringify({copies,...recovery})+'\n');
  assert.ok(recovery.ordinaryCopyMs<180000,JSON.stringify(recovery));
  const access=await createAccess('','synthetic authoring growth recovery'),freshVault=takeCreatedVault(access);t.after(()=>clearVault(freshVault));
  const freshAt=performance.now(),fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'fresh-key')),access,freshVault,f.vault);recovery.freshKeyCopyMs=Math.round(performance.now()-freshAt);
  process.stdout.write(JSON.stringify({copies,...recovery})+'\n');
  assert.ok(recovery.freshKeyCopyMs<180000,JSON.stringify(recovery));
  for(const [root,vault,measurement] of [[ordinary,f.vault,'ordinaryOpenMs'],[fresh,freshVault,'freshKeyOpenMs']]){
   const ws=new Workspace(root,vault),read=new WorkspaceReader(ws),openAt=performance.now(),opened=await read.start();recovery[measurement]=Math.round(performance.now()-openAt);
   process.stdout.write(JSON.stringify({copies,...recovery})+'\n');
   assert.ok(recovery[measurement]<180000,JSON.stringify(recovery));assert.equal(opened.total,start.total);assert.equal(opened.etag,moved.etag);
   const originals=await read.selection({workspaceId:f.book.id,ids:[base.id,f.last.id]});assert.deepEqual(originals.book.entries,after.book.entries);
   const checkpoint=await new ResearchDrafts(ws).read(draft.id);assert.equal(checkpoint.revision,retained.revision);assert.deepEqual(checkpoint.draft.changes[0].base,base);
   const history=new RecordHistory(ws,{}),methodCommand={workspaceId:f.book.id,recordId:f.method.initial.id},versions=await history.list(methodCommand),initial=versions.versions.find(v=>v.revision===recordRevision(f.method.initial));
   assert.ok(initial);assert.deepEqual((await history.read({...methodCommand,...initial})).record,f.method.initial);
   const matches=await new RecordQuery(ws).list({workspaceId:f.book.id,query:{...query,search:'Returned observation detail'},limit:25});assert.equal(matches.total,70*copies);
  }
  // Damage only the disposable restored copy. An independent original remains
  // readable and the fresh-key restore retains the exact selected source bytes.
  const damaged=new Workspace(ordinary,f.vault),bad=after.book.entries.find(r=>r.id===f.last.id);
  await damaged.withLock(()=>damaged.catalogue(async store=>{
   const source=await store.snapshot(),member=await store.member(source,bad.id),row=await store.db.get('SELECT payload FROM records WHERE id=$1 AND revision=$2',bad.id,member.revision),payload=Buffer.from(row.payload);payload[payload.length-1]^=1;
   await store.db.run('UPDATE records SET payload=$1 WHERE id=$2 AND revision=$3',payload,bad.id,member.revision);
  }));
  await assert.rejects(new WorkspaceReader(damaged).selection({workspaceId:f.book.id,ids:[bad.id]}),{code:'ENCRYPTION_DAMAGED'});
  assert.equal((await new WorkspaceReader(damaged).selection({workspaceId:f.book.id,ids:[base.id]})).book.entries[0].body,base.body);
  assert.equal((await reader.selection({workspaceId:f.book.id,ids:[bad.id]})).book.entries[0].body,bad.body);
  t.diagnostic(JSON.stringify({...recovery,copies,recoveryPeakHeapMiB:Math.ceil(peak/1024/1024)}));assert.ok(peak<512*1024*1024);
 });
});
