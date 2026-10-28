import {Client} from 'pg';
import {withDatabaseRequest} from '../src/database-request-context.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,access,realpath,readdir,mkdir} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {databaseConfiguration,databaseStatus,CATALOGUE_FILE,CATALOGUE_ARCHIVE,openCatalogue,backupCatalogue} from '../src/postgres.js';
import {DiskCapacity} from '../src/disk-capacity.js';
import {Workspace} from '../src/storage.js';
import {initializeLocation,copyPlan,copyWorkspace} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {sampleNotebook} from '../src/sample.js';
import {safeError} from '../src/errors.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {catalogueObjectPrefixCount,objectPrefixUpper,catalogueIndexedCount,cataloguePrefixExists} from '../src/postgres-indexes.js';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-pg-contract-'));
 const access=await createAccess('','synthetic PostgreSQL password'),vault=takeCreatedVault(access);
 t.after(async()=>{clearVault(vault);await rm(root,{recursive:true,force:true});});
 const source=path.join(root,'source');await initializeLocation(source,sampleNotebook(),access,vault);
 return {root,source,vault,ws:new Workspace(source,vault)};
}
test('archive space loss preserves the previous archive and returns a borrowed connection outside its snapshot',async t=>{
 const {root,source,ws}=await fixture(t),destination=path.join(root,'backup');await mkdir(path.join(destination,'.observanda'),{recursive:true});await backupCatalogue(source,destination);
 const file=path.join(destination,CATALOGUE_ARCHIVE),previous=await readFile(file);
 await ws.withLock(()=>ws.catalogue(store=>store.putObject('synthetic-capacity-value',{text:'x'.repeat(6*1024*1024)})));
 let probes=0;const budget=new DiskCapacity({probe:async()=>({id:'synthetic-volume',available:++probes<3?16n*1024n*1024n:0n})}),db=await openCatalogue(source);
 try{
  await assert.rejects(backupCatalogue(source,destination,{connection:db,capacity:budget}),{code:'STORAGE_FULL'});
  assert.equal(probes,3);assert.equal(budget.stats().active,0);assert.equal(budget.stats().reservedBytes,'0');
  assert.deepEqual(await readFile(file),previous);assert.equal((await readdir(path.dirname(file))).some(name=>name.endsWith('.tmp')),false);
  assert.equal((await db.get('SHOW transaction_isolation')).transaction_isolation,'read committed');
  assert.equal((await db.get('SELECT 1 AS usable')).usable,1);
 }finally{await db.close();}
 assert.equal((await ws.catalogue(store=>store.object('synthetic-capacity-value'))).text.length,6*1024*1024);
 const recovered=await backupCatalogue(source,destination);assert.match(recovered,/^[a-f0-9]{64}$/);assert.notDeepEqual(await readFile(file),previous);
});

