import {initializeManagedApplication,initializeClusterIdentity,adoptClusterCredentials} from './postgres-runtime-bootstrap.js';
import {clusterInitArguments,clusterTemplateDirectory,copyClusterTemplate,syncClusterCopy} from './postgres-cluster-template.js';
import {preparePostgresRuntimeGuard} from './postgres-runtime-guard.js';
import {validClusterId} from './database-cluster-identity.js';
import {ensureOwnerRole,dropOwnerCatalogue as dropOwnerCatalogueSQL} from './owner-database-role.js';
import {diagnosticPhase} from './operational-diagnostics.js';
import {connectManagedAdmin,verifyManagedApplication} from './postgres-runtime-readiness.js';
import {assertNotRenaming,workspaceRename} from './workspace-rename-state.js';
// PostgreSQL process lifecycle. Portable clusters belong to their workspace;
// the installation-wide mode exists for older installations and explicit tools.
import path from 'node:path';
import {readdir,rm,chmod,realpath} from 'node:fs/promises';
import {atomicReplace as rename} from './atomic-replace.js';
import {createPersistentDirectory as mkdir} from './filesystem-persistence.js';
import {createReadStream,createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {localStopWitness} from './postgres-stop-witness.js';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {assertRegular,WORKSPACE_FILE} from './storage.js';
import {WindowsProtector} from './security/device-store.js';
import {AppError} from './errors.js';
import {compatibleManagedRuntime} from './postgres-runtime-compatibility.js';
import {seal,unseal} from './encryption.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {nativeResources,databaseMemoryReservation} from './native-resource-budget.js';
import {withUpgradeablePostgresRuntime} from './postgres-runtime-upgrade.js';
import {postgresRuntimeFiles} from './postgres-runtime-files.js';
import {registerRuntimeStorage} from './database-runtime-environment.js';
import {closeIdleConnections} from './database-idle-connections.js';

const windows=process.platform==='win32',suffix=windows?'.exe':'';
export const windowsRuntime=Object.freeze({version:'17.11',url:'https://sbp.enterprisedb.com/getfile.jsp?fileid=1260569',bytes:379726839,sha256:'b9424ee7bc60b52450ff910a3630225df32e633f3cb29c1d126d9299d59aea28'});
const executable=(bin,name)=>path.join(bin,name+suffix);
export function runtimeCommand(command,args,{signal,inherit=false,env=process.env,waitForPipes=true,diagnose=false}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{windowsHide:true,shell:false,stdio:inherit?'inherit':['ignore','pipe','pipe'],signal,env});let output='',failed=false;
  let errors='';child.stdout?.on('data',c=>{if(output.length<8192)output+=c.toString();});if(diagnose)child.stderr?.on('data',c=>{if(errors.length<8192)errors+=c.toString();});else child.stderr?.resume();
  child.once('error',()=>{failed=true;});
  // Abort emits an error before a child necessarily exits. Ordinary helpers
  // also drain their pipes. pg_ctl start deliberately leaves a managed server
  // running; inherited Windows pipe handles must not make startup await stop.
  const finish=code=>{if(code===0&&!failed)resolve(output.trim());else{const error=new AppError(signal?.aborted?'DATABASE_CANCELLED':'DATABASE_INSTALL');error.exitCode=code;if(errors.trim())error.diagnostic=errors.trim();reject(error);}};
  if(!waitForPipes)child.once('exit',code=>{child.stdout?.destroy();child.stderr?.destroy();finish(code);});
  child.once('close',finish);
 });
}
async function version(bin,run=runtimeCommand){
 await assertRegular(executable(bin,'initdb'));await assertRegular(executable(bin,'pg_ctl'));
 const match=/PostgreSQL\) (1[678])(?:[.][0-9]+)?/.exec(await run(executable(bin,'postgres'),['--version'],{capture:true}));
 if(!match)throw new AppError('DATABASE_RUNTIME');return Number(match[1]);
}
export async function findPostgres(env=process.env,checkVersion=version){
 if(env.OBSERVANDA_POSTGRES_BIN){const bin=path.resolve(env.OBSERVANDA_POSTGRES_BIN);return {bin,major:await checkVersion(bin)};}
 const candidates=[...(env.PATH??'').split(path.delimiter)];
 for(const base of [env.ProgramFiles?path.join(env.ProgramFiles,'PostgreSQL'):'','/usr/lib/postgresql'])if(base)for(const entry of (await readdir(base).catch(()=>[])).sort().reverse())candidates.push(path.join(base,entry,'bin'));
 for(const base of ['/opt/homebrew/opt','/usr/local/opt'])for(const n of [17,18,16])candidates.push(path.join(base,'postgresql@'+n,'bin'));
 for(const bin of candidates.filter(Boolean))try{return {bin,major:await checkVersion(bin)};}catch{}
 return null;
}
export async function verifyRuntime(file,manifest=windowsRuntime){
 let bytes=0;const hash=createHash('sha256');for await(const chunk of createReadStream(file)){bytes+=chunk.length;hash.update(chunk);}
 if(bytes!==manifest.bytes||hash.digest('hex')!==manifest.sha256)throw new AppError('DATABASE_INSTALL');
}
export async function downloadRuntime(file,{signal,onProgress=()=>{},manifest=windowsRuntime}={}){
 signal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(15*60*1000)]);
 let url=new URL(manifest.url),response;
 for(let i=0;i<6;i++){
  if(url.protocol!=='https:'||!['sbp.enterprisedb.com','get.enterprisedb.com'].includes(url.hostname)||url.username||url.password)throw new AppError('DATABASE_INSTALL');
  response=await fetch(url,{signal,redirect:'manual'});
  if([301,302,303,307,308].includes(response.status)){await response.body?.cancel();url=new URL(response.headers.get('location'),url);continue;}
  break;
 }
 if(!response?.ok||!response.body)throw new AppError('DATABASE_INSTALL');
 let seen=0,last=-1;
 const meter=new Transform({transform(chunk,encoding,done){seen+=chunk.length;if(seen>manifest.bytes)return done(new AppError('DATABASE_INSTALL'));const percent=Math.floor(100*seen/manifest.bytes);if(percent!==last){last=percent;onProgress({stage:'download',percent});}done(null,chunk);}});
 try{await pipeline(response.body,meter,createWriteStream(file,{flags:'wx',mode:0o600}),{signal});await verifyRuntime(file,manifest);}
 catch(error){await rm(file,{force:true});throw error;}
}
async function install(directory,{signal,onProgress,env,checkVersion=version}){
 const installed=env.OBSERVANDA_POSTGRES_ARCHIVE?null:await findPostgres(env,checkVersion);if(installed)return installed;
 if(windows&&process.arch==='x64'){
  const destination=path.join(directory,'runtime-17.11'),bin=path.join(destination,'pgsql','bin');
  if(await assertRegular(destination,{directory:true,missing:true}))return {bin,major:await checkVersion(bin)};
  const archive=path.join(directory,'postgresql-download.zip'),staging=path.join(directory,'runtime-staging');
  // These fixed staging locations contain only an interrupted managed installation.
  for(const target of [archive,staging]){if(await assertRegular(target,{directory:target===staging,missing:true}))await rm(target,{recursive:target===staging,force:true});}
  try{
   if(env.OBSERVANDA_POSTGRES_ARCHIVE){await verifyRuntime(path.resolve(env.OBSERVANDA_POSTGRES_ARCHIVE));}else await downloadRuntime(archive,{signal,onProgress});onProgress({stage:'extract'});
   await mkdir(staging,{mode:0o700});
   await runtimeCommand(path.join(env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./security/extract-postgres.ps1',import.meta.url)),'-Archive',env.OBSERVANDA_POSTGRES_ARCHIVE?path.resolve(env.OBSERVANDA_POSTGRES_ARCHIVE):archive,'-Destination',staging],{signal});
   await checkVersion(path.join(staging,'pgsql','bin'));await rename(staging,destination);return {bin,major:17};
  }finally{await rm(archive,{force:true});await rm(staging,{recursive:true,force:true});}
 }
 onProgress({stage:'install'});
 // Distribution tools verify package signatures and dependencies. No remote shell scripts.
 if(process.platform==='darwin')await runtimeCommand('brew',['install','postgresql@17'],{signal,inherit:true});
 else if(process.platform==='linux'){
  const manager=await assertRegular('/usr/bin/apt-get',{missing:true})?'apt-get':await assertRegular('/usr/bin/dnf',{missing:true})?'dnf':null;
  if(!manager)throw new AppError('DATABASE_TOOLS');
  const command=process.getuid()===0?manager:'sudo',prefix=command==='sudo'?[manager]:[];
  if(manager==='apt-get')await runtimeCommand(command,[...prefix,'update'],{signal,inherit:true});
  await runtimeCommand(command,[...prefix,'install','-y',...(manager==='apt-get'?['--no-install-recommends','postgresql']:['postgresql-server'])],{signal,inherit:true});
 }else throw new AppError('DATABASE_TOOLS');
 const result=await findPostgres(env,checkVersion);if(!result)throw new AppError('DATABASE_TOOLS');return result;
}
export async function outsideWorkspace(directory){
 for(let current=directory;;current=path.dirname(current)){
  for(const name of [WORKSPACE_FILE,'observanda.json'])if(await assertRegular(path.join(current,name),{missing:true}))throw new AppError('DATABASE_LOCATION');
  if(path.dirname(current)===current)return;
 }
}
async function privateRoot(directory){
 await mkdir(directory,{recursive:true,mode:0o700});await assertRegular(directory,{directory:true});
 if(windows)await diagnosticPhase('runtime-permissions',()=>runtimeCommand(path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./security/private-directory.ps1',import.meta.url)),'-Directory',directory]));
 else await chmod(directory,0o700);
}
async function listener(port){const server=createServer(socket=>socket.destroy());await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return server;}
async function closeListener(server){await new Promise(resolve=>server.close(resolve));}
async function freePort(){const server=await listener(0),port=server.address().port;await closeListener(server);return port;}
async function managerLease(directory){
 const name='observanda-postgres-'+createHash('sha256').update(windows?directory.toLowerCase():directory).digest('hex');
 if(windows||process.platform==='linux'){
  const server=createServer(socket=>socket.destroy());
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(windows?'\\\\.\\pipe\\'+name:'\0'+name,resolve);});}
  catch(error){throw new AppError(error.code==='EADDRINUSE'?'DATABASE_RUNNING':'DATABASE_RUNTIME');}
  return {close:()=>closeListener(server)};
 }
 if(process.platform!=='darwin')throw new AppError('DATABASE_TOOLS');
 // macOS has no abstract sockets. Its system Perl exposes the kernel's flock;
 // the helper releases ownership on stdin EOF, including abrupt parent exit.
 // Never unlink the lock file: doing so would allow locks on different inodes.
 const child=spawn('/usr/bin/perl',[fileURLToPath(new URL('./security/database-lock.pl',import.meta.url)),path.join(directory,'manager.lock')],{stdio:['pipe','pipe','ignore']});
 const exited=new Promise(resolve=>{child.once('exit',resolve);child.once('error',()=>resolve(null));});
 child.stdin.on('error',()=>{});
 try{await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill();reject(new AppError('DATABASE_RUNTIME'));},5000);
  child.once('error',()=>{clearTimeout(timer);reject(new AppError('DATABASE_LOCK_TOOLS'));});
  child.once('exit',code=>{clearTimeout(timer);reject(new AppError(code===73?'DATABASE_RUNNING':'DATABASE_RUNTIME'));});
  child.stdout.once('data',data=>{clearTimeout(timer);data.toString()==='locked\n'?resolve():reject(new AppError('DATABASE_RUNTIME'));});
 });}catch(error){child.stdin.end();await exited;throw error;}
 return {close:async()=>{child.stdin.end();await exited;}};
}
// One cluster serves a workspace and all its owners. Every admitted catalogue
// connection may hold one auxiliary connection (database-admission.js), so the
// process-wide admission limit of 24 needs 48 ordinary slots. Owner role
// creation, login checks and startup verification add short-lived ones; the
// administrator's own work uses the superuser-reserved slots.
export const MANAGED_MAX_CONNECTIONS=64;
// Optional per-cluster budget for large workloads; ordinary owners stay small.
export function managedSharedBuffers(env){
 const value=env.OBSERVANDA_POSTGRES_SHARED_BUFFERS_MIB??'64';
 if(!/^[0-9]+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<16||Number(value)>4096)throw new AppError('DATABASE_CONFIG');
 return Number(value);
}
export function startManagedPostgres(options){return managePostgres({...options,stopOnly:false});}
// Only an authenticated, already-frozen owner can use lifecycle recovery. It
// stops that existing cluster without allocating a port or starting a server.
export function stopManagedPostgres(options){
 if(!options?.workspace||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(options.workspace.deleteId??options.workspace.renameId??options.workspace.moveId??''))throw new AppError('STORAGE_DELETE_STATE');
 return managePostgres({...options,stopOnly:true});
}
async function managePostgres({directory,env=process.env,signal,onProgress=()=>{},workspace=null,runtimeDirectory=null,stopOnly=false,existingOnly=false,budget=nativeResources}){
 if(env.OBSERVANDA_DATABASE_URL){if(stopOnly)throw new AppError('DATABASE_LOCATION');return {managed:false,close:async()=>{}};}
 if(process.getuid?.()===0)throw new AppError('DATABASE_TOOLS');
 const sharedBuffers=stopOnly?64:managedSharedBuffers(env);
 directory=path.resolve(directory);
 if(existingOnly&&!windows){await assertRegular(directory,{directory:true});await assertRegular(path.join(directory,'service.observanda'));await assertRegular(path.join(directory,'data','PG_VERSION'));}
 if(workspace){
  const root=await realpath(workspace.root);await assertRegular(path.join(root,'.observanda'),{directory:true});
  if(directory!==path.join(root,'.observanda','postgresql')||!Buffer.isBuffer(workspace.vault?.key)||workspace.vault.key.length!==32||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(workspace.vault.id??'')||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(workspace.ownerId??''))throw new AppError('DATABASE_LOCATION');
  if(!windows)await assertRegular(directory,{directory:true,missing:!stopOnly});
 }else await outsideWorkspace(directory);
 // Keep the installation-wide manager name while old stopped data is upgraded;
 // the private runtime and its native owner lease remain the only data format.
 const installationLease=windows&&!workspace?await managerLease(directory):null;
 // A new cluster is copied from the installation's template, which has its
 // own guard. Its process starts now, alongside this cluster's guard; the
 // missing state file is only a hint, and the guard is closed if unused.
 let templateGuard=null;
 try{
  if(runtimeDirectory&&!stopOnly&&!existingOnly&&!await assertRegular(path.join(directory,'service.observanda'),{missing:true}).catch(()=>true))templateGuard=await preparePostgresRuntimeGuard();
  const service=await withUpgradeablePostgresRuntime({directory,create:!stopOnly&&!existingOnly,workspaceRoot:workspace?.root,workspace,env,stopOnly,run:runtimeCommand,signal,onProgress},guard=>manageGuardedPostgres({directory:guard.directory,env,signal,onProgress,workspace,runtimeDirectory,stopOnly,existingOnly,budget,sharedBuffers,guard,templateGuard}));
  if(!installationLease)return service;let closing;return {...service,close:()=>closing??=(async()=>{try{await service.close();}finally{await installationLease.close();}})()};
 }catch(error){await installationLease?.close();throw error;}
 finally{await templateGuard?.close();}
}
async function manageGuardedPostgres({directory,env,signal,onProgress,workspace,runtimeDirectory,stopOnly,existingOnly,budget,sharedBuffers,guard,templateGuard=null}){
 const files=postgresRuntimeFiles(guard),checkVersion=bin=>version(bin,(command,args,options)=>guard.run(command,args,options));
 // Kernel-owned locks cannot collide with unrelated TCP services.
 const ownership=guard.lease??await (workspace?workspaceDatabaseLease(directory):managerLease(directory));
 let leaseClosing;const lease={close:()=>leaseClosing??=(async()=>{
  try{await ownership.close();}finally{
   const result=await guard.close();
   // A stop-only job launched no postmaster. Its exit proves nothing about
   // a different job that may still hold the cluster.
   if(result?.stopped&&!stopOnly)mayBeRunning=false;
  }
 })()};
 const stateFile=path.join(directory,'service.observanda'),data=path.join(directory,'data'),portableKey=workspace?Buffer.from(workspace.vault.key):null;
 const aad=workspace?'Observanda/workspace-postgresql/v1/'+workspace.vault.id:null;
 const protector=workspace?{protect:bytes=>seal(bytes,portableKey,aad),unprotect:bytes=>unseal(bytes,portableKey,aad)}:windows?new WindowsProtector():null;
 let config,verifiedCluster=false,freshCluster=false,reservation,mayBeRunning=false,syncing=null;
 const releaseCapacity=()=>{if(mayBeRunning)reservation?.uncertainExit();else{reservation?.release();if(verifiedCluster)budget.stopped(directory);}};
 const save=async()=>{const bytes=Buffer.from(JSON.stringify(config));try{await files.write(stateFile,protector?await protector.protect(bytes):bytes);}finally{bytes.fill(0);}};
 const ctl=(args,options={})=>{const run=()=>guard.run(executable(config.bin,'pg_ctl'),['-D',data,...args],options);return args.includes('start')?diagnosticPhase('runtime-start',run):args.includes('status')?diagnosticPhase('runtime-status',run):run();};
 // pg_ctl reports a failed stop when the server exited first, for example when
 // its previous owner was terminated during the request. Only a server that
 // pg_ctl still finds running (status exit 3 means stopped) is a failure.
 const serverStopped=async()=>{try{await ctl(['status']);return false;}catch(status){if(status.exitCode===3)return true;throw status;}};
 const stopServer=async()=>{try{await ctl(['-m','fast','-w','-t','60','stop']);}catch(error){if(error.code!=='DATABASE_INSTALL'||!await serverStopped().catch(()=>false))throw error;}};
 try{
  if(!stopOnly){reservation=budget.reserve('database',databaseMemoryReservation(sharedBuffers),{key:directory});mayBeRunning=reservation.uncertain;}
  if(workspace){
   const {assertNotDeleting,workspaceDeletion}=await import('./workspace-delete-state.js');await assertNotDeleting(workspace.root,stopOnly?workspace.deleteId:undefined);
   if(!stopOnly){const {assertNotMoving}=await import('./workspace-move-state.js');await assertNotMoving(workspace.root);}
   if(stopOnly&&workspace.moveId){const {ownedMoveSource}=await import('./workspace-move-state.js');if((await ownedMoveSource(workspace.root))?.id!==workspace.moveId)throw new AppError('STORAGE_MOVE_STATE');await assertNotRenaming(workspace.root);}
   else if(stopOnly&&workspace.renameId){const marker=await workspaceRename(workspace.root);if(marker?.id!==workspace.renameId)throw new AppError('STORAGE_RENAME_STATE');}
   else{await assertNotRenaming(workspace.root);if(stopOnly){const marker=await workspaceDeletion(workspace.root);if(marker?.id!==workspace.deleteId||marker.source!==workspace.root)throw new AppError('STORAGE_DELETE_STATE');}}
  }
  const stat=await files.stat(stateFile,{missing:true});
  if(stat){
   if(stat.size>16384)throw new AppError('DATABASE_RUNTIME');
   let bytes=await files.read(stateFile);try{if(protector)bytes=await protector.unprotect(bytes);config=JSON.parse(bytes.toString());}finally{bytes.fill(0);}
   if(config.format!==1||![16,17,18].includes(config.major)||!['initializing','ready'].includes(config.phase)||!Number.isInteger(config.port)||config.port<1||config.port>65535||![config.adminPassword,config.appPassword].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||!path.isAbsolute(config.bin))throw new AppError('DATABASE_RUNTIME');
   // Only a cluster still initializing from the template carries these.
   if(config.bootstrapPassword!==undefined&&(config.phase!=='initializing'||!/^[a-f0-9]{64}$/.test(config.bootstrapPassword))||config.templateCopy!==undefined&&(config.phase!=='initializing'||config.templateCopy!==true))throw new AppError('DATABASE_RUNTIME');
   if(workspace&&(config.workspaceId!==workspace.vault.id||typeof config.running!=='boolean'||typeof config.ownerId!=='string'))throw new AppError('DATABASE_RUNTIME');
   // Clusters made before cluster identities are converted outside the
   // product. Refuse them before any process is stopped or started.
   if(!validClusterId(config.clusterId))throw new AppError(config.clusterId===undefined?'DATABASE_CLUSTER_RETIRED':'DATABASE_RUNTIME');
   // Never stop a PostgreSQL process owned by another installation sharing
   // this folder. A clean shutdown makes an ordinary disk transfer portable.
   if(workspace&&config.running&&(config.ownerId!==workspace.ownerId||config.activeDirectory!==directory))throw new AppError('DATABASE_WORKSPACE_RUNNING');
   config.bin=await diagnosticPhase('runtime-version',()=>compatibleManagedRuntime(config,env.OBSERVANDA_POSTGRES_BIN,checkVersion));
  }else{
   if(existingOnly||stopOnly||await files.stat(data,{directory:true,missing:true}))throw new AppError('DATABASE_RUNTIME');
   let runtime;
   if(workspace){
    runtime=await findPostgres(env,checkVersion);
    if(!runtime){if(!runtimeDirectory)throw new AppError('DATABASE_TOOLS');runtimeDirectory=path.resolve(runtimeDirectory);await outsideWorkspace(runtimeDirectory);await privateRoot(runtimeDirectory);runtime=await install(runtimeDirectory,{env,signal,onProgress,checkVersion});}
   }else runtime=await install(runtimeDirectory??directory,{env,signal,onProgress,checkVersion});
   config={format:1,...runtime,phase:'initializing',clusterId:randomUUID(),port:await freePort(),adminPassword:randomBytes(32).toString('hex'),appPassword:randomBytes(32).toString('hex'),...(workspace?{workspaceId:workspace.vault.id,ownerId:workspace.ownerId,running:false,activeDirectory:null}:{})};await save();
  }
  if(existingOnly&&config.phase!=='ready')throw new AppError('DATABASE_RUNTIME');
  const stage=path.join(directory,'cluster-staging');
  // A template copy whose flush had not finished when its process ended may
  // have lost data. Nothing was stored in it yet: discard it and copy again.
  if(config.templateCopy&&!stopOnly&&await files.stat(data,{directory:true,missing:true})){
   if(config.phase!=='initializing'||!await serverStopped())throw new AppError('DATABASE_RUNNING');
   await files.removeTree(data);
  }
  if(!await files.stat(data,{directory:true,missing:true})){
   if(stopOnly){
    // Initialization writes its state before initdb and cannot start PostgreSQL
    // before the completed data directory is published.
    if(config.phase!=='initializing'||config.running!==false)throw new AppError('DATABASE_RUNTIME');
    let closing;return {managed:true,stopped:true,major:config.major,bin:config.bin,close:()=>closing??=(async()=>{portableKey?.fill(0);await lease.close();})()};
   }
   if(config.phase!=='initializing')throw new AppError('DATABASE_RUNTIME');
   if(await files.stat(stage,{directory:true,missing:true}))await files.removeTree(stage);
   onProgress({stage:'initialize'});
   if(runtimeDirectory){
    // initdb runs once per installation and PostgreSQL version; this cluster
    // is a copy whose credentials are replaced when it first starts. The
    // state names the template password before the copy is published.
    const template=clusterTemplateDirectory(runtimeDirectory,config.major);await outsideWorkspace(template);
    const copied=await diagnosticPhase('runtime-template',()=>copyClusterTemplate({runtimeDirectory,major:config.major,bin:config.bin,stage,lease:managerLease,run:runtimeCommand,prepared:templateGuard,signal}));
    config.bootstrapPassword=copied.adminPassword;config.templateCopy=true;await save();
    await files.rename(stage,data);freshCluster=true;
    syncing=syncClusterCopy(data,copied.members,signal);void syncing.catch(()=>{});
   }else{
    const passwordFile=path.join(directory,'bootstrap-password');await files.write(passwordFile,config.adminPassword);
    try{await guard.run(executable(config.bin,'initdb'),clusterInitArguments(stage,passwordFile),{signal});await files.rename(stage,data);freshCluster=true;}
    finally{await files.unlink(passwordFile);}
   }
  }
  if((await files.read(path.join(data,'PG_VERSION'),{limit:128,encoding:'utf8'})).trim()!==String(config.major))throw new AppError('DATABASE_RUNTIME');
  verifiedCluster=true;
  mayBeRunning=!!await files.stat(path.join(data,'postmaster.pid'),{missing:true});
  let running=false,statusExit;try{await ctl(['status']);running=true;}catch(error){statusExit=error.exitCode;}
  // The deletion owner has already closed its managed instance. A live PID
  // seen by a newly acquired Windows guard could belong to another cluster.
  if(running&&windows&&stopOnly&&workspace?.deleteId)throw new AppError('DATABASE_RUNNING');
  if(running){await stopServer();mayBeRunning=false;}
  if(stopOnly){
   if(mayBeRunning&&statusExit===3&&workspace?.deleteId&&(await localStopWitness({guard,config,workspace,data,verify:true}))?.stopped)mayBeRunning=false;
   if(mayBeRunning)throw new AppError('DATABASE_RUNNING');budget.stopped(directory);config.running=false;await save();let closing;
   return {managed:true,stopped:true,major:config.major,bin:config.bin,close:()=>closing??=(async()=>{portableKey?.fill(0);await lease.close();})()};
  }
  onProgress({stage:'start'});
  // Foreground app owns lifecycle; recovery after app termination stops only this cluster.
  // WAL recovery on network storage can exceed a minute. Wait for readiness
  // before treating a healthy recovering server as a failed startup.
  const startupDeadline=performance.now()+900000;
  // A start that pg_ctl reports but never launched (status finds the cluster
  // stopped, the log unchanged) is retried on a fresh port; any other state is
  // an error. The guard's start output pipe removes the known cause, cmd.exe
  // failing to redirect a shared NUL standard output to the server log.
  for(let attempt=1;;attempt++){
   config.port=await freePort();if(workspace){config.ownerId=workspace.ownerId;config.running=true;config.activeDirectory=directory;delete config.localStopTicket;}await save();
   mayBeRunning=true;
   try{await ctl(['-l',path.join(directory,'postgresql.log'),'-o','-h 127.0.0.1 -p '+config.port+' -c max_connections='+MANAGED_MAX_CONNECTIONS+' -c shared_buffers='+sharedBuffers+'MB -c work_mem=4MB -c temp_buffers=8MB -c max_parallel_workers=2 -c max_parallel_workers_per_gather=1 -c unix_socket_directories= -c password_encryption=scram-sha-256 -c log_statement=none','-w','-t','900','start'],{signal,waitForPipes:false,diagnose:true});break;}
   catch(error){if(error.code!=='DATABASE_INSTALL'||attempt>=3||signal?.aborted||!await serverStopped().catch(()=>false))throw error;mayBeRunning=false;await new Promise(resolve=>setTimeout(resolve,500*attempt));}
  }
  // The template password stays recorded until ready: a copy interrupted
  // before then is discarded and copied again (see templateCopy above).
  if(config.bootstrapPassword)await diagnosticPhase('runtime-connect',()=>adoptClusterCredentials(config,{signal,deadline:startupDeadline}));
  const admin=await diagnosticPhase('runtime-connect',()=>connectManagedAdmin(config,{signal,deadline:startupDeadline}));
  try{
   if(config.phase==='initializing')await initializeManagedApplication(admin,config,{freshCluster});
  }finally{await admin.end();}
  // The identity is committed before the ready phase is saved below.
  if(config.phase==='initializing'){
   const owner=await diagnosticPhase('runtime-connect',()=>connectManagedAdmin(config,{signal,deadline:startupDeadline,database:'observanda'}));
   try{await initializeClusterIdentity(owner,config);}finally{await owner.end();}
  }
  await verifyManagedApplication(config,{signal});
  if(workspace&&guard.stopWitness){
   const witness=await localStopWitness({guard,config,workspace,data}).catch(error=>{
    if(error.code==='DATABASE_GUARD_UNAVAILABLE')throw error;
    return null;
   });
   if(witness?.ticket)config.localStopTicket=witness.ticket;
  }
  if(config.phase==='initializing'){
   // A template copy is published as ready only once it is durable.
   if(config.templateCopy){if(!syncing)throw new AppError('DATABASE_RUNTIME');await syncing;delete config.templateCopy;delete config.bootstrapPassword;}
   config.phase='ready';await save();
  }
  else if(config.localStopTicket){
   // The required running configuration was already saved before launch.
   // Failure to persist optional proof leaves deletion recovery conservative.
   try{await save();}catch(error){if(error.code==='DATABASE_GUARD_UNAVAILABLE')throw error;delete config.localStopTicket;}
  }
  signal?.throwIfAborted();
  reservation?.confirmed();
  env.OBSERVANDA_DATABASE_URL='postgresql://observanda:'+config.appPassword+'@127.0.0.1:'+config.port+'/observanda';
  const retireStorage=registerRuntimeStorage(env,directory);let closing;
  // Projects and lab books of this workspace log in with their own roles
  // (owner-database-role.js). Only this running service holds the
  // administrator credentials that create such a role; it never resets one.
  const ensured=new Set();
  const ownerRole=async(role,password,{signal:request}={})=>{
   if(closing)throw new AppError('DATABASE_CANCELLED');if(ensured.has(role))return;
   const admin=await connectManagedAdmin(config,{signal:request,database:'observanda'});
   try{await ensureOwnerRole(admin,{role,password});}finally{await admin.end();}
   if(closing)throw new AppError('DATABASE_CANCELLED');ensured.add(role);
  };
  // Deletion and retirement remove an owner's catalogue, then its role once
  // the role owns nothing else in this cluster.
  const dropOwnerCatalogue=async(role,catalogueId,{signal:request}={})=>{
   if(closing)throw new AppError('DATABASE_CANCELLED');
   const admin=await connectManagedAdmin(config,{signal:request,database:'observanda'});
   try{const result=await dropOwnerCatalogueSQL(admin,{role,catalogueId});if(result.roleDropped)ensured.delete(role);return result;}finally{await admin.end();}
  };
  return {managed:true,major:config.major,bin:config.bin,clusterId:config.clusterId,ownerRole,dropOwnerCatalogue,close:()=>closing??=(async()=>{const parked=closeIdleConnections(env,{cluster:true});retireStorage();ensured.clear();try{await parked;await stopServer();mayBeRunning=false;if(workspace){config.running=false;await save();}}finally{try{await lease.close();}finally{releaseCapacity();portableKey?.fill(0);delete env.OBSERVANDA_DATABASE_URL;}}})()};
 }catch(error){
  await syncing?.catch(()=>{});
  // pg_ctl can finish starting just as cancellation arrives: stop the owned cluster too.
  if(verifiedCluster&&!stopOnly)await stopServer().then(async()=>{mayBeRunning=false;if(workspace){config.running=false;await save();}}).catch(async()=>{try{if(!await files.stat(path.join(data,'postmaster.pid'),{missing:true}))mayBeRunning=false;}catch{/* An unreachable volume cannot prove process exit. */}});
  try{await lease.close();}finally{releaseCapacity();portableKey?.fill(0);}
  if(error instanceof AppError)throw error;
  throw new AppError(signal?.aborted?'DATABASE_CANCELLED':'DATABASE_RUNTIME');
 }
}
