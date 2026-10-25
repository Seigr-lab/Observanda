import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {authoringGrowthFixture} from './authoring-growth-fixture.js';
import {adoptionEvidenceFixture} from './adoption-capacity-fixture.js';
import {reconcileResearch} from './fixtures/research-reconciliation.js';
import {sampleWorkloadCpu} from './workload-cpu-sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {FileContent} from '../src/file-content.js';
import {Workspace} from '../src/storage.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {clearVault} from '../src/encryption.js';

// Explicit diagnostic, excluded from the default *.test.js selection:
// node scripts/test.js --test-concurrency=1 test/research-reconciliation.benchmark.js
// Phase elapsed time includes nested phases; self time excludes them. SQL time
// is accumulated in the innermost phase, with no query values or paths logged.
async function measuredReconciliation(workspace,expected,label,t){
 const context=new AsyncLocalStorage(),phases=new Map(),restores=[],connections=new WeakSet(),longCells=new Set(),reported=new Set(['records','artifacts','dataset','figure','catalogue-open']);let longCellReads=0,verificationAttemptBytes=0;
 const stats=name=>{if(!phases.has(name))phases.set(name,{calls:0,elapsedMs:0,selfMs:0,sqlQueries:0,sqlMs:0});return phases.get(name);};
 const phase=async(name,operation)=>{
  const parent=context.getStore(),frame={name,childMs:0},start=performance.now();
  try{return await context.run(frame,operation);}finally{const elapsed=performance.now()-start,item=stats(name);item.calls++;item.elapsedMs+=elapsed;item.selfMs+=elapsed-frame.childMs;if(parent)parent.childMs+=elapsed;else if(reported.has(name))process.stdout.write('Reconciliation '+label+': '+name+' '+Math.round(elapsed)+' ms\n');}
 };
 const replace=(owner,key,wrap)=>{const descriptor=Object.getOwnPropertyDescriptor(owner,key),original=owner[key];owner[key]=wrap(original);restores.push(()=>{if(descriptor)Object.defineProperty(owner,key,descriptor);else delete owner[key];});};
 const instrument=store=>{
  const db=store.db;if(connections.has(db))return;connections.add(db);
  replace(db,'run',original=>async function(...args){const item=stats(context.getStore()?.name??'snapshot'),start=performance.now();item.sqlQueries++;try{return await original.apply(this,args);}finally{item.sqlMs+=performance.now()-start;}});
 };
 replace(workspace,'openCatalogue',original=>function(...args){return phase('catalogue-open',()=>original.apply(this,args));});
 replace(workspace,'readMetadata',original=>function(...args){
  const parent=context.getStore()?.name;
  return this===workspace&&['sequence-node-read','sequence-chunk-read','sequence-other-read'].includes(parent)?phase(parent.replace(/-read$/,'-metadata'),()=>original.apply(this,args)):original.apply(this,args);
 });
 replace(workspace,'catalogue',original=>function(operation,...args){return original.call(this,store=>{instrument(store);return operation(store);},...args);});
 replace(MaterialSequence.prototype,'read',original=>function(...args){
  if(this.workspace!==workspace)return original.apply(this,args);
  const kind=args[0]==='nodes'?'node':args[0]==='chunks'?'chunk':'other';
  return phase('sequence-'+kind+'-read',()=>original.apply(this,args));
 });
 for(const [method,name] of [['verify','catalogue-verify'],['verifySnapshot','snapshot-verify']])replace(ResearchCatalogue.prototype,method,original=>function(...args){if(this.workspace!==workspace)return original.apply(this,args);instrument(this);return phase(name,()=>original.apply(this,args));});
 replace(ResearchMaterials.prototype,'verifySnapshot',original=>function(...args){return this.workspace===workspace?phase('materials-verify',()=>original.apply(this,args)):original.apply(this,args);});
 // These are verification attempts, not decoded bytes: a scoped verification
 // cache may satisfy an attempt without reading the encrypted file again.
 replace(FileContent.prototype,'verify',original=>function(...args){if(this.workspace!==workspace)return original.apply(this,args);verificationAttemptBytes+=this.size;return phase('artifact-verify',()=>original.apply(this,args));});
 replace(ResearchMaterials.prototype,'retainedDatasetPage',original=>function(...args){return this.workspace===workspace?phase('dataset-page',()=>original.apply(this,args)):original.apply(this,args);});
 replace(ResearchMaterials.prototype,'readDatasetCell',original=>function(value,...args){
  if(this.workspace!==workspace||typeof value==='string')return original.call(this,value,...args);
  longCellReads++;if(value.parts?.root?.hash)longCells.add(value.parts.root.hash);
  return phase('long-cell-read',()=>original.call(this,value,...args));
 });
 const start=performance.now();
 try{return await reconcileResearch(workspace,expected,{phase});}
 finally{
  for(const restore of restores.reverse())restore();
  t.diagnostic(JSON.stringify({reconciliation:label,elapsedMs:Math.round(performance.now()-start),verificationAttemptBytes,longCellReads,distinctLongCellRoots:longCells.size,phases:Object.fromEntries([...phases].map(([name,value])=>[name,Object.fromEntries(Object.entries(value).map(([key,n])=>[key,Math.round(n)]))]))}));
 }
}

test('complete research reconciliation reports source and reopened ordinary-copy read costs',{timeout:600000},async t=>{
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-reconciliation-')),cpu=sampleWorkloadCpu();let fixture,active;
 // A timeout must not remove files while an awaited copy or scan still owns them.
 t.after(async()=>{await active?.catch(()=>{});t.diagnostic(JSON.stringify({cpuObserved:cpu.stop()}));if(fixture)clearVault(fixture.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-reconciliation-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 active=(async()=>{
 fixture=await authoringGrowthFixture(directory,{copies:1});
 const evidence=await adoptionEvidenceFixture(fixture,directory,{copies:1,exerciseRecovery:false,onStage:stage=>process.stdout.write('Reconciliation fixture: '+stage+'\n')});
 const expected={records:fixture.expectedRecords,originals:evidence.originals,retained:evidence.retained,rows:evidence.metrics.rows};
 const source=await measuredReconciliation(fixture.workspace,expected,'source',t);
 assert.equal(source.records,113);assert.equal(source.originals,273);assert.equal(source.originalBytes,evidence.metrics.physicalBytes);assert.equal(source.rows,4344);
 const started=performance.now(),copy=await copyWorkspace(await copyPlan(fixture.workspace.root,path.join(directory,'ordinary'),{vault:fixture.vault}),{vault:fixture.vault});
 t.diagnostic(JSON.stringify({ordinaryCopyMs:Math.round(performance.now()-started)}));
 const reopened=new Workspace(copy,fixture.vault),restored=await measuredReconciliation(reopened,expected,'ordinary-copy',t);
 assert.deepEqual(restored,source);
 })();await active;
});
