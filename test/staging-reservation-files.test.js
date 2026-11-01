import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,realpath,writeFile,rename} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {withNativeDestination} from '../src/native-destination.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {StagingReservationFiles,STAGING_NAMESPACE_LEASE} from '../src/staging-reservation-files.js';

async function fixture(t){const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-staging-controls-'));await mkdir(path.join(root,'.observanda'));const workspace={root,vault:{id:randomUUID(),key:randomBytes(32)}};
 t.after(async()=>{await closeIdleMutationFiles();workspace.vault.key?.fill(0);assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('observanda-staging-controls-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return workspace;}
test('staging controls authenticate their namespace and serialize independent leases',async t=>{
 const workspace=await fixture(t);await withNativeDestination(workspace.root,async scope=>{await scope.admit();const files=new StagingReservationFiles(workspace,scope),opened=await files.openNamespace({create:true});
  try{await files.write(opened.directory,'state','ledger',{version:1,claims:[]});assert.deepEqual((await files.read(opened.directory,'state','ledger')).value,{version:1,claims:[]});await assert.rejects(files.read(opened.directory,'state','other-purpose'),{code:'COLLABORATION_DAMAGED'});
   const held=await files.lease(opened.directory,'admission');try{await assert.rejects(files.lease(opened.directory,'admission',{wait:false}),{code:'LOCKED'});}finally{await held.close();}
  }finally{await opened.directory.close();}
 });
 await withNativeDestination(workspace.root,async scope=>{await scope.admit();const files=new StagingReservationFiles(workspace,scope),opened=await files.openNamespace();try{assert.equal((await files.read(opened.directory,'state','ledger')).value.version,1);}finally{await opened.directory.close();}});
});
test('namespace creation resumes only an authenticated empty intent and preserves unknown objects',async t=>{
 const workspace=await fixture(t);await mkdir(path.join(workspace.root,'.observanda','staging-reservations'));
 await withNativeDestination(workspace.root,async scope=>{await scope.admit();const files=new StagingReservationFiles(workspace,scope);await assert.rejects(files.openNamespace({create:true}),{code:'COLLABORATION_DAMAGED'});
  await files.write(scope.internalDirectory,'.staging-reservations.intent','namespace-intent',{version:1,id:randomUUID(),rootIdentity:scope.identity,internalIdentity:scope.internalIdentity});
  await writeFile(path.join(workspace.root,'.observanda','staging-reservations','unknown'),'preserved');await assert.rejects(files.openNamespace({create:true}),{code:'COLLABORATION_DAMAGED'});
  const directory=await scope.internalDirectory.directory('staging-reservations');try{assert.equal((await directory.read('unknown',{limit:32})).bytes.toString(),'preserved');await directory.remove('unknown',{identity:(await directory.stat('unknown')).identity});}finally{await directory.close();}
  const opened=await files.openNamespace({create:true});await opened.directory.close();assert.equal(await scope.internalDirectory.read('.staging-reservations.intent',{missing:true,limit:4096}),null);
 });
});
test('retired or mutated keys cannot continue reservation control access',async t=>{
 const workspace=await fixture(t);await withNativeDestination(workspace.root,async scope=>{await scope.admit();const files=new StagingReservationFiles(workspace,scope),opened=await files.openNamespace({create:true});try{workspace.vault.key[0]^=1;await assert.rejects(files.write(opened.directory,'state','ledger',{version:1}),{code:'ACCESS_LOCKED'});}finally{await opened.directory.close();}});
});

test('nonempty initialization leases are preserved and never adopted as internal controls',async t=>{
 const workspace=await fixture(t);await writeFile(path.join(workspace.root,'.observanda',STAGING_NAMESPACE_LEASE),'unrelated');
 await withNativeDestination(workspace.root,async scope=>{await scope.admit();const files=new StagingReservationFiles(workspace,scope);await assert.rejects(files.openNamespace({create:true}),{code:'COLLABORATION_DAMAGED'});assert.equal((await scope.internalDirectory.read(STAGING_NAMESPACE_LEASE,{limit:32})).bytes.toString(),'unrelated');assert.equal(await scope.internalDirectory.directory('staging-reservations',{missing:true}),null);});
});

test('a replaced initialization lease cannot authenticate an existing namespace',async t=>{
 const workspace=await fixture(t);await withNativeDestination(workspace.root,async scope=>{await scope.admit();const files=new StagingReservationFiles(workspace,scope),opened=await files.openNamespace({create:true});await opened.directory.close();});
 await rename(path.join(workspace.root,'.observanda',STAGING_NAMESPACE_LEASE),path.join(workspace.root,'original-lease'));await writeFile(path.join(workspace.root,'.observanda',STAGING_NAMESPACE_LEASE),'');
 await assert.rejects(withNativeDestination(workspace.root,async scope=>{await scope.admit();return new StagingReservationFiles(workspace,scope).openNamespace({create:true});}),{code:'COLLABORATION_DAMAGED'});
});
