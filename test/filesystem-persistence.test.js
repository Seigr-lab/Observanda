import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rename,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {atomicReplace} from '../src/atomic-replace.js';
import {atomicWrite,privateDirectory} from '../src/storage.js';
import {filesystemPersistence,syncDirectory,persistRename,persistDirectoryCreation,createPersistentDirectory,unlinkPersistent,removePersistentDirectory} from '../src/filesystem-persistence.js';
import {safeError} from '../src/errors.js';

test('directory barriers close handles and preserve the first persistence failure',async()=>{
 const calls=[],failure=Object.assign(new Error('private storage detail'),{code:'ENOSPC'});
 await assert.rejects(syncDirectory('directory',{platform:'linux',openDirectory:async()=>({sync:async()=>{calls.push('sync');throw failure;},close:async()=>{calls.push('close');throw Error('close failed');}})}),error=>error===failure);
 assert.deepEqual(calls,['sync','close']);
 const policy=filesystemPersistence('win32');assert.equal(policy.directoryFlush,'unavailable');assert.equal(policy.powerLossQualified,false);
 assert.equal(await syncDirectory('directory',{platform:'win32',openDirectory:()=>{throw Error('Windows directory flush was invented');}}),false);
});

test('rename persists the destination then source parent once; creation persists the child before its parent',async()=>{
 const directory=path.resolve('disposable-persistence'),source=path.join(directory,'from','file'),target=path.join(directory,'to','file'),seen=[];
 const options={platform:'linux',sync:async value=>{seen.push(value);}};
 await persistRename(source,target,options);assert.deepEqual(seen,[path.dirname(target),path.dirname(source)]);
 seen.length=0;await persistRename(source,path.join(path.dirname(source),'other'),options);assert.deepEqual(seen,[path.dirname(source)]);
 seen.length=0;await persistDirectoryCreation(path.dirname(target),options);assert.deepEqual(seen,[path.dirname(target),directory]);
});

test('a failed directory barrier reports an uncertain commit without repeating replacement or removing its new bytes',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-directory-fault-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const source=path.join(directory,'pending'),target=path.join(directory,'current');await writeFile(source,'new');await writeFile(target,'old');let replaced=0,synced=0;
 const cause=Object.assign(new Error('private directory failure'),{code:'EACCES'});
 await assert.rejects(atomicReplace(source,target,{platform:'win32',replace:async(a,b)=>{replaced++;await rename(a,b);},persist:async(a,b)=>persistRename(a,b,{platform:'linux',sync:async()=>{synced++;throw cause;}})}),error=>{
  assert.equal(error.cause,cause);assert.equal(error.commitUncertain,true);const safe=safeError(error);assert.equal(safe.code,'DURABILITY_UNCERTAIN');assert.equal(safe.commitUncertain,true);assert.equal(JSON.stringify(safe).includes(cause.message),false);return true;
 });
 assert.equal(replaced,1);assert.equal(synced,1);assert.equal(await readFile(target,'utf8'),'new');await assert.rejects(readFile(source),{code:'ENOENT'});
});

test('real native directories, replacements and cross-parent renames reopen with the complete new bytes',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-persistence-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const folder=await privateDirectory(root,'retained/values'),target=path.join(folder,'current');
 await atomicWrite(target,'old complete content');await atomicWrite(target,'new complete content');assert.equal(await readFile(target,'utf8'),'new complete content');
 const other=path.join(root,'other');await mkdir(other);const pending=path.join(other,'pending');await writeFile(pending,'cross parent content');await atomicReplace(pending,target);assert.equal(await readFile(target,'utf8'),'cross parent content');
 assert.equal(await syncDirectory(folder),process.platform!=='win32');
});

test('new owner ancestors and receipt removal persist without replacing existing directories',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-owner-directory-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const parent=path.join(root,'owner'),child=path.join(parent,'books','book');assert.equal(path.toNamespacedPath(await createPersistentDirectory(child,{recursive:true,mode:0o700})),path.toNamespacedPath(parent));
 const receipt=path.join(child,'receipt');await atomicWrite(receipt,'retained recovery authority');assert.equal(await createPersistentDirectory(child,{recursive:true,mode:0o700}),undefined);assert.equal(await readFile(receipt,'utf8'),'retained recovery authority');
 await assert.rejects(createPersistentDirectory(child),{code:'EEXIST'});await unlinkPersistent(receipt);await removePersistentDirectory(child);await assert.rejects(readFile(receipt),{code:'ENOENT'});
});
