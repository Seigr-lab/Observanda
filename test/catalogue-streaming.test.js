import {projectDomainSchemas,projectDomainSchema} from '../src/project-domain-schema.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {ResearchCatalogue,catalogueDescriptor} from '../src/research-catalogue.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {ObjectIndex} from '../src/object-index.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {RecordHistory} from '../src/record-history.js';
import {Workspace,serialize} from '../src/storage.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {catalogueStamp,CATALOGUE_ARCHIVE,CATALOGUE_FILE} from '../src/postgres.js';

async function fixture(t,count=4){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-streaming-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Synthetic trial '+i,body:'A recorded observation.',sections:[{id:randomUUID(),title:'Results',body:''}],attachments:[],figures:[],contributors:[],tags:[],relations:[]}));
 const {workspace:ws,vault}=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true});});
 return {ws,vault,directory,base:await ws.read()};
}
async function edit(f){
 const record={...f.base.book.entries[0],title:'Revised interpretation'};
 return new ResearchRecords(f.ws,{}).save({workspaceId:f.base.book.id,baseEtag:f.base.etag,changes:[{id:record.id,expectedRevision:recordRevision(f.base.book.entries[0]),record}]},{compact:true});
}
function forbidAssembly(){
 const restore=[];
 for(const [owner,key] of [[ResearchCatalogue.prototype,'read'],[ResearchCatalogue.prototype,'manifest'],[ResearchCatalogue.prototype,'snapshots'],[SnapshotIndex.prototype,'rows']]){
  const before=owner[key];restore.push(()=>owner[key]=before);owner[key]=()=>{throw Error('Unbounded assembly: '+key);};
 }
 return ()=>restore.forEach(fn=>fn());
}

test('verification streams 42 and 420 records and their old revisions within declared budgets',async t=>{
 // Scope: record catalogue verification, not browser startup or module state.
 // Before running: one body at a time, <=32 SQL rows/fetch, <=4096 cached index
 // nodes, <=8N+10 body reads, <=260N+10000 statements, <=90 seconds per corpus.
 t.diagnostic(os.platform()+'/'+os.arch()+'; '+os.cpus()[0].model+'; Node '+process.version);
 for(const count of [42,420]){
  const f=await fixture(t,count);await edit(f);
  const restore=forbidAssembly(),record=ResearchCatalogue.prototype.record,node=ObjectIndex.prototype.node;
  let bodies=0,active=0,peakBodies=0,peakCache=0,queries=0,peakBatch=0,peakHeap=process.memoryUsage().heapUsed;
  ResearchCatalogue.prototype.record=async function(...args){
   bodies++;peakBodies=Math.max(peakBodies,++active);
   try{return await record.apply(this,args);}finally{active--;peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);}
  };
  ObjectIndex.prototype.node=async function(...args){const result=await node.apply(this,args);peakCache=Math.max(peakCache,this.cache.size);return result;};
  const start=performance.now();
  try{await f.ws.catalogue(async store=>{
   const run=store.db.run;
   store.db.run=async function(sql,...args){
    queries++;
    assert.ok(!/^SELECT (?:DISTINCT id FROM records|id FROM snapshots|slot,payload FROM state ORDER)/.test(sql),'unbounded SQL result: '+sql);
    const result=await run.call(this,sql,...args);
    if(sql.startsWith('FETCH '))peakBatch=Math.max(peakBatch,result.rows.length);
    return result;
   };
   try{await store.verify(catalogueDescriptor(f.base.book));assert.equal((await store.db.get("SELECT count(*)::int AS n FROM pg_cursors WHERE name LIKE 'obs_rows_%'")).n,0);}
   finally{store.db.run=run;}
  });}finally{restore();ResearchCatalogue.prototype.record=record;ObjectIndex.prototype.node=node;}
  const elapsed=performance.now()-start;
  assert.equal(peakBodies,1);assert.ok(peakBatch<=32);assert.ok(peakCache<=4096);
  assert.ok(bodies<=8*count+10,'record read budget: '+bodies);
  assert.ok(queries<=260*count+10000,'query budget: '+queries);assert.ok(elapsed<90000,'elapsed budget: '+elapsed);
  t.diagnostic(count+' records / two snapshots: '+Math.round(elapsed)+' ms, '+queries+' SQL statements, '+bodies+' body reads, peak fetch '+peakBatch+', cache '+peakCache+', sampled heap '+Math.round(peakHeap/1024/1024)+' MiB.');
 }
});

