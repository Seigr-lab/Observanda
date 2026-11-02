import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmod,link,lstat,mkdir,readFile,rename,stat,symlink,unlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {buildPublication} from '../src/publication.js';
import {sampleNotebook} from '../src/sample.js';
import {sshFixture} from './ssh-fixture.js';

const linuxPermissions={skip:process.platform!=='linux'&&'requires Linux directory permissions'};

test('SSH rejects a replaceable ancestor before claiming the site or uploading',linuxPermissions,async t=>{
 const f=await sshFixture(t),book=sampleNotebook(),candidate=buildPublication(book),journal={};
 const shared=path.join(f.directory,'shared'),parent=path.join(shared,'parent'),site=path.join(parent,'site');
 await mkdir(parent,{recursive:true});
 await chmod(shared,0o770);
 const sentinel=path.join(f.directory,'outside.txt');
 await writeFile(sentinel,'outside');
 const config={...f.config,directory:f.root+'/shared/parent/site'};

 // Model a co-tenant renaming a directory in the writable parent after SSH
 // validation and immediately before SFTP resolves its first destination.
 f.setHook(async(call,phase)=>{
  if(call.program!=='sftp'||phase!=='before')return;
  await rename(parent,path.join(shared,'displaced'));
  const first=candidate.files.keys().next().value;
  const target=path.join(site,'.stage-'+journal.nonce,first);
  await mkdir(path.dirname(target),{recursive:true});
  await symlink(sentinel,target);
 });
 await assert.rejects(f.host.deploy(config,candidate,book.id,{journal}));
 assert.equal(await readFile(sentinel,'utf8'),'outside');
 assert.equal(f.calls.some(call=>call.program==='sftp'),false);
 await assert.rejects(lstat(site),{code:'ENOENT'});
});

test('SSH validates an interrupted stage before resuming an upload',linuxPermissions,async t=>{
 for(const hazard of ['writable nested directory','hard-linked file'])await t.test(hazard,async t=>{
  const f=await sshFixture(t),book=sampleNotebook(),candidate=buildPublication(book),journal={};
  f.setHook((call,phase)=>{if(call.program==='sftp'&&phase==='before')throw Error('simulated disconnect');});
  await assert.rejects(f.host.deploy(f.config,candidate,book.id,{journal}),/simulated disconnect/);
  f.setHook(null);
  const stage=path.join(f.directory,'site','.stage-'+journal.nonce),sentinel=path.join(f.directory,'outside.txt');
  await writeFile(sentinel,'outside',{mode:0o600});
  let repair;
  if(hazard==='writable nested directory'){
   const nested=[...candidate.files.keys()].find(name=>name.includes('/'));
   assert.ok(nested,'fixture needs a nested publication file');
   const directory=path.dirname(path.join(stage,nested));
   await mkdir(directory,{recursive:true});
   await chmod(directory,0o777);
   repair=()=>chmod(directory,0o755);
  }else{
   const target=path.join(stage,candidate.files.keys().next().value);
   await mkdir(path.dirname(target),{recursive:true});
   await link(sentinel,target);
   repair=()=>unlink(target);
  }
  const uploads=f.calls.filter(call=>call.program==='sftp').length;
  await assert.rejects(f.host.deploy(f.config,candidate,book.id,{journal}));
  assert.equal(f.calls.filter(call=>call.program==='sftp').length,uploads);
  assert.equal(await readFile(sentinel,'utf8'),'outside');
  await assert.rejects(f.current(),{code:'ENOENT'});
  await repair();
  const receipt=await f.host.deploy(f.config,candidate,book.id,{journal});
  assert.equal(receipt.releaseId,candidate.id);
  assert.equal(await readFile(sentinel,'utf8'),'outside');
 });
});

test('SSH rejects a hard link in a sealed release before normalizing permissions',linuxPermissions,async t=>{
 const f=await sshFixture(t),book=sampleNotebook(),candidate=buildPublication(book);
 await f.host.deploy(f.config,candidate,book.id);
 const published=path.join(f.directory,'site','releases',candidate.id,'index.html');
 const sentinel=path.join(f.directory,'outside.html');
 await writeFile(sentinel,await readFile(published),{mode:0o600});
 await unlink(published);
 await link(sentinel,published);
 const uploads=f.calls.filter(call=>call.program==='sftp').length;
 await assert.rejects(f.host.deploy(f.config,candidate,book.id));
 assert.equal(f.calls.filter(call=>call.program==='sftp').length,uploads);
 assert.equal((await stat(sentinel)).mode&0o777,0o600);
});
