import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {acquirePostgresRuntimeGuard} from './postgres-runtime-guard.js';
import {withMutationFilesSession} from './mutation-files.js';
import {nativeMember} from './native-storage-tree.js';
import {nativeDestination} from './native-destination.js';
import {removeNativeRuntimeTree} from './postgres-runtime-files.js';
import {runtimeStateProtector,stoppedRuntimeConfiguration,runtimeUpgradeError} from './postgres-runtime-upgrade-config.js';
import {proofDirectory,writeUpgradeFile,copyRuntimeWithProof,verifyRuntimeProof,retireRuntimeFromProof} from './postgres-runtime-upgrade-proof.js';
import {diagnosticPhase} from './operational-diagnostics.js';
import {diskCapacity} from './disk-capacity.js';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const changed=()=>{throw runtimeUpgradeError('migration-identity-changed');};
const migrationRequired=error=>error.code==='DATABASE_GUARD_STORAGE'&&error.reason==='nonprivate-runtime-requires-migration';
function journalValid(value,parent,name){
 if(value?.version!==1||!uuid(value.id)||value.parent!==parent.identity||value.name!==name||!['copying','fencing','prepared','published','ready'].includes(value.phase)||typeof value.source!=='string'||typeof value.key!=='string'||!/^[a-f0-9]{64}$/.test(value.key)||value.fresh!=='.runtime-upgrade-'+value.id||value.retired!=='.runtime-retired-'+value.id||value.target!==null&&typeof value.target!=='string'||!Number.isSafeInteger(value.pages)||value.pages<0)changed();
 if(value.phase!=='copying'&&(typeof value.fence?.identity!=='string'||typeof value.fence.original!=='string'||value.fence.original.length>12000||Buffer.from(value.fence.original,'base64').toString('base64')!==value.fence.original))changed();
 return value;
}
async function scopedParent(service,directory){
 const parent=await service.open(path.dirname(directory));try{const scope=nativeDestination(directory);if(scope)await scope.member(directory,async selected=>{if(selected.identity!==parent.identity)changed();});return parent;}catch(error){await parent.close();throw error;}
}
// Admission and upgrade share a short native parent lease. A journal is checked
// before creating the canonical name, including the gap between both renames.
export async function withUpgradeablePostgresRuntime(options,operation){
 if(process.platform!=='win32'){const guard=await acquirePostgresRuntimeGuard(options);try{return await operation(guard);}catch(error){await guard.close();throw error;}}
 return upgradeSession(options,operation,false);
}
// Also used by isolated upgrade qualification; all authentication and source
// permission checks are identical to automatic admission-triggered upgrades.
export const upgradePostgresRuntime=(options,operation)=>upgradeSession(options,operation,true);
async function upgradeSession(options,operation,requested){
 const {directory,workspace,signal,env=process.env}=options,name=path.basename(directory),journalName='.'+name+'.runtime-upgrade',protector=runtimeStateProtector(workspace,'upgrade');
 let lastProgress=0,lastPhase,lastPercent;
 const onProgress=value=>{const now=Date.now();if(value.phase!==lastPhase||now-lastProgress>=250||value.percent===100&&lastPercent!==100){lastProgress=now;lastPhase=value.phase;lastPercent=value.percent;options.onProgress?.(value);}};
 return withMutationFilesSession(async service=>{
  const parent=await scopedParent(service,directory);let lock,guard,source,sourceLease,sourcePin,target,targetPin,result,journal,verifiedUnderLease=false,sourceFenceRemoved=false;
  const save=async()=>{const bytes=Buffer.from(JSON.stringify(journal));let reservation;try{const stored=await protector.protect(bytes);reservation=await diskCapacity.reserve(path.dirname(directory),stored.length,{reserveBytes:256*1024*1024,signal});await reservation.write(stored.length,()=>writeUpgradeFile(parent,journalName,stored));}finally{reservation?.release();bytes.fill(0);}};
  const named=async(name,identity,{missing=false}={})=>{const value=await parent.directory(name,{missing});if(value&&value.identity!==identity){await value.close();changed();}return value;};
  const releaseSource=async()=>{await sourcePin?.close();sourcePin=null;await sourceLease?.close();sourceLease=null;await source?.close();source=null;};
  const fence=(sourceName,action)=>guard.sourceFence(path.join(path.dirname(directory),sourceName),{action,parentIdentity:parent.identity,expectedIdentity:journal.source,lockIdentity:journal.fence.identity,original:journal.fence.original});
  const copyPinName=()=>'.runtime-copy-pin-'+journal.id;
  const protectTarget=async copyName=>{
   target??=await named(copyName,journal.target);if(targetPin)return;
   const file=path.join(guard.directory,copyPinName()),reservation=await diskCapacity.reserve(guard.directory,journal.id.length,{reserveBytes:256*1024*1024,signal});try{await reservation.write(journal.id.length,()=>guard.files.write(file,journal.id));}finally{reservation.release();}const value=await guard.files.stat(file);targetPin=await target.pin(copyPinName(),{identity:value.identity});
   await target.close();target=await named(copyName,journal.target);
  };
  const releaseTarget=async()=>{if(!targetPin)return;await targetPin.close();targetPin=null;await guard.files.unlink(path.join(guard.directory,copyPinName()));};
  const protectSource=async sourceName=>{if(sourceLease||sourcePin)return;sourcePin=await source.pin('owner.lock',{identity:journal.fence.identity});await source.close();source=await named(sourceName,journal.source);};
  try{
   lock=await parent.lease('.'+name+'.runtime-upgrade.lock');
   const saved=await parent.read(journalName,{missing:true});
   if(saved){const bytes=await protector.unprotect(saved.bytes);try{journal=journalValid(JSON.parse(bytes.toString('utf8')),parent,name);}finally{bytes.fill(0);}}
   if(!journal&&!requested){
    try{guard=await acquirePostgresRuntimeGuard({...options,parentIdentity:parent.identity});}
    catch(error){if(!migrationRequired(error)||options.stopOnly)throw error;}
    if(guard)return await operation(guard);
   }
   if(!journal){
    source=await parent.directory(name);sourceLease=await source.lease('owner.lock');
    await stoppedRuntimeConfiguration((await source.read('service.observanda')).bytes,workspace);
    const id=randomUUID();journal={version:1,id,parent:parent.identity,name,source:source.identity,fresh:'.runtime-upgrade-'+id,retired:'.runtime-retired-'+id,target:null,phase:'copying',key:randomBytes(32).toString('hex'),pages:0};await save();
   }
   if(journal.phase==='copying'){
    source??=await named(name,journal.source);sourceLease??=await source.lease('owner.lock');
    // The token is bound into the native DPAPI admission stamp. An interrupted
    // creation with no authenticated stamp is preserved for explicit recovery.
    const freshDirectory=path.join(path.dirname(directory),journal.fresh);
    guard=await acquirePostgresRuntimeGuard({...options,directory:freshDirectory,workspaceRoot:undefined,create:true,parentIdentity:parent.identity,expectedIdentity:journal.target??undefined,creationToken:journal.id});
    journal.target=guard.identity;await save();
    await guard.inspectSource(directory,{parentIdentity:parent.identity,expectedIdentity:journal.source});
    const config=await stoppedRuntimeConfiguration((await source.read('service.observanda')).bytes,workspace);
    if(await nativeMember(source,'data/postmaster.pid',(folder,member)=>folder.stat(member,{missing:true})))throw runtimeUpgradeError('source-database-running');
    await protectTarget(journal.fresh);
    // Only this receipt's private staging object may be reset. The original
    // remains intact, including after a failed or interrupted copy.
    for await(const entry of target.entries())if(entry.name!=='owner.lock'&&entry.name!==copyPinName()){
     if(entry.directory)await removeNativeRuntimeTree(target,entry.name);
     else{const value=await target.stat(entry.name);await target.remove(entry.name,{identity:value.identity});}
    }
    await diagnosticPhase('runtime-upgrade-copy',()=>copyRuntimeWithProof(source,target,journal,{signal,directory:freshDirectory,onProgress}));
    const configured=env.OBSERVANDA_POSTGRES_BIN?path.resolve(env.OBSERVANDA_POSTGRES_BIN):config.bin,relative=path.relative(directory,configured),inside=relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative),bin=inside?path.join(freshDirectory,relative):configured;
    const version=await guard.run(path.join(bin,'postgres.exe'),['--version'],{signal,capture:true});if(!new RegExp('PostgreSQL\\) '+config.major+'(?:\\.|$)').test(version))throw runtimeUpgradeError('source-runtime-version-mismatch');
    const control=await guard.run(path.join(bin,'pg_controldata.exe'),[path.join(freshDirectory,'data')],{signal,capture:true});if(!/^Database cluster state:\s+shut down\s*$/m.test(control))throw runtimeUpgradeError('source-database-not-shut-down');
    onProgress({stage:'upgrade',phase:'verify'});await guard.inspectSource(directory,{parentIdentity:parent.identity,expectedIdentity:journal.source});await diagnosticPhase('runtime-upgrade-verify',()=>verifyRuntimeProof(source,target,journal,{signal}));
    journal.fence=await guard.sourceFence(directory,{action:'describe',parentIdentity:parent.identity,expectedIdentity:journal.source,lockIdentity:sourceLease.identity});if(journal.fence.original.length>12000)throw runtimeUpgradeError('unsupported-source-permissions');
    journal.phase='fencing';await save();verifiedUnderLease=true;
   }
   if(journal.phase==='fencing'){
    source??=await named(name,journal.source);
    guard??=await acquirePostgresRuntimeGuard({...options,directory:path.join(path.dirname(directory),journal.fresh),workspaceRoot:undefined,create:false,parentIdentity:parent.identity,expectedIdentity:journal.target,creationToken:journal.id});
    if(!(await fence(name,'inspect')).readOnly)sourceLease??=await source.lease('owner.lock');else await protectSource(name);
    if(!verifiedUnderLease){
     await guard.inspectSource(directory,{parentIdentity:parent.identity,expectedIdentity:journal.source});await stoppedRuntimeConfiguration((await source.read('service.observanda')).bytes,workspace);
     if(await nativeMember(source,'data/postmaster.pid',(folder,member)=>folder.stat(member,{missing:true})))throw runtimeUpgradeError('source-database-running');
     await protectTarget(journal.fresh);await verifyRuntimeProof(source,target,journal,{signal});
    }
    await fence(name,'apply');journal.phase='prepared';await save();verifiedUnderLease=true;
    await releaseTarget();await target?.close();target=null;await sourcePin?.close();sourcePin=null;await sourceLease?.close();sourceLease=null;await guard.close();guard=null;
   }
   if(journal.phase==='prepared'){
    const canonical=await parent.stat(name,{folder:true,missing:true}),retired=await parent.stat(journal.retired,{folder:true,missing:true}),fresh=await parent.stat(journal.fresh,{folder:true,missing:true});
    if(canonical?.identity===journal.source&&!retired&&fresh?.identity===journal.target){}
    else if(!canonical&&retired?.identity===journal.source&&fresh?.identity===journal.target){}
    else if(canonical?.identity===journal.target&&retired?.identity===journal.source&&!fresh){}
    else changed();
    const originalName=retired?journal.retired:name,copyName=fresh?journal.fresh:name;
    source??=await named(originalName,journal.source);
    if(!verifiedUnderLease){
     guard=await acquirePostgresRuntimeGuard({...options,directory:path.join(path.dirname(directory),copyName),workspaceRoot:undefined,create:false,parentIdentity:parent.identity,expectedIdentity:journal.target,creationToken:journal.id});
     if(!(await fence(originalName,'inspect')).fenced)changed();
     await protectSource(originalName);
     await guard.inspectSource(path.join(path.dirname(directory),originalName),{parentIdentity:parent.identity,expectedIdentity:journal.source});
     await stoppedRuntimeConfiguration((await source.read('service.observanda')).bytes,workspace);
     if(await nativeMember(source,'data/postmaster.pid',(folder,member)=>folder.stat(member,{missing:true})))throw runtimeUpgradeError('source-database-running');
     await protectTarget(copyName);await verifyRuntimeProof(source,target,journal,{signal});await releaseTarget();await target.close();target=null;await sourcePin.close();sourcePin=null;await guard.close();guard=null;
    }
    if(!retired)await parent.rename(name,parent,journal.retired,{folder:true,identity:journal.source});
    if(fresh)await parent.rename(journal.fresh,parent,name,{folder:true,identity:journal.target});
    journal.phase='published';await save();
   }
   guard=await acquirePostgresRuntimeGuard({...options,create:false,parentIdentity:parent.identity,expectedIdentity:journal.target,creationToken:journal.id});
   await protectTarget(name);await source?.close();source=await named(journal.retired,journal.source,{missing:journal.phase==='ready'});
   if(source){
    // SMB redirectors can cache a directory's old lookup name after another
    // handle renames it. The mutation helper pins the existing owned file,
    // then reopens the exact source while its name and helper lifetime are fixed.
    try{await protectSource(journal.retired);}catch(error){if(journal.phase!=='ready'||error.code!=='ENOENT')throw error;for await(const entry of source.entries())changed();sourceFenceRemoved=true;}
   }
   if(source&&!sourceFenceRemoved){const state=await fence(journal.retired,'inspect');if(!state.fenced){if(journal.phase!=='ready'||!state.restricted)changed();for await(const entry of source.entries())if(entry.name!=='owner.lock'||entry.directory)changed();}}
   if(options.stopOnly)throw runtimeUpgradeError('migration-startup-verification-required');
   result=await operation(guard);if(journal.phase!=='ready'){journal.phase='ready';await save();}
   if(source){
    onProgress({stage:'upgrade',phase:'retire'});
    await retireRuntimeFromProof(source,target,journal,signal);await sourcePin?.close();sourcePin=null;if(!sourceFenceRemoved)await fence(journal.retired,'remove');await source.close();source=null;await parent.remove(journal.retired,{folder:true,identity:journal.source});
   }
   await removeNativeRuntimeTree(target,proofDirectory,{missing:true});await releaseTarget();const completed=await parent.read(journalName);await parent.remove(journalName,{identity:completed.identity});
   return result;
  }catch(error){if(result)await result.close().catch(()=>{});await guard?.close();throw error;}
  finally{await releaseSource();await targetPin?.close();await target?.close();await lock?.close();await parent.close();}
 });
}
