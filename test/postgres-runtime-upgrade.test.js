import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,rm,readdir,readFile,writeFile,link} from 'node:fs/promises';
import {Client} from 'pg';
import {startManagedPostgres} from '../src/postgres-runtime.js';
import {acquireWindowsPostgresRuntimeGuard} from '../src/windows-postgres-runtime-guard.js';
import {acquirePostgresRuntimeGuard} from '../src/postgres-runtime-guard.js';
import {upgradePostgresRuntime} from '../src/postgres-runtime-upgrade.js';
import {managedPostgresConfiguration,runtimeStateProtector} from '../src/postgres-runtime-upgrade-config.js';
import {withNativeTree} from '../src/native-storage-tree.js';
import {withMutationFilesSession} from '../src/mutation-files.js';
import {workspaceDatabaseLease} from '../src/workspace-database-lease.js';
import {copyRuntimeWithProof} from '../src/postgres-runtime-upgrade-proof.js';
import {DiskCapacity} from '../src/disk-capacity.js';

test('runtime upgrade accepts only managed settings and rejects external execution and paths',()=>{
 assert.match(managedPostgresConfiguration(Buffer.from("# defaults\nmax_connections = 100\ntimezone = 'UTC'\n")).toString(),/timezone = 'UTC'/);
 for(const text of ["include '/external/config'","data_directory = '/external'","shared_preload_libraries = 'untrusted'","archive_command = 'execute'","restore_command = 'execute'","unix_socket_directories = '/tmp'\ninclude_dir = '/etc'"])assert.throws(()=>managedPostgresConfiguration(Buffer.from(text)),{code:'DATABASE_GUARD_STORAGE'});
});
const windows={skip:process.platform!=='win32',timeout:180000};
async function fixture(t){const base=path.resolve(os.tmpdir()),root=await mkdtemp(path.join(base,'observanda-runtime-upgrade-')),disposers=[];t.after(async()=>{for(const dispose of disposers.reverse())await dispose();assert.equal(path.dirname(root),base);assert.match(path.basename(root),/^observanda-runtime-upgrade-/);await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return {root,directory:path.join(root,'runtime'),dispose:operation=>disposers.push(operation)};}

test('private creation token cannot adopt or reset an unrelated existing root',windows,async t=>{
 const {root,directory,dispose}=await fixture(t),token=randomUUID();let guard=await acquireWindowsPostgresRuntimeGuard({directory,creationToken:token});dispose(()=>guard.close());await guard.files.write(path.join(directory,'retained'),'original');const identity=guard.identity;await guard.close();
 await assert.rejects(acquireWindowsPostgresRuntimeGuard({directory,creationToken:randomUUID()}),{code:'STORAGE_COPY'});
 guard=await acquireWindowsPostgresRuntimeGuard({directory,creationToken:token,expectedIdentity:identity});assert.equal(guard.cached,true);await guard.close();guard=await acquireWindowsPostgresRuntimeGuard({directory});await guard.close();assert.equal(await readFile(path.join(directory,'retained'),'utf8'),'original');
 const other=path.join(root,'other');guard=await acquireWindowsPostgresRuntimeGuard({directory:other});await guard.close();await assert.rejects(acquireWindowsPostgresRuntimeGuard({directory:other,creationToken:token}),{code:'STORAGE_COPY'});
});

test('source inspection is read-only and rejects hard-linked scientific data',windows,async t=>{
 const {root,directory,dispose}=await fixture(t);let source=await acquireWindowsPostgresRuntimeGuard({directory});dispose(()=>source.close());await source.files.write(path.join(directory,'retained'),'original');const identity=source.identity;await source.close();
 const guard=await acquireWindowsPostgresRuntimeGuard({directory:path.join(root,'fresh')});dispose(()=>guard.close());
 await withNativeTree(directory,async(source,{parent})=>{const lease=await source.lease('owner.lock');try{assert.equal((await guard.inspectSource(directory,{parentIdentity:parent.identity,expectedIdentity:identity})).subtreeVerified,true);await assert.rejects(guard.inspectSource(directory,{parentIdentity:parent.identity,expectedIdentity:'different'}),{code:'STORAGE_COPY'});}finally{await lease.close();}});
 await link(path.join(directory,'retained'),path.join(root,'alias'));await withNativeTree(directory,async(source,{parent})=>{await assert.rejects(guard.inspectSource(directory,{parentIdentity:parent.identity,expectedIdentity:identity}));});assert.equal(await readFile(path.join(directory,'retained'),'utf8'),'original');await guard.close();
});

test('workspace admission proof reopens across fresh processes and rejects another vault or root',windows,async t=>{
 const {root,directory,dispose}=await fixture(t),workspace={vault:{id:randomUUID(),key:randomBytes(32)}};let guard=await acquirePostgresRuntimeGuard({directory,workspace});dispose(()=>guard.close());dispose(()=>workspace.vault.key.fill(0));await guard.files.write(path.join(directory,'retained'),'original');await guard.close();const stamp=await readFile(path.join(directory,'owner.lock'));assert.equal(stamp.subarray(0,8).toString(),'OBSGRD03');
 guard=await acquirePostgresRuntimeGuard({directory,workspace});assert.equal(guard.cached,true);await guard.close();
 await assert.rejects(acquirePostgresRuntimeGuard({directory,workspace:{vault:{id:workspace.vault.id,key:randomBytes(32)}}}),{code:'DATABASE_GUARD_STORAGE',reason:'runtime-admission-authentication-failed'});
 const second=path.join(root,'second');guard=await acquirePostgresRuntimeGuard({directory:second,workspace});await guard.close();await writeFile(path.join(second,'owner.lock'),stamp);await assert.rejects(acquirePostgresRuntimeGuard({directory:second,workspace}),{code:'DATABASE_GUARD_STORAGE',reason:'runtime-admission-authentication-failed'});
 assert.equal(await readFile(path.join(directory,'retained'),'utf8'),'original');
});

test('valid device admission converts to portable workspace proof without copying data',windows,async t=>{
 const {directory,dispose}=await fixture(t),workspace={vault:{id:randomUUID(),key:randomBytes(32)}};let guard=await acquireWindowsPostgresRuntimeGuard({directory});dispose(()=>guard.close());dispose(()=>workspace.vault.key.fill(0));await guard.files.write(path.join(directory,'retained'),'original');const identity=guard.identity;await guard.close();
 guard=await acquirePostgresRuntimeGuard({directory,workspace});assert.equal(guard.identity,identity);assert.equal(guard.cached,true);await guard.close();assert.equal((await readFile(path.join(directory,'owner.lock'))).subarray(0,8).toString(),'OBSGRD03');assert.equal(await readFile(path.join(directory,'retained'),'utf8'),'original');
});

test('persistent source fence excludes older managers throughout publication',windows,async t=>{
 const {root,directory,dispose}=await fixture(t),original=await acquireWindowsPostgresRuntimeGuard({directory});await original.files.write(path.join(directory,'evidence'),'unchanged');await original.close();let guard=await acquireWindowsPostgresRuntimeGuard({directory:path.join(root,'fresh')});dispose(()=>guard.close());
 await withNativeTree(directory,async(source,{parent,name})=>{
  let lease=await source.lease('owner.lock'),current=directory,receipt,pin;const options={parentIdentity:parent.identity,expectedIdentity:source.identity,lockIdentity:lease.identity};try{
   await assert.rejects(workspaceDatabaseLease(directory),{code:'DATABASE_RUNNING'});
   receipt=await guard.sourceFence(directory,{...options,action:'describe'});options.original=receipt.original;await guard.sourceFence(directory,{...options,action:'apply'});await lease.close();lease=null;
   await assert.rejects(workspaceDatabaseLease(directory));await parent.rename(name,parent,'retired',{folder:true,identity:source.identity});current=path.join(root,'retired');await assert.rejects(workspaceDatabaseLease(current));
   const selected=await parent.directory('retired');try{pin=await selected.pin('owner.lock',{identity:options.lockIdentity});}finally{await selected.close();}
   await assert.rejects(parent.rename('retired',parent,'exchanged',{folder:true,identity:source.identity}));const reopened=await parent.directory('retired');try{assert.equal(reopened.identity,source.identity);assert.equal((await reopened.read('evidence')).bytes.toString(),'unchanged');}finally{await reopened.close();}
   process.kill(guard.processId,'SIGKILL');await guard.close().catch(error=>assert.equal(error.code,'DATABASE_GUARD_UNAVAILABLE'));await assert.rejects(parent.rename('retired',parent,'exchanged',{folder:true,identity:source.identity}));guard=await acquireWindowsPostgresRuntimeGuard({directory:path.join(root,'fresh')});await assert.rejects(workspaceDatabaseLease(current));
   assert.equal((await guard.sourceFence(current,{...options,action:'inspect'})).fenced,true);
  }finally{await lease?.close();await pin?.close();if(receipt)await guard.sourceFence(current,{...options,action:'remove'});}
 });
 await guard.close();
});

test('upgrade inventory and retained-copy admission preserve source on exhausted capacity',windows,async t=>{
 const {root,directory,dispose}=await fixture(t);let guard=await acquireWindowsPostgresRuntimeGuard({directory});dispose(()=>guard.close());await guard.files.write(path.join(directory,'evidence'),Buffer.alloc(16384,7));await guard.close();
 for(const available of [0n,266000n]){
  const targetPath=path.join(root,'target-'+available),targetGuard=await acquireWindowsPostgresRuntimeGuard({directory:targetPath});dispose(()=>targetGuard.close());const capacity=new DiskCapacity({probe:async()=>({id:'fixture',available})});
  await withMutationFilesSession(async files=>{const source=await files.open(directory),target=await files.open(targetPath);try{await assert.rejects(copyRuntimeWithProof(source,target,{id:randomUUID(),key:randomBytes(32).toString('hex')},{directory:targetPath,capacity,reserveBytes:262144}),{code:'STORAGE_FULL'});assert.equal(await target.stat('evidence',{missing:true}),null);}finally{await target.close();await source.close();}});
  assert.deepEqual(await readFile(path.join(directory,'evidence')),Buffer.alloc(16384,7));assert.equal(capacity.stats().active,0);await targetGuard.close();
 }
});

test('stopped cluster upgrade preserves rows, resumes after startup failure and retires verified originals',{...windows,skip:process.platform!=='win32'||!process.env.OBSERVANDA_TEST_POSTGRES_BIN,timeout:300000},async t=>{
 const {root,directory,dispose}=await fixture(t),env={...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN};delete env.OBSERVANDA_DATABASE_URL;
 let service=await startManagedPostgres({directory,env});dispose(()=>service?.close());const client=new Client({connectionString:env.OBSERVANDA_DATABASE_URL});await client.connect();await client.query('CREATE TABLE upgrade_evidence (value integer)');await client.query('INSERT INTO upgrade_evidence SELECT generate_series(1,1000)');await client.end();await service.close();service=null;
 const originalIdentity=await withNativeTree(directory,source=>source.identity),originalControl=await readFile(path.join(directory,'service.observanda'));
 const interrupt=async phase=>withMutationFilesSession(async files=>{
  const open=files.open;files.open=async function(target){const parent=await open.call(files,target);if(path.resolve(target)===root){const rename=parent.rename;parent.rename=async function(member,destination,name,options){
   if(name==='.runtime.runtime-upgrade'&&phase!=='rename-gap'){const clear=await runtimeStateProtector().unprotect((await parent.read(member)).bytes);let journal;try{journal=JSON.parse(clear.toString());}finally{clear.fill(0);}if(journal.phase===phase){if(phase==='fencing')await rename.call(parent,member,destination,name,options);throw new Error('interrupted '+phase);}}
   const result=await rename.call(parent,member,destination,name,options);if(phase==='rename-gap'&&member==='runtime'&&name.startsWith('.runtime-retired-'))throw new Error('interrupted rename-gap');return result;
  };}return parent;};
  try{return await upgradePostgresRuntime({directory,env},()=>assert.fail('Startup cannot precede publication'));}finally{files.open=open;}
 });
 await assert.rejects(interrupt('fencing'),/interrupted fencing/);let oldLease=await workspaceDatabaseLease(directory);await oldLease.close();
 await assert.rejects(interrupt('prepared'),/interrupted prepared/);await assert.rejects(workspaceDatabaseLease(directory));
 await assert.rejects(interrupt('rename-gap'),/interrupted rename-gap/);assert.ok(!(await readdir(root)).includes('runtime'));
 await assert.rejects(upgradePostgresRuntime({directory,env},async()=>{throw new Error('interrupted startup');}),/interrupted startup/);
 const names=await readdir(root),retired=names.find(name=>name.startsWith('.runtime-retired-'));assert.ok(retired);assert.deepEqual(await readFile(path.join(root,retired,'service.observanda')),originalControl);assert.notEqual(await withNativeTree(directory,source=>source.identity),originalIdentity);
 service=await upgradePostgresRuntime({directory,env},async guard=>{
  const clear=await runtimeStateProtector().unprotect(await guard.files.read(path.join(directory,'service.observanda')));let config;try{config=JSON.parse(clear.toString());}finally{clear.fill(0);}
  await guard.run(path.join(config.bin,'pg_ctl.exe'),['-D',path.join(directory,'data'),'-l',path.join(directory,'postgresql.log'),'-o','-h 127.0.0.1 -p '+config.port,'-w','-t','60','start']);
  const connection=new Client({host:'127.0.0.1',port:config.port,user:'observanda',password:config.appPassword,database:'observanda'});try{await connection.connect();assert.equal((await connection.query('SELECT count(*)::integer AS count FROM upgrade_evidence')).rows[0].count,1000);}finally{await connection.end();}
  return {close:async()=>{try{await guard.run(path.join(config.bin,'pg_ctl.exe'),['-D',path.join(directory,'data'),'-m','fast','-w','stop']);}finally{await guard.close();}}};
 });
 assert.ok(!(await readdir(root)).some(name=>name.startsWith('.runtime-retired-')||name.startsWith('.runtime-upgrade-')||name==='.runtime.runtime-upgrade'));await service.close();service=null;
 service=await startManagedPostgres({directory,env});await service.close();service=null;
});
