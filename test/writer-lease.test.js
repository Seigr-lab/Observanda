import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,unlink,writeFile,readFile,symlink,lstat,rename} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {Workspace} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {withWriterLease,releaseWriterLease} from '../src/writer-lease.js';
import {reviewWriterRecovery,recoverWriter} from '../src/writer-recovery.js';

async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'observanda-writer-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('kernel writer ownership excludes live processes and releases after abrupt application termination',async t=>{
 const root=await fixture(t),ws=new Workspace(root),initial=await ws.create(sampleNotebook());
 const source=`import {Workspace} from ${JSON.stringify(new URL('../src/storage.js',import.meta.url).href)}; await new Workspace(process.argv[1]).withLock(async()=>{process.stdout.write('held\\n');await new Promise(()=>{});});`;
 const child=spawn(process.execPath,['--input-type=module','-e',source,root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 const ended=new Promise(resolve=>child.once('exit',resolve));let errors='';child.stderr.on('data',data=>errors+=data);t.after(()=>child.kill());
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Writer did not acquire lease: '+errors)),15000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('error',reject);});
 await assert.rejects(ws.save(initial.book,initial.etag),{code:'LOCKED'});
 child.kill('SIGKILL');await ended;
 const next=structuredClone(initial.book);next.title='After interruption';
 const deadline=Date.now()+5000;for(;;)try{await ws.save(next,initial.etag);break;}catch(error){if(error.code!=='LOCKED'||Date.now()>deadline)throw error;await delay(50);}
 assert.equal((await new Workspace(root).read()).book.title,next.title);
 assert.equal((await lstat(path.join(root,'.observanda','write.lock'))).isFile(),true);
});
test('queued local writers serialize, retain revision checks and release after failure',async t=>{
 const root=await fixture(t),ws=new Workspace(root),initial=await ws.create(sampleNotebook());
 const results=await Promise.allSettled([ws.save({...initial.book,title:'first'},initial.etag),new Workspace(root).save({...initial.book,title:'second'},initial.etag)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.find(result=>result.status==='rejected').reason.code,'CONFLICT');
 await assert.rejects(withWriterLease(path.join(root,'temporary.lock'),async()=>{throw Error('failed');}),/failed/);
 assert.equal(await withWriterLease(path.join(root,'temporary.lock'),async()=>37),37);
});
test('legacy recovery requires reviewed empty ownership and preserves unexpected contents and links',async t=>{
 const root=await fixture(t),file=path.join(root,'old.lock');await mkdir(file);const review=await reviewWriterRecovery(file);
 await assert.rejects(withWriterLease(file,()=>{}),{code:'LEGACY_WRITE_LOCK'});
 await assert.rejects(recoverWriter(file,{stamp:review.stamp}),{code:'INVALID'});
 await assert.rejects(recoverWriter(file,{stamp:'stale',closedOtherInstallations:true}),{code:'CONFLICT'});
 await writeFile(path.join(file,'unrelated'),'keep');await assert.rejects(recoverWriter(file,{stamp:review.stamp,closedOtherInstallations:true}),{code:'UNSAFE'});assert.equal(await readFile(path.join(file,'unrelated'),'utf8'),'keep');
 await unlink(path.join(file,'unrelated'));const current=await reviewWriterRecovery(file);await recoverWriter(file,{stamp:current.stamp,closedOtherInstallations:true});assert.equal(await reviewWriterRecovery(file),null);
 const outside=path.join(root,'outside'),link=path.join(root,'linked.lock');await mkdir(outside);await symlink(outside,link,process.platform==='win32'?'junction':'dir');await assert.rejects(reviewWriterRecovery(link),{code:'UNSAFE'});
});
test('a verified owner can rename its folder without leaving a lock at the old path',async t=>{
 const parent=await fixture(t),root=path.join(parent,'source'),target=path.join(parent,'destination');await mkdir(root);
 await withWriterLease(path.join(root,'write.lock'),async()=>{await releaseWriterLease(path.join(root,'write.lock'));await rename(root,target);});
 await withWriterLease(path.join(target,'write.lock'),async()=>{});
});
