import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,symlink,link as link2,lstat,rename} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {Workspace} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {withWriterLease,releaseWriterLease} from '../src/writer-lease.js';

async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'observanda-writer-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
// A folder whose workspace is still being created has no database yet; its
// writers are excluded by the kernel-held file lease.
test('kernel writer ownership excludes live processes and releases after abrupt application termination',async t=>{
 const root=await fixture(t),ws=new Workspace(root);
 const source=`import {Workspace} from ${JSON.stringify(new URL('../src/storage.js',import.meta.url).href)}; await new Workspace(process.argv[1]).withLock(async()=>{process.stdout.write('held\\n');await new Promise(()=>{});});`;
 const child=spawn(process.execPath,['--input-type=module','-e',source,root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 const ended=new Promise(resolve=>child.once('exit',resolve));let errors='';child.stderr.on('data',data=>errors+=data);t.after(()=>child.kill());
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Writer did not acquire lease: '+errors)),15000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('error',reject);});
 await assert.rejects(ws.withLock(async()=>{}),{code:'LOCKED'});
 child.kill('SIGKILL');await ended;
 const deadline=Date.now()+5000;let entered=false;for(;;)try{await ws.withLock(async()=>{entered=true;});break;}catch(error){if(error.code!=='LOCKED'||Date.now()>deadline)throw error;await delay(50);}
 assert.equal(entered,true);
 assert.equal((await lstat(path.join(root,'.observanda','write.lock'))).isFile(),true);
});
test('queued local writers serialize, retain revision checks and release after failure',async t=>{
 const {workspace:ws,vault}=await encryptedFixture(await fixture(t),sampleNotebook()),root=ws.root,initial=await ws.read();t.after(()=>clearVault(vault));
 const results=await Promise.allSettled([ws.save({...initial.book,title:'first'},initial.etag),new Workspace(root,vault).save({...initial.book,title:'second'},initial.etag)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.find(result=>result.status==='rejected').reason.code,'CONFLICT');
 await assert.rejects(withWriterLease(path.join(root,'temporary.lock'),async()=>{throw Error('failed');}),/failed/);
 assert.equal(await withWriterLease(path.join(root,'temporary.lock'),async()=>37),37);
});
test('a lease path must be a single regular file, never a folder or a link',async t=>{
 const root=await fixture(t),folder=path.join(root,'folder.lock');await mkdir(folder);
 await assert.rejects(withWriterLease(folder,()=>{}),{code:'UNSAFE'});assert.equal((await lstat(folder)).isDirectory(),true);
 const outside=path.join(root,'outside'),link=path.join(root,'linked.lock');await mkdir(outside);await symlink(outside,link,process.platform==='win32'?'junction':'dir');
 await assert.rejects(withWriterLease(link,()=>{}),{code:'UNSAFE'});
 const file=path.join(root,'file.lock'),second=path.join(root,'second.lock');await writeFile(file,'');await link2(file,second);
 await assert.rejects(withWriterLease(file,()=>{}),{code:'UNSAFE'});
});
test('a verified owner can rename its folder without leaving a lock at the old path',async t=>{
 const parent=await fixture(t),root=path.join(parent,'source'),target=path.join(parent,'destination');await mkdir(root);
 await withWriterLease(path.join(root,'write.lock'),async()=>{await releaseWriterLease(path.join(root,'write.lock'));await rename(root,target);});
 await withWriterLease(path.join(target,'write.lock'),async()=>{});
});