test('streamed membership checks reject missing, extra, conflicting and duplicate-position entries',async t=>{
 const f=await fixture(t);
 await f.ws.withLock(()=>f.ws.catalogue(async store=>{
  const snapshot=await store.snapshot(),index=new SnapshotIndex(store),rows=await index.rows(snapshot);
  const check=async root=>assert.rejects(new SnapshotIndex(store).verify({...snapshot,membership:root}),{code:'CATALOGUE_DAMAGED'});
  let root=await index.change(snapshot.membership,'identity:'+rows[0].sections[0],null);await index.flush(root);await check(root);
  const source=await index.find({root:snapshot.membership},'record:'+rows[0].id);
  root=await index.change(snapshot.membership,'identity:'+randomUUID(),source.revision);await index.flush(root);await check(root);
  root=await index.change(snapshot.membership,'identity:'+rows[1].sections[0],source.revision);await index.flush(root);await check(root);
  const duplicate=rows.map((row,i)=>i===1?{...row,position:rows[0].position}:row);
  root=await index.build(duplicate);await check(root);
  const {searchIndex,...older}=snapshot;void searchIndex;
  await assert.rejects(index.verify({...older,membership:root}),{code:'CATALOGUE_DAMAGED'});
  const sparse=rows.map((row,i)=>({...row,position:i*1000000}));
  root=await index.build(sparse);await index.verify({...older,membership:root,nextPosition:4000000});
  await index.verify(snapshot);
 }));
});

test('SQL cursors clean up after early return, cancellation and nested reads',async t=>{
 const f=await fixture(t);
 await f.ws.catalogue(async store=>{
  let seen=0;
  for await(const row of store.db.rows('SELECT n FROM generate_series(1,100) AS n')){
   for await(const nested of store.db.rows('SELECT $1::int AS n',[row.n]))assert.equal(nested.n,row.n);
   if(++seen===3)break;
  }
  const controller=new AbortController();
  await assert.rejects(async()=>{for await(const row of store.db.rows('SELECT n FROM generate_series(1,100) AS n',[],{signal:controller.signal})){void row;controller.abort();}}, {name:'AbortError'});
  assert.equal((await store.db.get("SELECT count(*)::int AS n FROM pg_cursors WHERE name LIKE 'obs_rows_%'")).n,0);
 });
 await assert.rejects(f.ws.withLock(()=>f.ws.catalogue(async store=>{
  for await(const row of store.db.rows('SELECT n FROM generate_series(1,100) AS n')){void row;await store.db.run('SELECT 1/0');}
 })),{code:'22012'});
});

test('backup review streams the same fingerprint and pins one database snapshot during concurrent writes',async t=>{
 const f=await fixture(t),db=await f.ws.openCatalogue(),other=await f.ws.openCatalogue(),prototype=Object.getPrototypeOf(db),run=prototype.run;
 t.after(async()=>{await other.close();await db.close();});
 const hash=createHash('sha256');
 for(const domain of [null,...await projectDomainSchemas(db)]){
  if(domain)hash.update(serialize(['domain',domain]));
  const schema=domain?projectDomainSchema(db.id,domain):db.schema;
  for(const row of await db.all('SELECT slot,payload FROM "'+schema+'".state ORDER BY slot'))hash.update(serialize([row.slot,createHash('sha256').update(row.payload).digest('hex')]));
 }
 const expected=await catalogueStamp(f.ws.root);assert.equal(expected.revision,hash.digest('hex'));
 let injected=false;
 prototype.run=async function(sql,...args){
  assert.notEqual(sql,'SELECT slot,payload FROM state ORDER BY slot');
  const result=await run.call(this,sql,...args);
  if(this!==other&&!injected&&sql.startsWith('FETCH ')&&result.rows[0]?.slot){
   injected=true;await run.call(other,"INSERT INTO state VALUES ('synthetic-concurrent',$1)",Buffer.from('Concurrent synthetic value'));
  }
  return result;
 };
 try{
  assert.deepEqual(await catalogueStamp(f.ws.root),expected);assert.ok(injected);
  assert.notDeepEqual(await catalogueStamp(f.ws.root),expected);
 }finally{prototype.run=run;await other.run("DELETE FROM state WHERE slot='synthetic-concurrent'");}
});

