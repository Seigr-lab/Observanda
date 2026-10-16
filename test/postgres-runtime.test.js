import {spawn} from 'node:child_process';
import {requireDatabase} from '../src/postgres.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,appendFile,chmod} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createServer,createConnection} from 'node:net';
import {verifyManagedApplication} from '../src/postgres-runtime-readiness.js';
import {Client} from 'pg';
import {startManagedPostgres,verifyRuntime,runtimeCommand,managedSharedBuffers} from '../src/postgres-runtime.js';

const environment=()=>{const env={...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN??''};delete env.OBSERVANDA_DATABASE_URL;return env;};
async function query(env,sql){const c=new Client({connectionString:env.OBSERVANDA_DATABASE_URL});await c.connect();try{return await c.query(sql);}finally{await c.end();}}
test('managed PostgreSQL initializes privately, refuses a second manager, restarts and retains data',async t=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-runtime-')),directory=path.join(parent,'database'),env=environment(),progress=[];let service;
 t.after(async()=>{await service?.close();await rm(parent,{recursive:true,force:true});});
 // The old deterministic TCP port may be occupied or reserved by Windows.
 // Neither condition may block the named-pipe-managed database startup.
 const oldPort=49152+createHash('sha256').update(process.platform==='win32'?directory.toLowerCase():directory).digest().readUInt16BE(0)%16000;
 const unrelated=createServer(socket=>socket.destroy());
 await new Promise((resolve,reject)=>{unrelated.once('error',e=>['EADDRINUSE','EACCES'].includes(e.code)?resolve():reject(e));unrelated.listen(oldPort,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>unrelated.close(resolve)));
 service=await startManagedPostgres({directory,env,onProgress:p=>progress.push(p.stage)});
 assert.equal(service.managed,true);assert.ok(progress.includes('initialize'));
 assert.equal((await query(env,'SHOW shared_buffers')).rows[0].shared_buffers,'64MB');
 assert.equal((await query(env,'SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper,false);
 await query(env,'CREATE TABLE public.retained(value text)');await query(env,"INSERT INTO public.retained VALUES ('retained across application update')");
 await assert.rejects(startManagedPostgres({directory,env:environment()}),{code:'DATABASE_RUNNING'});
 const saved=await readFile(path.join(directory,'service.observanda'));if(process.platform==='win32')assert.equal(saved.includes('adminPassword'),false);
 await service.close();assert.equal(env.OBSERVANDA_DATABASE_URL,undefined);
 env.OBSERVANDA_POSTGRES_SHARED_BUFFERS_MIB='128';
 service=await startManagedPostgres({directory,env});assert.equal((await query(env,'SELECT value FROM public.retained')).rows[0].value,'retained across application update');
 assert.equal((await query(env,'SHOW shared_buffers')).rows[0].shared_buffers,'128MB');
 assert.equal((await query(env,'SHOW fsync')).rows[0].fsync,'on');
 assert.equal((await query(env,'SHOW full_page_writes')).rows[0].full_page_writes,'on');
 assert.equal((await query(env,'SHOW synchronous_commit')).rows[0].synchronous_commit,'on');
});
test('external database configuration never starts a managed cluster',async()=>{
 const env={OBSERVANDA_DATABASE_URL:'postgresql://example:secret@database.invalid/work'};
 const result=await startManagedPostgres({directory:'unused',env});assert.equal(result.managed,false);await result.close();assert.equal(env.OBSERVANDA_DATABASE_URL,'postgresql://example:secret@database.invalid/work');
});
test('runtime verification rejects altered and truncated installers before extraction',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-runtime-hash-'));t.after(()=>rm(root,{recursive:true,force:true}));const file=path.join(root,'runtime'),bytes=Buffer.from('synthetic runtime bytes'),manifest={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 await writeFile(file,bytes);await verifyRuntime(file,manifest);await writeFile(file,bytes.subarray(1));await assert.rejects(verifyRuntime(file,manifest),{code:'DATABASE_INSTALL'});
 await writeFile(file,Buffer.alloc(bytes.length));await assert.rejects(verifyRuntime(file,manifest),{code:'DATABASE_INSTALL'});
});

test('actual PostgreSQL TLS validates both the authority and the requested host',async t=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-tls-')),directory=path.join(parent,'database'),env=environment();let service;
 t.after(async()=>{await service?.close();await rm(parent,{recursive:true,force:true});});
 service=await startManagedPostgres({directory,env});await service.close();service=null;
 const data=path.join(directory,'data'),cert=path.join(data,'server.crt'),key=path.join(data,'server.key');
 const requestConfig=path.join(parent,'request.cnf');await writeFile(requestConfig,'[req]\ndistinguished_name=dn\n[dn]\n');
 await runtimeCommand('openssl',['req','-config',requestConfig,'-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','2','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1']);await chmod(key,0o600);
 await appendFile(path.join(data,'postgresql.conf'),"\nssl=on\nssl_cert_file='server.crt'\nssl_key_file='server.key'\n");
 service=await startManagedPostgres({directory,env});
 const verified={...env,OBSERVANDA_DATABASE_TLS:'verify-full',OBSERVANDA_DATABASE_CA:cert};
 await requireDatabase(verified);
 await assert.rejects(requireDatabase({...verified,OBSERVANDA_DATABASE_CA:''}),{code:'DATABASE_UNAVAILABLE'});
 await assert.rejects(requireDatabase({...verified,OBSERVANDA_DATABASE_URL:env.OBSERVANDA_DATABASE_URL.replace('127.0.0.1','localhost')}),{code:'DATABASE_UNAVAILABLE'});
});

test('cancelled initialization resumes in the same managed installation',async t=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-runtime-cancel-')),directory=path.join(parent,'database'),env=environment(),controller=new AbortController();let service;
 t.after(async()=>{await service?.close();await rm(parent,{recursive:true,force:true});});
 await assert.rejects(startManagedPostgres({directory,env,signal:controller.signal,onProgress:p=>{if(p.stage==='initialize')controller.abort();}}),{code:'DATABASE_CANCELLED'});
 service=await startManagedPostgres({directory,env});await requireDatabase(env);
});
test('abrupt application termination releases ownership and recovery keeps committed data only',async t=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-runtime-crash-')),directory=path.join(parent,'database'),env=environment();let service,child,exited;
 t.after(async()=>{
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}
  service??=await startManagedPostgres({directory,env});await service.close();await rm(parent,{recursive:true,force:true});
 });
 child=spawn(process.execPath,['--input-type=module','-'],{cwd:process.cwd(),env,windowsHide:true,stdio:['pipe','pipe','pipe']});exited=new Promise(resolve=>child.once('exit',resolve));let errors='';child.stderr.on('data',bytes=>errors+=bytes);
 const ready=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Managed child did not start: '+errors)),25000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Managed child exited early: '+errors));});
  child.stdout.once('data',()=>{clearTimeout(timer);resolve();});
 });
 child.stdin.end("import {startManagedPostgres} from './src/postgres-runtime.js';import {Client} from 'pg';const service=await startManagedPostgres({directory:"+JSON.stringify(directory)+"});const client=new Client({connectionString:process.env.OBSERVANDA_DATABASE_URL});await client.connect();await client.query('CREATE TABLE crash_probe(value integer)');await client.query('INSERT INTO crash_probe VALUES (1)');await client.query('BEGIN');await client.query('INSERT INTO crash_probe VALUES (2)');process.stdout.write('ready');await new Promise(()=>{});");
 await ready;child.kill('SIGKILL');await exited;
 service=await startManagedPostgres({directory,env});assert.deepEqual((await query(env,'SELECT value FROM crash_probe')).rows,[{value:1}]);
});


