import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rename,symlink,link,rm,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {withNativeDestination} from '../src/native-destination.js';
import {workspaceDatabaseLease} from '../src/workspace-database-lease.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {windowsMutationFiles} from '../src/windows-mutation-files.js';
import {posixMutationFiles} from '../src/posix-mutation-files.js';

const nativeService=()=>process.platform==='win32'?windowsMutationFiles():posixMutationFiles();
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-native-lease-')),destination=path.join(root,'destination'),outside=path.join(root,'outside');await mkdir(outside);await writeFile(path.join(outside,'keep'),'unchanged');
 t.after(async()=>{await closeIdleMutationFiles();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-native-lease-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return {root,destination,outside};
}
async function legacyProcess(t,file){
 const source=`import {workspaceDatabaseLease} from ${JSON.stringify(new URL('../src/workspace-database-lease.js',import.meta.url).href)};
 try{const lease=await workspaceDatabaseLease(null,{file:process.argv[1],busyCode:'LOCKED'});process.send({status:'held'});process.once('message',async()=>{await lease.close();process.disconnect();});}catch(error){process.send({status:error.code});process.disconnect();}`;
 const child=spawn(process.execPath,['--input-type=module','-e',source,file],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});let stderr='';child.stderr.on('data',bytes=>{stderr+=bytes;});
 const exited=new Promise(resolve=>child.once('exit',resolve));
 const message=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('Lease child exited before its receipt: '+code+' '+stderr)));});
 let closing;const close=()=>closing??=(async()=>{if(child.connected)child.send('close');await exited;})();t.after(close);return {status:message.status,close};
}

test('destination native leases coordinate with legacy processes in both directions',async t=>{
 const f=await fixture(t),file=path.join(f.destination,'.observanda','write.lock');
 await withNativeDestination(f.destination,async scope=>{
  await scope.admit({prepare:true});
  const lease=await workspaceDatabaseLease(null,{file,busyCode:'LOCKED'});
  try{
   const competitor=await legacyProcess(t,file);assert.equal(competitor.status,'LOCKED');await competitor.close();
   await assert.rejects(workspaceDatabaseLease(null,{file,busyCode:'LOCKED'}),{code:'LOCKED'});
  }finally{await lease.close();}
  const legacy=await legacyProcess(t,file);assert.equal(legacy.status,'held');
  try{await assert.rejects(workspaceDatabaseLease(null,{file,busyCode:'LOCKED'}),{code:'LOCKED'});}finally{await legacy.close();}
  const next=await workspaceDatabaseLease(null,{file,busyCode:'LOCKED'});await next.close();await next.close();
 });
 assert.equal((await lstat(file)).isFile(),true);assert.equal((await lstat(file)).size,0);
});

test('destination leases outlive the destination helper and preserve the lock inode',async t=>{
 const f=await fixture(t),file=path.join(f.destination,'.observanda','owner.lock');let lease;
 try{
  await withNativeDestination(f.destination,async scope=>{await scope.admit({prepare:true});lease=await workspaceDatabaseLease(null,{file});});
  const before=await lstat(file,{bigint:true});await closeIdleMutationFiles();
  const competitor=await legacyProcess(t,file);assert.equal(competitor.status,'LOCKED');await competitor.close();
  await lease.close();lease=null;
  const legacy=await legacyProcess(t,file);assert.equal(legacy.status,'held');await legacy.close();
  const after=await lstat(file,{bigint:true});assert.equal(after.ino,before.ino);assert.equal(after.dev,before.dev);
 }finally{await lease?.close();}
});

for(const substitution of ['directory','junction'])test(`destination lease admission rejects a replaced named parent (${substitution}) before creating a lock`,async t=>{
 const f=await fixture(t),moved=path.join(f.root,'retained'),file=path.join(f.destination,'.observanda','write.lock');
 await withNativeDestination(f.destination,async scope=>{
  await scope.admit({prepare:true});await rename(path.join(f.destination,'.observanda'),moved);
  if(substitution==='junction')await symlink(f.outside,path.join(f.destination,'.observanda'),'junction');else await mkdir(path.join(f.destination,'.observanda'));
  await assert.rejects(workspaceDatabaseLease(null,{file}),error=>['UNSAFE','STORAGE_COPY'].includes(error.code));
 });
 assert.deepEqual(await readdir(f.outside),['keep']);assert.deepEqual(await readdir(moved),[]);if(substitution==='directory')assert.deepEqual(await readdir(path.join(f.destination,'.observanda')),[]);
});

test('native lease creation remains anchored after an admitted parent is renamed',async t=>{
 const f=await fixture(t),moved=path.join(f.root,'retained');await mkdir(f.destination);const service=await nativeService();
 try{
  const parent=await service.open(f.destination);await rename(f.destination,moved);await symlink(f.outside,f.destination,'junction');
  const lease=await parent.lease('owner.lock');await parent.close();
  try{const legacy=await legacyProcess(t,path.join(moved,'owner.lock'));assert.equal(legacy.status,'LOCKED');await legacy.close();}finally{await lease.close();}
 }finally{await service.close();}
 assert.deepEqual(await readdir(f.outside),['keep']);assert.equal((await lstat(path.join(moved,'owner.lock'))).size,0);
});

test('native leases reject linked lock files and preserve their targets',async t=>{
 const f=await fixture(t),target=path.join(f.outside,'keep');await mkdir(f.destination);await symlink(f.outside,path.join(f.destination,'junction'),'junction');await link(target,path.join(f.destination,'hard.lock'));const service=await nativeService();
 try{const parent=await service.open(f.destination);await assert.rejects(parent.lease('junction'));await assert.rejects(parent.lease('hard.lock'),{code:'UNSAFE'});await parent.close();}finally{await service.close();}
 assert.equal(await readFile(target,'utf8'),'unchanged');
});