test('fresh-key backup retains exact snapshot roots, histories and state without reconstructing books',async t=>{
 const f=await fixture(t,8);await edit(f);
 const current=await f.ws.read(),history=new RecordHistory(f.ws,{}),command={workspaceId:current.book.id,recordId:current.book.entries[0].id};
 const first=await history.list({...command,limit:1});
 const before=await f.ws.catalogue(async store=>({snapshot:await store.snapshot(),state:await store.db.all('SELECT slot,payload FROM state ORDER BY slot')}));
 const access=await createAccess('','fresh backup synthetic password'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const restore=forbidAssembly();let target,ordinary;
 try{
  target=await encryptedCopy(await copyPlan(f.ws.root,path.join(f.directory,'fresh-key')),access,vault,f.vault);
  ordinary=await copyWorkspace(await copyPlan(f.ws.root,path.join(f.directory,'ordinary')),{vault:f.vault});
 }finally{restore();}
 const next=new Workspace(target,vault),original=new Workspace(ordinary,f.vault);
 assert.deepEqual(await next.read(),current);assert.deepEqual(await original.read(),current);
 assert.deepEqual(await next.catalogue(store=>store.snapshot()),before.snapshot);
 const after=await next.catalogue(store=>store.db.all('SELECT slot,payload FROM state ORDER BY slot'));
 assert.deepEqual(after.map(row=>row.slot),before.state.map(row=>row.slot));
 for(let n=0;n<after.length;n++)assert.ok(!after[n].payload.equals(before.state[n].payload));
 await f.ws.catalogue(async source=>next.catalogue(async destination=>{
  const a=await source.scopeKey(current.book.notebooks[0].id),b=await destination.scopeKey(current.book.notebooks[0].id);
  try{assert.ok(!a.equals(b));}finally{a.fill(0);b.fill(0);}
 }));
 // Public content references retain their identities. A workspace-encrypted
 // paging cursor is intentionally invalid after key replacement.
 const restoredHistory=new RecordHistory(next,{}),page=await restoredHistory.list({...command,limit:1});
 assert.deepEqual(page.versions,first.versions);
 assert.deepEqual((await restoredHistory.list({...command,limit:1,cursor:page.nextCursor})).versions,(await history.list({...command,limit:1,cursor:first.nextCursor})).versions);
 await assert.rejects(restoredHistory.list({...command,limit:1,cursor:first.nextCursor}),{code:'RECORD_HISTORY_CURSOR'});
});

test('failed rekey leaves source unchanged and an incomplete destination cannot activate',async t=>{
 const f=await fixture(t),before=await catalogueStamp(f.ws.root),access=await createAccess('','interrupted backup synthetic password'),vault=takeCreatedVault(access);
 t.after(()=>clearVault(vault));const encode=ResearchCatalogue.prototype.encode;
 ResearchCatalogue.prototype.encode=function(table,id,value){if(this.workspace.vault.id===vault.id&&table==='state')throw Object.assign(Error('Synthetic disk full'),{code:'ENOSPC'});return encode.call(this,table,id,value);};
 const destination=path.join(f.directory,'interrupted');
 try{await assert.rejects(encryptedCopy(await copyPlan(f.ws.root,destination),access,vault,f.vault),{code:'ENOSPC'});}
 finally{ResearchCatalogue.prototype.encode=encode;}
 assert.deepEqual(await catalogueStamp(f.ws.root),before);
 await assert.rejects(new Workspace(destination,vault).read(),{code:'STORAGE_INCOMPLETE'});
 for(const file of [CATALOGUE_FILE,CATALOGUE_ARCHIVE])await assert.rejects(readFile(path.join(destination,file)),{code:'ENOENT'});
 const recovered=await encryptedCopy(await copyPlan(f.ws.root,path.join(f.directory,'retried')),access,vault,f.vault);
 assert.deepEqual(await new Workspace(recovered,vault).read(),f.base);
});