test('Windows private directory setup needs no audit privileges and preserves contents', {skip:process.platform!=='win32'}, async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-private-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const marker=path.join(directory,'retained');await writeFile(marker,'existing content');
 const powershell=path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const helper=path.resolve('src/security/private-directory.ps1');
 for(let pass=0;pass<2;pass++)await runtimeCommand(powershell,['-NoProfile','-NonInteractive','-File',helper,'-Directory',directory]);
 assert.equal(await readFile(marker,'utf8'),'existing content');
 const inspect=String.raw`$acl=(Get-Item -LiteralPath $env:OBSERVANDA_TEST_DIRECTORY).GetAccessControl();@{user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;protected=$acl.AreAccessRulesProtected;rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|ForEach-Object{@{sid=$_.IdentityReference.Value;rights=[int]$_.FileSystemRights;allow=$_.AccessControlType.ToString();inheritance=[int]$_.InheritanceFlags}})}|ConvertTo-Json -Depth 4 -Compress`;
 const acl=JSON.parse(await runtimeCommand(powershell,['-NoProfile','-NonInteractive','-Command',inspect],{env:{...process.env,OBSERVANDA_TEST_DIRECTORY:directory}}));
 assert.equal(acl.protected,true);
 assert.deepEqual(acl.rules.map(r=>r.sid).sort(),[acl.user,'S-1-5-18'].sort());
 for(const rule of acl.rules){assert.equal(rule.allow,'Allow');assert.equal(rule.rights,2032127);assert.equal(rule.inheritance,3);}
});


