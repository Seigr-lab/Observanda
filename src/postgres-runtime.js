import {verifyManagedApplication} from './postgres-runtime-readiness.js';
import {assertNotRenaming,workspaceRename} from './workspace-rename-state.js';
// PostgreSQL process lifecycle. Portable clusters belong to their workspace;
// the installation-wide mode exists for older installations and explicit tools.
import path from 'node:path';
import {mkdir,readFile,readdir,rename,rm,chmod,realpath} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createHash,randomBytes} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {Client} from 'pg';
import {assertRegular,atomicWrite,WORKSPACE_FILE} from './storage.js';
import {WindowsProtector} from './security/device-store.js';
import {AppError} from './errors.js';
import {compatibleManagedRuntime} from './postgres-runtime-compatibility.js';
import {seal,unseal} from './encryption.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';

const windows=process.platform==='win32',suffix=windows?'.exe':'';
export const windowsRuntime=Object.freeze({version:'17.11',url:'https://sbp.enterprisedb.com/getfile.jsp?fileid=1260569',bytes:379726839,sha256:'b9424ee7bc60b52450ff910a3630225df32e633f3cb29c1d126d9299d59aea28'});
const executable=(bin,name)=>path.join(bin,name+suffix);
export function runtimeCommand(command,args,{signal,inherit=false,env=process.env}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{windowsHide:true,shell:false,stdio:inherit?'inherit':['ignore','pipe','pipe'],signal,env});let output='',failed=false;
  child.stdout?.on('data',c=>{if(output.length<8192)output+=c.toString();});child.stderr?.resume();
  child.once('error',()=>{failed=true;reject(new AppError(signal?.aborted?'DATABASE_CANCELLED':'DATABASE_INSTALL'));});
  child.once('exit',code=>{child.stdout?.destroy();child.stderr?.destroy();code===0&&!failed?resolve(output.trim()):reject(new AppError(signal?.aborted?'DATABASE_CANCELLED':'DATABASE_INSTALL'));});
 });
}
async function version(bin){
 await assertRegular(executable(bin,'initdb'));await assertRegular(executable(bin,'pg_ctl'));
 const match=/PostgreSQL\) (1[678])(?:[.][0-9]+)?/.exec(await runtimeCommand(executable(bin,'postgres'),['--version']));
 if(!match)throw new AppError('DATABASE_RUNTIME');return Number(match[1]);
}
export async function findPostgres(env=process.env){
 if(env.OBSERVANDA_POSTGRES_BIN){const bin=path.resolve(env.OBSERVANDA_POSTGRES_BIN);return {bin,major:await version(bin)};}
 const candidates=[...(env.PATH??'').split(path.delimiter)];
 for(const base of [env.ProgramFiles?path.join(env.ProgramFiles,'PostgreSQL'):'','/usr/lib/postgresql'])if(base)for(const entry of (await readdir(base).catch(()=>[])).sort().reverse())candidates.push(path.join(base,entry,'bin'));
 for(const base of ['/opt/homebrew/opt','/usr/local/opt'])for(const n of [17,18,16])candidates.push(path.join(base,'postgresql@'+n,'bin'));
 for(const bin of candidates.filter(Boolean))try{return {bin,major:await version(bin)};}catch{}
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
async function install(directory,{signal,onProgress,env}){
 const installed=env.OBSERVANDA_POSTGRES_ARCHIVE?null:await findPostgres(env);if(installed)return installed;
 if(windows&&process.arch==='x64'){
  const destination=path.join(directory,'runtime-17.11'),bin=path.join(destination,'pgsql','bin');
  if(await assertRegular(destination,{directory:true,missing:true}))return {bin,major:await version(bin)};
  const archive=path.join(directory,'postgresql-download.zip'),staging=path.join(directory,'runtime-staging');
  // These fixed staging locations contain only an interrupted managed installation.
  for(const target of [archive,staging]){if(await assertRegular(target,{directory:target===staging,missing:true}))await rm(target,{recursive:target===staging,force:true});}
  try{
   if(env.OBSERVANDA_POSTGRES_ARCHIVE){await verifyRuntime(path.resolve(env.OBSERVANDA_POSTGRES_ARCHIVE));}else await downloadRuntime(archive,{signal,onProgress});onProgress({stage:'extract'});
   await mkdir(staging,{mode:0o700});
   await runtimeCommand(path.join(env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./security/extract-postgres.ps1',import.meta.url)),'-Archive',env.OBSERVANDA_POSTGRES_ARCHIVE?path.resolve(env.OBSERVANDA_POSTGRES_ARCHIVE):archive,'-Destination',staging],{signal});
   await version(path.join(staging,'pgsql','bin'));await rename(staging,destination);return {bin,major:17};
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
 const result=await findPostgres(env);if(!result)throw new AppError('DATABASE_TOOLS');return result;
}
export async function outsideWorkspace(directory){
 for(let current=directory;;current=path.dirname(current)){
  for(const name of [WORKSPACE_FILE,'observanda.json'])if(await assertRegular(path.join(current,name),{missing:true}))throw new AppError('DATABASE_LOCATION');
  if(path.dirname(current)===current)return;
 }
}
async function privateRoot(directory){
 await mkdir(directory,{recursive:true,mode:0o700});await assertRegular(directory,{directory:true});
 if(windows)await runtimeCommand(path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./security/private-directory.ps1',import.meta.url)),'-Directory',directory]);
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
async function managePostgres({directory,env=process.env,signal,onProgress=()=>{},workspace=null,runtimeDirectory=null,stopOnly=false}){
 if(env.OBSERVANDA_DATABASE_URL){if(stopOnly)throw new AppError('DATABASE_LOCATION');return {managed:false,close:async()=>{}};}
 if(process.getuid?.()===0)throw new AppError('DATABASE_TOOLS');
 const sharedBuffers=stopOnly?64:managedSharedBuffers(env);
 directory=path.resolve(directory);
 if(workspace){
  const root=await realpath(workspace.root);await assertRegular(path.join(root,'.observanda'),{directory:true});
  if(directory!==path.join(root,'.observanda','postgresql')||!Buffer.isBuffer(workspace.vault?.key)||workspace.vault.key.length!==32||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(workspace.vault.id??'')||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(workspace.ownerId??''))throw new AppError('DATABASE_LOCATION');
  await assertRegular(directory,{directory:true,missing:!stopOnly});if(!stopOnly)await privateRoot(directory);directory=await realpath(directory);
  if(directory!==path.join(root,'.observanda','postgresql'))throw new AppError('DATABASE_LOCATION');
 }else{await outsideWorkspace(directory);await privateRoot(directory);directory=await realpath(directory);await outsideWorkspace(directory);}
 // Kernel-owned locks cannot collide with unrelated TCP services.
 const lease=await (workspace?workspaceDatabaseLease(directory):managerLease(directory));
 const stateFile=path.join(directory,'service.observanda'),data=path.join(directory,'data'),portableKey=workspace?Buffer.from(workspace.vault.key):null;
 const aad=workspace?'Observanda/workspace-postgresql/v1/'+workspace.vault.id:null;
 const protector=workspace?{protect:bytes=>seal(bytes,portableKey,aad),unprotect:bytes=>unseal(bytes,portableKey,aad)}:windows?new WindowsProtector():null;
 let config,verifiedCluster=false;
 const save=async()=>{const bytes=Buffer.from(JSON.stringify(config));try{await atomicWrite(stateFile,protector?await protector.protect(bytes):bytes);}finally{bytes.fill(0);}};
 const ctl=(args,options={})=>runtimeCommand(executable(config.bin,'pg_ctl'),['-D',data,...args],options);
 try{
  if(workspace){
   const {assertNotDeleting,workspaceDeletion}=await import('./workspace-delete-state.js');await assertNotDeleting(workspace.root,stopOnly?workspace.deleteId:undefined);
   if(!stopOnly){const {assertNotMoving}=await import('./workspace-move-state.js');await assertNotMoving(workspace.root);}
   if(stopOnly&&workspace.moveId){const {ownedMoveSource}=await import('./workspace-move-state.js');if((await ownedMoveSource(workspace.root))?.id!==workspace.moveId)throw new AppError('STORAGE_MOVE_STATE');await assertNotRenaming(workspace.root);}
   else if(stopOnly&&workspace.renameId){const marker=await workspaceRename(workspace.root);if(marker?.id!==workspace.renameId)throw new AppError('STORAGE_RENAME_STATE');}
   else{await assertNotRenaming(workspace.root);if(stopOnly){const marker=await workspaceDeletion(workspace.root);if(marker?.id!==workspace.deleteId||marker.source!==workspace.root)throw new AppError('STORAGE_DELETE_STATE');}}
  }
  const stat=await assertRegular(stateFile,{missing:true});
  if(stat){
   if(stat.size>16384)throw new AppError('DATABASE_RUNTIME');
   let bytes=await readFile(stateFile);try{if(protector)bytes=await protector.unprotect(bytes);config=JSON.parse(bytes.toString());}finally{bytes.fill(0);}
   if(config.format!==1||![16,17,18].includes(config.major)||!['initializing','ready'].includes(config.phase)||!Number.isInteger(config.port)||config.port<1||config.port>65535||![config.adminPassword,config.appPassword].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||!path.isAbsolute(config.bin))throw new AppError('DATABASE_RUNTIME');
   if(workspace&&(config.workspaceId!==workspace.vault.id||typeof config.running!=='boolean'||typeof config.ownerId!=='string'))throw new AppError('DATABASE_RUNTIME');
   // Never stop a PostgreSQL process owned by another installation sharing
   // this folder. A clean shutdown makes an ordinary disk transfer portable.
   if(workspace&&config.running&&(config.ownerId!==workspace.ownerId||config.activeDirectory!==directory))throw new AppError('DATABASE_WORKSPACE_RUNNING');
   config.bin=await compatibleManagedRuntime(config,env.OBSERVANDA_POSTGRES_BIN,version);
  }else{
   if(stopOnly||await assertRegular(data,{directory:true,missing:true}))throw new AppError('DATABASE_RUNTIME');
   let runtime;
   if(workspace){
    runtime=await findPostgres(env);
    if(!runtime){if(!runtimeDirectory)throw new AppError('DATABASE_TOOLS');runtimeDirectory=path.resolve(runtimeDirectory);await outsideWorkspace(runtimeDirectory);await privateRoot(runtimeDirectory);runtime=await install(runtimeDirectory,{env,signal,onProgress});}
   }else runtime=await install(runtimeDirectory??directory,{env,signal,onProgress});
   config={format:1,...runtime,phase:'initializing',port:await freePort(),adminPassword:randomBytes(32).toString('hex'),appPassword:randomBytes(32).toString('hex'),...(workspace?{workspaceId:workspace.vault.id,ownerId:workspace.ownerId,running:false,activeDirectory:null}:{})};await save();
  }
  const stage=path.join(directory,'cluster-staging');
  if(!await assertRegular(data,{directory:true,missing:true})){
   if(stopOnly){
    // Initialization writes its state before initdb and cannot start PostgreSQL
    // before the completed data directory is published.
    if(config.phase!=='initializing'||config.running!==false)throw new AppError('DATABASE_RUNTIME');
    let closing;return {managed:true,stopped:true,major:config.major,bin:config.bin,close:()=>closing??=(async()=>{portableKey?.fill(0);await lease.close();})()};
   }
   if(config.phase!=='initializing')throw new AppError('DATABASE_RUNTIME');
   if(await assertRegular(stage,{directory:true,missing:true}))await rm(stage,{recursive:true,force:true});
   const passwordFile=path.join(directory,'bootstrap-password');await atomicWrite(passwordFile,config.adminPassword);
   try{onProgress({stage:'initialize'});await runtimeCommand(executable(config.bin,'initdb'),['-D',stage,'-U','observanda_admin','--pwfile='+passwordFile,'--auth-host=scram-sha-256','--auth-local=scram-sha-256','--encoding=UTF8','--no-locale','--data-checksums'],{signal});await rename(stage,data);}
   finally{await rm(passwordFile,{force:true});}
  }
  if((await readFile(path.join(data,'PG_VERSION'),'utf8')).trim()!==String(config.major))throw new AppError('DATABASE_RUNTIME');
  verifiedCluster=true;
  let running=false;try{await ctl(['status']);running=true;}catch{}
  if(running)await ctl(['-m','fast','-w','-t','60','stop']);
  if(stopOnly){
   config.running=false;await save();let closing;
   return {managed:true,stopped:true,major:config.major,bin:config.bin,close:()=>closing??=(async()=>{portableKey?.fill(0);await lease.close();})()};
  }
  config.port=await freePort();if(workspace){config.ownerId=workspace.ownerId;config.running=true;config.activeDirectory=directory;}await save();
  onProgress({stage:'start'});
  // Foreground app owns lifecycle; recovery after app termination stops only this cluster.
  await ctl(['-l',path.join(directory,'postgresql.log'),'-o','-h 127.0.0.1 -p '+config.port+' -c max_connections=32 -c shared_buffers='+sharedBuffers+'MB -c unix_socket_directories= -c password_encryption=scram-sha-256 -c log_statement=none','-w','-t','60','start'],{signal});
  const admin=new Client({host:'127.0.0.1',port:config.port,user:'observanda_admin',password:config.adminPassword,database:'postgres',connectionTimeoutMillis:5000});admin.on('error',()=>{});
  try{
   await admin.connect();
   if(config.phase==='initializing'){
    if(!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='observanda'")).rowCount)await admin.query("CREATE ROLE observanda LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+config.appPassword+"'");
    if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='observanda'")).rowCount)await admin.query('CREATE DATABASE observanda OWNER observanda');
    await admin.query('REVOKE ALL ON DATABASE observanda FROM PUBLIC');
   }
  }finally{await admin.end();}
  await verifyManagedApplication(config,{signal});
  if(config.phase==='initializing'){config.phase='ready';await save();}
  signal?.throwIfAborted();
  env.OBSERVANDA_DATABASE_URL='postgresql://observanda:'+config.appPassword+'@127.0.0.1:'+config.port+'/observanda';
  let closing;
  return {managed:true,major:config.major,bin:config.bin,close:()=>closing??=(async()=>{try{await ctl(['-m','fast','-w','-t','60','stop']);if(workspace){config.running=false;await save();}}finally{portableKey?.fill(0);delete env.OBSERVANDA_DATABASE_URL;await lease.close();}})()};
 }catch(error){
  // pg_ctl can finish starting just as cancellation arrives: stop the owned cluster too.
  if(verifiedCluster)await ctl(['-m','fast','-w','-t','60','stop']).then(async()=>{if(workspace){config.running=false;await save();}}).catch(()=>{});
  portableKey?.fill(0);
  await lease.close();
  if(error instanceof AppError)throw error;
  throw new AppError(signal?.aborted?'DATABASE_CANCELLED':'DATABASE_RUNTIME');
 }
}
