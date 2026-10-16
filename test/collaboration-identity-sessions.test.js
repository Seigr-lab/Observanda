import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {identityLease} from '../src/collaboration/identity-lease.js';
import {identitySession} from '../src/collaboration/identity-sessions.js';

test('identity recovery excludes other local app instances, releases after abrupt exit and cannot be stranded by a stale disk lock',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-identity-sessions-')),device={file:path.join(directory,'device'),available:()=>true},one=await identitySession(device);t.after(async()=>{await one.close();await rm(directory,{recursive:true,force:true,maxRetries:5});});
 const two=await identitySession(device);let ran=false;
 await assert.rejects(one.exclusive(()=>{ran=true;}),{code:'COLLABORATION_IDENTITY_BUSY'});assert.equal(ran,false);await two.close();await one.exclusive(()=>{ran=true;});assert.equal(ran,true);
 const source='import {identitySession} from '+JSON.stringify(new URL('../src/collaboration/identity-sessions.js',import.meta.url).href)+'; import {identityLease} from '+JSON.stringify(new URL('../src/collaboration/identity-lease.js',import.meta.url).href)+'; await identitySession({file:process.argv[1],available:()=>true}); await identityLease(process.argv[1]+".crash",{lockFile:process.argv[1]+".crash.lock"}); process.stdout.write("ready\\n"); setInterval(()=>{},1000);';
 const child=spawn(process.execPath,['--input-type=module','-e',source,device.file],{windowsHide:true,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',d=>stderr+=d);const exit=new Promise(resolve=>child.once('exit',resolve));t.after(async()=>{child.kill();await exit;});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Child did not become ready: '+stderr)),15000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.stdout.once('data',()=>{clearTimeout(timer);resolve();});});
 await assert.rejects(one.exclusive(()=>{}),{code:'COLLABORATION_IDENTITY_BUSY'});await assert.rejects(identityLease(device.file+'.crash',{lockFile:device.file+'.crash.lock',wait:0}),{code:'LOCKED'});
 child.kill();await exit;
 const lease=await identityLease(device.file+'.crash',{lockFile:device.file+'.crash.lock',wait:3000});await lease.close();await one.exclusive(()=>{});
});