test('managed database buffer budgets are explicit, bounded and cannot inject server options',()=>{
 assert.equal(managedSharedBuffers({}),64);
 for(const value of ['16','128','1024','4096'])assert.equal(managedSharedBuffers({OBSERVANDA_POSTGRES_SHARED_BUFFERS_MIB:value}),Number(value));
 for(const value of ['','0','15','4097','999999999999999999999999','1.5','Infinity','64 -c fsync=off',' 128 '])assert.throws(()=>managedSharedBuffers({OBSERVANDA_POSTGRES_SHARED_BUFFERS_MIB:value}),{code:'DATABASE_CONFIG'});
});


test('managed startup checks application credentials before publishing a ready connection',async t=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-runtime-readiness-')),directory=path.join(parent,'database'),env=environment();let service;
 t.after(async()=>{await service?.close();await rm(parent,{recursive:true,force:true});});
 service=await startManagedPostgres({directory,env});const bin=service.bin;
 await query(env,"ALTER ROLE observanda PASSWORD 'changed-disposable-password'");await service.close();service=null;
 await assert.rejects(startManagedPostgres({directory,env}),{code:'DATABASE_RUNTIME'});
 assert.equal(env.OBSERVANDA_DATABASE_URL,undefined);
 await assert.rejects(runtimeCommand(path.join(bin,process.platform==='win32'?'pg_ctl.exe':'pg_ctl'),['-D',path.join(directory,'data'),'status']),{code:'DATABASE_INSTALL'});
});


test('managed readiness admits a slow initial handshake within its startup budget',async t=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-runtime-cold-')),directory=path.join(parent,'database'),env=environment(),peers=new Set(),timers=new Set();let service,proxy;
 t.after(async()=>{for(const timer of timers)clearTimeout(timer);for(const peer of peers)peer.destroy();if(proxy)await new Promise(resolve=>proxy.close(resolve));await service?.close();await rm(parent,{recursive:true,force:true});});
 service=await startManagedPostgres({directory,env});const url=new URL(env.OBSERVANDA_DATABASE_URL);
 proxy=createServer(peer=>{
  const upstream=createConnection({host:'127.0.0.1',port:Number(url.port)});peers.add(peer);peers.add(upstream);
  for(const socket of [peer,upstream])socket.on('error',()=>{});
  peer.on('close',()=>{peers.delete(peer);upstream.destroy();});upstream.on('close',()=>{peers.delete(upstream);peer.destroy();});
  upstream.once('connect',()=>{const timer=setTimeout(()=>{timers.delete(timer);peer.pipe(upstream);upstream.pipe(peer);},5500);timers.add(timer);});
 });
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));const started=performance.now();
 await verifyManagedApplication({port:proxy.address().port,appPassword:decodeURIComponent(url.password)},{signal:AbortSignal.timeout(15000)});
 assert.ok(performance.now()-started>=5500);
});