test('database configuration refuses missing credentials and remote TLS downgrade without exposing secrets',async()=>{
 await assert.rejects(databaseConfiguration({}),{code:'DATABASE_CONFIG'});
 const base={OBSERVANDA_DATABASE_URL:'postgresql://worker:secret-sentinel@database.invalid/research'};
 await assert.rejects(databaseConfiguration(base),{code:'DATABASE_TLS'});
 const verified=await databaseConfiguration({...base,OBSERVANDA_DATABASE_TLS:'verify-full'});
 assert.equal(verified.ssl.rejectUnauthorized,true);assert.equal(verified.password,'secret-sentinel');
 for(const query of ['?sslmode=disable','?sslmode=no-verify','?options=-csearch_path=public']){
  try{await databaseConfiguration({...base,OBSERVANDA_DATABASE_TLS:'verify-full',OBSERVANDA_DATABASE_URL:base.OBSERVANDA_DATABASE_URL+query});assert.fail('accepted connection override');}
  catch(error){assert.equal(error.code,'DATABASE_CONFIG');assert.ok(!JSON.stringify(safeError(error)).includes('secret-sentinel'));}
 }
 assert.equal((await databaseConfiguration({OBSERVANDA_DATABASE_URL:'postgresql://worker:secret@127.0.0.1/research'})).ssl,false);
});
test('the test database runs with an ordinary role and readiness never reveals connection settings',async t=>{
 const {source}=await fixture(t),db=await openCatalogue(source);
 try{assert.equal((await db.get('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rolsuper,false);}
 finally{await db.close();}
 assert.deepEqual(await databaseStatus(),{engine:'PostgreSQL',ready:true});
});
test('existing catalogues gain an indexed byte-order history range without replacing their binding or records',async t=>{
 const {source,ws}=await fixture(t),before=await ws.read(),binding=await readFile(path.join(source,CATALOGUE_FILE));
 const old=await openCatalogue(source);try{await old.run('DROP INDEX state_slot_bytes');await old.run('DROP INDEX objects_id_bytes');}finally{await old.close();}
 const db=await openCatalogue(source);
 try{
  await db.run('BEGIN');await db.run('SET LOCAL enable_seqscan=off');
  const prefix='history-index:'+before.book.entries[0].id+':';
  const plan=await db.get('EXPLAIN (FORMAT JSON) SELECT count(*) FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2',prefix,prefix+'~');
  assert.match(JSON.stringify(plan),/state_slot_bytes/);
  const objectPrefix='metadata:.observanda/materials/records/'+before.book.entries[0].id+'/';
  const objectPlan=await db.get('EXPLAIN (FORMAT JSON) SELECT count(*) FROM objects WHERE id COLLATE "C">=$1 AND id COLLATE "C"<$2',objectPrefix,objectPrefixUpper(objectPrefix));
  assert.match(JSON.stringify(objectPlan),/objects_id_bytes/);
 }finally{await db.close();}
 assert.deepEqual(await readFile(path.join(source,CATALOGUE_FILE)),binding);assert.deepEqual(await ws.read(),before);
});

test('indexed object prefix counts preserve Unicode prefix membership',async t=>{
 const {ws}=await fixture(t),ids=['é/one','é/two','é0/other','😀/one','😀/two','😁/other','\ud7ff/x','\ue000/x','x\u{10ffff}/one','x\u{10ffff}/two','y/other','\u{10ffff}/one'];
 await ws.withLock(()=>ws.catalogue(async store=>{for(const id of ids)await store.putObject(id,{value:id});}));
 await ws.catalogue(async store=>{
  for(const prefix of ['é/','😀/','\ud7ff','x\u{10ffff}','\u{10ffff}','missing/'])assert.equal((await catalogueObjectPrefixCount(store.db,prefix)).n,String(ids.filter(id=>id.startsWith(prefix)).length));
 });
});
test('portable backup restores after the source database schema is gone and restored copies stay independent',async t=>{
 const {root,source,vault,ws}=await fixture(t),before=await ws.read();
 const backup=await copyWorkspace(await copyPlan(source,path.join(root,'backup')),{vault});
 const second=await copyWorkspace(await copyPlan(source,path.join(root,'second')),{vault});
 await assert.rejects(access(path.join(backup,CATALOGUE_FILE)),{code:'ENOENT'});
 const archive=await readFile(path.join(backup,CATALOGUE_ARCHIVE));
 for(const secret of [before.book.title,source,process.env.OBSERVANDA_DATABASE_URL])assert.ok(!archive.includes(Buffer.from(secret)));
 const db=await openCatalogue(source);try{await db.run('DROP SCHEMA "'+db.schema+'" CASCADE');}finally{await db.close();}
 await assert.rejects(ws.read(),{code:'CATALOGUE_UNAVAILABLE'});
 const restored=new Workspace(backup,vault),independent=new Workspace(second,vault);
 const verify=ResearchCatalogue.prototype.verify,isolations=[];
 const activation=t.mock.method(ResearchCatalogue.prototype,'verify',async function(...args){
  isolations.push((await this.db.get('SHOW transaction_isolation')).transaction_isolation);return verify.apply(this,args);
 });
 assert.deepEqual(await restored.read(),before);assert.deepEqual(await independent.read(),before);
 activation.mock.restore();assert.deepEqual(isolations,['repeatable read','repeatable read']);
 const a=JSON.parse(await readFile(path.join(backup,CATALOGUE_FILE))),b=JSON.parse(await readFile(path.join(second,CATALOGUE_FILE)));
 assert.notEqual(a.id,b.id);
 const next=structuredClone(before.book);next.entries[0].title='Restored edition only';await restored.save(next,before.etag);
 assert.deepEqual(await independent.read(),before);
});
test('a database edit after backup review invalidates the plan even when the binding file is unchanged',async t=>{
 const {root,source,ws,vault}=await fixture(t),plan=await copyPlan(source,path.join(root,'stale'));
 const current=await ws.read();current.book.entries[0].title='Changed after review';await ws.save(current.book,current.etag);
 await assert.rejects(copyWorkspace(plan,{vault}),{code:'CONFLICT'});
 await assert.rejects(access(plan.destination),{code:'ENOENT'});
});

test('backup review detects a same-size retained state change even when the current head is unchanged',async t=>{
 const {root,source,vault}=await fixture(t),plan=await copyPlan(source,path.join(root,'changed-state'));
 const db=await openCatalogue(source);
 try{
  const row=await db.get("SELECT slot,payload FROM state WHERE slot<>'head' ORDER BY slot LIMIT 1"),changed=Buffer.from(row.payload);changed[changed.length-1]^=1;
  await db.run('UPDATE state SET payload=$1 WHERE slot=$2',changed,row.slot);
 }finally{await db.close();}
 await assert.rejects(copyWorkspace(plan,{vault}),{code:'CONFLICT'});
 await assert.rejects(access(plan.destination),{code:'ENOENT'});
});
test('truncated or forged archives fail without deleting the original or activating a database',async t=>{
 const {root,source,vault}=await fixture(t);
 for(const [name,change] of [['truncated',b=>b.subarray(0,b.length-30)],['forged',b=>Buffer.from(b.toString().replace('"table":"scope_keys"','"table":"__proto__"'))]]){
  const backup=await copyWorkspace(await copyPlan(source,path.join(root,name)),{vault}),file=path.join(backup,CATALOGUE_ARCHIVE);
  const broken=change(await readFile(file));await writeFile(file,broken);
  await assert.rejects(new Workspace(backup,vault).read(),{code:'CATALOGUE_DAMAGED'});
  assert.deepEqual(await readFile(file),broken);await assert.rejects(access(path.join(backup,CATALOGUE_FILE)),{code:'ENOENT'});
 }
});
test('interrupted archive import rolls back and can be retried from unchanged original bytes',async t=>{
 const {root,source,vault,ws}=await fixture(t),before=await ws.read();
 const backup=await copyWorkspace(await copyPlan(source,path.join(root,'interrupted')),{vault}),file=path.join(backup,CATALOGUE_ARCHIVE),bytes=await readFile(file);
 const script=[
  "import {Client} from 'pg';",
  "import {openCatalogue} from './src/postgres.js';",
  "process.stdout.write('loaded\\n');",
  "const query=Client.prototype.query;let stopped=false;Client.prototype.query=async function(sql,...args){const result=await query.call(this,sql,...args);if(!stopped&&sql.startsWith('INSERT INTO records')){stopped=true;process.stdout.write('paused\\n');await new Promise(()=>{});}return result;};",
  'await openCatalogue('+JSON.stringify(backup)+');'
 ].join('\n');
 const child=spawn(process.execPath,['--input-type=module','-'],{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});
 let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);const exited=new Promise(resolve=>child.once('exit',resolve));
 try{
  await new Promise((resolve,reject)=>{
   // Module startup is separate from the import checkpoint. In particular,
   // loading source through a mounted filesystem is not archive-import time.
   let output='',loaded=false,timer;
   const finish=error=>{clearTimeout(timer);child.stdout.removeListener('data',data);child.removeListener('error',failed);child.removeListener('exit',closed);if(error)reject(error);else resolve();};
   const failed=error=>finish(error),closed=()=>finish(Error('Import exited: '+stderr));
   const data=chunk=>{output+=chunk;if(!loaded&&output.includes('loaded\n')){loaded=true;clearTimeout(timer);timer=setTimeout(()=>finish(Error('Import did not pause: '+stderr)),15000);}if(loaded&&output.includes('paused\n'))finish();};
   timer=setTimeout(()=>finish(Error('Import worker did not start: '+stderr)),60000);
   child.once('error',failed);child.once('exit',closed);child.stdout.on('data',data);child.stdin.end(script);
  });child.kill('SIGKILL');await exited;
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
 assert.deepEqual(await readFile(file),bytes);await assert.rejects(access(path.join(backup,CATALOGUE_FILE)),{code:'ENOENT'});
 assert.deepEqual(await new Workspace(backup,vault).read(),before);
});

test('activation waits for a releasing importer but leaves an actively locked archive unchanged',async t=>{
 const {root,source,vault,ws}=await fixture(t),before=await ws.read();
 const target=await copyWorkspace(await copyPlan(source,path.join(root,'contended')),{vault}),file=path.join(target,CATALOGUE_ARCHIVE),bytes=await readFile(file);
 const holder=await openCatalogue(source),lock='Observanda/activate/'+await realpath(target);
 const acquire=()=>holder.run('SELECT pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended($1,0))',lock);
 const release=()=>holder.run('SELECT pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended($1,0))',lock);
 try{
  await acquire();const started=Date.now();
  await assert.rejects(new Workspace(target,vault).read(),{code:'LOCKED'});
  assert.ok(Date.now()-started<6000,'a live importer must not block indefinitely');
  assert.deepEqual(await readFile(file),bytes);await assert.rejects(access(path.join(target,CATALOGUE_FILE)),{code:'ENOENT'});
  let finished=false;const pending=new Workspace(target,vault).read().then(value=>({value}),error=>({error})).finally(()=>{finished=true;});
  try{await delay(150);assert.equal(finished,false,'a competing opener must wait for activation ownership');}
  finally{await release();}
  const result=await pending;if(result.error)throw result.error;assert.deepEqual(result.value,before);
 }finally{await release().catch(()=>{});await holder.close();}
});


test('catalogue counts seek bounded byte-order pages and exclude unrelated state',async t=>{
 const {ws}=await fixture(t);
 await ws.withLock(()=>ws.catalogue(async store=>{
  const db=store.db;
  await db.run("INSERT INTO state SELECT 'count-test:'||lpad(n::text,6,'0'),$1 FROM generate_series(1,3073) AS n",Buffer.from('count fixture'));
  await db.run("INSERT INTO state SELECT 'unrelated-count:'||n,$1 FROM generate_series(1,4096) AS n",Buffer.from('unrelated fixture'));
  const edgeIds=['count-test:','count-test:\ud7ff','count-test:\ue000','count-test:\u{10000}','count-test:\u{10ffff}','count-test;outside'];
  for(const id of edgeIds)await db.run('INSERT INTO state VALUES ($1,$2)',id,Buffer.from('edge fixture'));
  const get=db.get,queries=[];
  db.get=async function(sql,...values){if(sql.includes(' AS page'))queries.push({sql,values});return get.call(this,sql,...values);};
  try{
   assert.equal(await catalogueIndexedCount(db,'state','count-test:'),3078);
   assert.equal(queries.length,4);
   for(const {sql,values} of queries){assert.match(sql,/LIMIT 1024/);assert.doesNotMatch(sql,/starts_with|OFFSET/);assert.deepEqual(values.slice(0,2),['count-test:','count-test;']);}
   assert.ok(queries.slice(1).every(({values})=>values.length===3));
   await db.run('SET LOCAL enable_seqscan=off');
   const plan=await get.call(db,'EXPLAIN (FORMAT JSON) '+queries[1].sql,...queries[1].values);assert.match(JSON.stringify(plan),/state_slot_bytes/);
   assert.equal(await cataloguePrefixExists(db,'state','count-test:'),true);
   assert.equal(await cataloguePrefixExists(db,'state','missing-count:'),false);
   assert.equal(await catalogueIndexedCount(db,'state','missing-count:'),0);
   for(const prefix of ['count-test:\ud7ff','count-test:\ue000','count-test:\u{10000}','count-test:\u{10ffff}'])assert.equal(await catalogueIndexedCount(db,'state',prefix),1);
   const all=Number((await get.call(db,'SELECT count(*)::text AS n FROM state')).n);assert.equal(await catalogueIndexedCount(db,'state'),all);
   await assert.rejects(catalogueIndexedCount(db,'records'),TypeError);
  }finally{db.get=get;}
 }));
});


for(const active of [false,true])test('cancelled detached archive cleanup removes its temporary schema '+(active?'after an active query':'between queries'),async t=>{
 const {root,source,ws,vault}=await fixture(t),before=await ws.read();
 const backup=await copyWorkspace(await copyPlan(source,path.join(root,'detached-copy')),{vault});
 const controller=new AbortController(),observer=await openCatalogue(source);let temporary;
 t.after(async()=>{try{await temporary?.close();}finally{await observer.close();}});
 temporary=await withDatabaseRequest(controller.signal,()=>new Workspace(backup,vault).openCatalogue({detached:true}));
 assert.equal(temporary.temporary,true);const schema=temporary.schema;
 assert.ok(await observer.get('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1',schema));
 if(active){
  const pending=withDatabaseRequest(controller.signal,()=>temporary.run('SELECT pg_sleep(10)'));
  const failed=assert.rejects(pending,error=>error===controller.signal.reason);controller.abort();await failed;
 }else controller.abort();
 await withDatabaseRequest(controller.signal,()=>temporary.close());temporary=null;
 assert.equal(await observer.get('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1',schema),undefined);
 assert.deepEqual(await ws.read(),before);
});


test('a dead detached catalogue releases admission before reconnecting for schema cleanup',async t=>{
 const {root,source,vault}=await fixture(t);
 const backup=await copyWorkspace(await copyPlan(source,path.join(root,'detached-dead-copy')),{vault});
 const observer=await openCatalogue(source);let temporary;
 t.after(async()=>{try{await temporary?.close();}finally{await observer.close();}});
 temporary=await new Workspace(backup,vault).openCatalogue({detached:true});
 const schema=temporary.schema,pid=(await temporary.get('SELECT pg_backend_pid() AS pid')).pid;
 const ended=new Promise(resolve=>temporary.client.once('end',resolve));
 await observer.get('SELECT pg_terminate_backend($1)',pid);await ended;
 let released=false,reconnections=0;const end=temporary.client.end.bind(temporary.client),connect=Client.prototype.connect;
 t.mock.method(temporary.client,'end',async()=>{await end();released=true;});
 const spy=t.mock.method(Client.prototype,'connect',function(...args){assert.equal(released,true,'cleanup requested another admission slot before releasing its dead client');reconnections++;return connect.apply(this,args);});
 try{await temporary.close();temporary=null;}finally{spy.mock.restore();}
 assert.equal(reconnections,1);assert.equal(await observer.get('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1',schema),undefined);
});

test('cancelling detached catalogue admission preserves the cancellation and removes its unpublished schema',async t=>{
 const {root,source,ws,vault}=await fixture(t),before=await ws.read();
 const backup=await copyWorkspace(await copyPlan(source,path.join(root,'cancelled-admission')),{vault});
 const controller=new AbortController(),reason=new Error('cancelled disposable admission');let schema;
 await assert.rejects(withDatabaseRequest(controller.signal,()=>openCatalogue(backup,{detached:true,vault,validate:async db=>{schema=db.schema;controller.abort(reason);}})),error=>error===reason);
 assert.equal(typeof schema,'string');const observer=await openCatalogue(source);
 try{assert.equal(await observer.get('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1',schema),undefined);}finally{await observer.close();}
 assert.deepEqual(await ws.read(),before);
});
