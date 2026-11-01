import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {withNativeDestination,nativeDestination} from '../src/native-destination.js';
import {withMutationFilesSession,closeIdleMutationFiles} from '../src/mutation-files.js';
import {ProjectRuntimePool} from '../src/project-runtime-pool.js';
import {atomicWrite,assertRegular,privateDirectory} from '../src/storage.js';

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
const timeout=process.platform==='win32'?60000:180000;
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-destination-lifetime-'));
 t.after(async()=>{await closeIdleMutationFiles();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-destination-lifetime-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return root;
}

test('project idle shutdown does not retain a completed destination scope',{timeout},async t=>{
 const root=await fixture(t),destination=path.join(root,'destination'),file=path.join(destination,'.observanda','service-state'),entered=deferred(),released=deferred(),completed=deferred();
 let callbackEntered=false;t.signal.addEventListener('abort',()=>released.resolve(),{once:true});
 const pool=new ProjectRuntimePool({idleMs:1,close:async()=>{
  callbackEntered=true;entered.resolve();await released.promise;
  try{
   const stale=nativeDestination(file);await atomicWrite(file,'stopped');await assertRegular(file);await privateDirectory(destination,'.observanda/idle');
   completed.resolve({stale});
  }catch(error){completed.resolve({error});throw error;}
 }});
 t.after(()=>pool.closeAll());
 try{
  await withNativeDestination(destination,async scope=>{
   await scope.admit({prepare:true});await atomicWrite(file,'running');
   const lease=await pool.acquire(destination,async()=>({}));lease.release();await entered.promise;
  });
  await closeIdleMutationFiles();released.resolve();
  const outcome=await completed.promise;assert.ifError(outcome.error);assert.equal(outcome.stale,undefined);assert.equal(await readFile(file,'utf8'),'stopped');
 }finally{released.resolve();if(callbackEntered)await completed.promise;}
});

test('an escaped timer opens a new native helper after its inherited session ends',{timeout},async t=>{
 const root=await fixture(t),entered=deferred(),released=deferred(),completed=deferred();
 let callbackEntered=false;t.signal.addEventListener('abort',()=>released.resolve(),{once:true});
 try{
  await withMutationFilesSession(async original=>{
   setTimeout(async()=>{
    callbackEntered=true;entered.resolve();await released.promise;
    try{const same=await withMutationFilesSession(async current=>{const directory=await current.open(root);await directory.close();return current===original;});completed.resolve({same});}
    catch(error){completed.resolve({error});}
   },1);
   await entered.promise;
  });
  await closeIdleMutationFiles();released.resolve();
  const outcome=await completed.promise;assert.ifError(outcome.error);assert.equal(outcome.same,false);
 }finally{released.resolve();if(callbackEntered)await completed.promise;}
});
