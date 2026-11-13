// One initdb per installation and PostgreSQL version. Every new managed
// cluster is a byte copy of this pristine template; the ordinary bootstrap
// then gives the copy its own administrator and application passwords, its
// own cluster identity and its own settings, as it does after initdb.
//
// The template is a private runtime directory admitted by its own guard,
// exactly like a cluster: only the current user, SYSTEM and administrators
// can change it, so its manifest (including the template's bootstrap
// password) is authentic whenever the guard admits the directory. A digest of
// the whole data tree detects damage; a damaged or mismatched template is
// removed and rebuilt, never used.
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {lstat,mkdir,open,readdir,rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {acquirePostgresRuntimeGuard} from './postgres-runtime-guard.js';
import {postgresRuntimeFiles} from './postgres-runtime-files.js';
import {AppError} from './errors.js';

const windows=process.platform==='win32',suffix=windows?'.exe':'';
const MANIFEST='template.observanda',LEASE_WAIT_MS=120000,COPY_CONCURRENCY=8;
// Shared by initdb for a template and initdb for a cluster without one.
export const clusterInitArguments=(data,passwordFile)=>['-D',data,'-U','observanda_admin','--pwfile='+passwordFile,'--auth-host=scram-sha-256','--auth-local=scram-sha-256','--encoding=UTF8','--no-locale','--data-checksums'];
export const clusterTemplateDirectory=(runtimeDirectory,major)=>path.join(path.resolve(runtimeDirectory),'cluster-template-'+major);
const damaged=reason=>Object.assign(new AppError('DATABASE_RUNTIME'),{templateDamaged:true,reason});
const within=(parent,child)=>{const relative=path.relative(parent,child);return relative===''||!relative.startsWith('..')&&!path.isAbsolute(relative);};

// Only one process builds or copies a template at a time. The lease is a
// kernel object released with its process, so a killed run never blocks the
// next one; a lease held longer than the wait is refused, never waited on.
async function templateLease(lease,directory,signal){
 const deadline=performance.now()+LEASE_WAIT_MS;
 for(;;){
  signal?.throwIfAborted();
  try{return await lease(directory);}
  catch(error){if(error.code!=='DATABASE_RUNNING'||performance.now()>=deadline)throw error;}
  await delay(100,undefined,{signal}).catch(()=>{throw new AppError('DATABASE_CANCELLED');});
 }
}
// Regular files and directories only: a link or reparse point in a data tree
// is damage, whatever it points to.
async function inventory(data){
 const directories=[],files=[];
 const walk=async relative=>{
  const entries=(await readdir(path.join(data,relative),{withFileTypes:true})).map(entry=>entry.name).sort();
  for(const name of entries){
   const member=relative?relative+'/'+name:name,info=await lstat(path.join(data,member));
   if(info.isDirectory()){directories.push(member);await walk(member);}
   else if(info.isFile())files.push({relative:member,bytes:info.size});
   else throw damaged('unsupported-member');
  }
 };
 const root=await lstat(data);if(!root.isDirectory())throw damaged('missing-data');
 await walk('');return {directories,files};
}
const treeDigest=(directories,files)=>{
 const hash=createHash('sha256');
 for(const value of directories)hash.update('d\0'+value+'\n');
 for(const value of [...files].sort((a,b)=>a.relative<b.relative?-1:a.relative>b.relative?1:0))hash.update('f\0'+value.relative+'\0'+value.bytes+'\0'+value.sha256+'\n');
 return hash.digest('hex');
};
async function runQueue(items,worker){let next=0;await Promise.all(Array.from({length:Math.min(COPY_CONCURRENCY,items.length)},async()=>{while(next<items.length)await worker(items[next++]);}));}
async function hashFile(file){const handle=await open(file,'r');try{return createHash('sha256').update(await handle.readFile()).digest('hex');}finally{await handle.close();}}
async function copyTree(source,target,signal){
 const {directories,files}=await inventory(source);
 if(files.some(file=>file.relative==='postmaster.pid'||file.relative==='postmaster.opts'))throw damaged('template-was-started');
 await mkdir(target,{mode:0o700});
 for(const relative of directories){signal?.throwIfAborted();await mkdir(path.join(target,relative),{mode:0o700});}
 await runQueue(files,async file=>{
  signal?.throwIfAborted();
  const reader=await open(path.join(source,file.relative),'r');let bytes;try{bytes=await reader.readFile();}finally{await reader.close();}
  if(bytes.length!==file.bytes)throw damaged('changed-member');
  file.sha256=createHash('sha256').update(bytes).digest('hex');
  const writer=await open(path.join(target,file.relative),'wx',0o600);try{await writer.writeFile(bytes);}finally{await writer.close();}
 });
 return {digest:treeDigest(directories,files),directories,files:files.map(file=>file.relative)};
}
// The copy is written without flushing so that the server can start at once;
// this pass makes it durable while the copy is bootstrapped. Until it has
// finished the service state marks the copy as unsynced, and a copy found in
// that state after a crash is discarded and copied again (postgres-runtime.js).
export async function syncClusterCopy(data,{directories,files},signal){
 await runQueue(files,async relative=>{
  signal?.throwIfAborted();let handle;
  // PostgreSQL may already have replaced a file it owns; it syncs its own.
  try{handle=await open(path.join(data,relative),'r+');}catch(error){if(error.code==='ENOENT')return;throw error;}
  try{await handle.sync();}finally{await handle.close();}
 });
 // POSIX directory entries need their own flush; Windows cannot open them so.
 if(!windows)for(const relative of [...directories].reverse().concat('','..')){const handle=await open(path.join(data,relative),'r');try{await handle.sync();}finally{await handle.close();}}
}
function validManifest(value,{major,version}){
 return value?.format===1&&value.major===major&&value.version===version&&/^[a-f0-9]{64}$/.test(value.adminPassword??'')&&/^[a-f0-9]{64}$/.test(value.digest??'');
}
async function readManifest(files,root,expected){
 const file=path.join(root,MANIFEST);if(!await files.stat(file,{missing:true}))return null;
 let value;try{value=JSON.parse(await files.read(file,{encoding:'utf8'}));}catch{return null;}
 return validManifest(value,expected)?value:null;
}
async function buildTemplate({guard,files,root,bin,major,version,signal}){
 for(const name of ['data','staging'])if(await files.stat(path.join(root,name),{directory:true,missing:true}))await files.removeTree(path.join(root,name));
 for(const name of [MANIFEST,'bootstrap-password'])await files.unlink(path.join(root,name));
 const adminPassword=randomBytes(32).toString('hex'),passwordFile=path.join(root,'bootstrap-password'),staging=path.join(root,'staging');
 await files.write(passwordFile,adminPassword);
 // No initdb sync: the digest written last detects any file a crash lost.
 try{await guard.run(path.join(bin,'initdb'+suffix),[...clusterInitArguments(staging,passwordFile),'--no-sync'],{signal});}
 finally{await files.unlink(passwordFile);}
 await files.rename(staging,path.join(root,'data'));
 const data=path.join(root,'data');
 if((await files.read(path.join(data,'PG_VERSION'),{limit:128,encoding:'utf8'})).trim()!==String(major))throw new AppError('DATABASE_RUNTIME');
 const {directories,files:members}=await inventory(data);
 await runQueue(members,async member=>{member.sha256=await hashFile(path.join(data,member.relative));});
 const manifest={format:1,major,version,adminPassword,digest:treeDigest(directories,members)};
 await files.write(path.join(root,MANIFEST),JSON.stringify(manifest));
 return manifest;
}
// Copies the template into `stage` (which must not exist). Returns the
// template administrator password the copy starts with, which the caller
// replaces before the copy is used for anything else, and the copied members
// for syncClusterCopy.
export async function copyClusterTemplate({runtimeDirectory,major,bin,stage,lease,run,prepared=null,signal}){
 const root=clusterTemplateDirectory(runtimeDirectory,major);
 if(within(root,stage)||within(stage,root))throw new AppError('DATABASE_LOCATION');
 await mkdir(path.dirname(root),{recursive:true,mode:0o700});
 const held=await templateLease(lease,root,signal);
 try{
  for(let attempt=0;;attempt++){
   let guard;
   try{
    guard=await acquirePostgresRuntimeGuard({directory:root,create:true,run,signal,...(attempt===0&&prepared?{prepared}:{})});
    const files=postgresRuntimeFiles(guard);
    const versionText=(await guard.run(path.join(bin,'postgres'+suffix),['--version'],{signal,capture:true})).trim();
    if(!new RegExp('PostgreSQL\\) '+major+'(?:[.]|$)').test(versionText))throw new AppError('DATABASE_RUNTIME');
    const expected={major,version:versionText};
    const manifest=await readManifest(files,root,expected)??await buildTemplate({guard,files,root,bin,major,version:versionText,signal});
    const copied=await copyTree(path.join(root,'data'),stage,signal);
    if(copied.digest!==manifest.digest)throw damaged('digest');
    return {adminPassword:manifest.adminPassword,members:{directories:copied.directories,files:copied.files}};
   }catch(error){
    // An unadmissible (foreign, replaced or unauthenticated) template is
    // damage too. The partial copy and the template are discarded once.
    const rebuild=attempt===0&&!signal?.aborted&&(error.templateDamaged||['DATABASE_GUARD_STORAGE','STORAGE_COPY','ENCRYPTION_DAMAGED','ENOENT'].includes(error.code));
    await rm(stage,{recursive:true,force:true,maxRetries:3});
    if(!rebuild)throw error;
   }finally{await guard?.close();}
   await rm(root,{recursive:true,force:true,maxRetries:3});
  }
 }finally{await held.close();}
}
