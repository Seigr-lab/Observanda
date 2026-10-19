import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {setImmediate as turn} from 'node:timers/promises';
import filesystem,{mkdtemp,rm,realpath,readdir} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {workspaceDestinationFixture} from './workspace-destination-fixture.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault,ENCRYPTION_OVERHEAD} from '../src/encryption.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {withPublicationCapture} from '../src/publication-capture.js';
import {Workspace} from '../src/storage.js';
import {PublicationOutputWriter,withPublicationOutputWriter,openPublicationOutput,publicationOutputChunks} from '../src/publication-output.js';
import {RetainedPublicationFiles,verifyPublicationCandidate} from '../src/retained-publication-files.js';
import {publicationFileRows} from '../src/publication-files.js';
import {contentBuffer} from '../src/file-content.js';
import {PublicationOutputFinalization} from '../src/publication-output-finalization.js';
import {digest} from '../src/storage-format.js';
import {publicationWorkspace} from '../src/publication-pin.js';
import {catalogueFormat,catalogueRequiresPublicationDocuments} from '../src/catalogue-format.js';

test('streamed output coalescing preserves Unicode fragment bytes with bounded write chunks',async()=>{
 const unicode=Buffer.from('\u00c5ngstr\u00f6m \u{1f41d} \u6f22\u5b57'),parts=['<!doctype html><main>','',Buffer.alloc(0),'\u00e9 '.repeat(22000),unicode.subarray(0,13),unicode.subarray(13),'\ud83d','\udc1d',Buffer.from('bounded prose '.repeat(18000)),'</main>'];
 const expected=Buffer.concat(parts.map(value=>Buffer.from(value))),chunks=[];
 async function* fragments(){for(const part of parts)yield part;}
 for await(const chunk of publicationOutputChunks(fragments()))chunks.push(chunk);
 assert.deepEqual(Buffer.concat(chunks),expected,'Coalescing must not re-encode split byte or surrogate fragments');
 assert.equal(chunks.length,Math.ceil(expected.length/(64*1024)));
 assert.ok(chunks.every(chunk=>Buffer.isBuffer(chunk)&&chunk.length>0&&chunk.length<=64*1024));
 assert.ok(chunks.slice(0,-1).every(chunk=>chunk.length===64*1024));
 const empty=[];for await(const chunk of publicationOutputChunks((async function*(){yield '';yield Buffer.alloc(0);})()))empty.push(chunk);assert.deepEqual(empty,[]);
});

test('streamed output coalescing forwards cancellation and closes the source between bounded writes',async()=>{
 const controller=new AbortController(),reason=new Error('Cancel HTML output');let closed=false,consumed=0;
 async function* fragments(){try{for(let i=0;i<20000;i++){consumed++;yield '<span>\u00c5 \u{1f41d}</span>';}}finally{closed=true;}}
 const chunks=publicationOutputChunks(fragments(),{signal:controller.signal}),first=await chunks.next();assert.equal(first.value.length,64*1024);const before=consumed;
 controller.abort(reason);await assert.rejects(chunks.next(),error=>error===reason);assert.equal(consumed,before);assert.equal(closed,true);
 async function* untouched(){assert.fail('An already cancelled stream was consumed');yield '';}
 await assert.rejects(publicationOutputChunks(untouched(),{signal:controller.signal}).next(),error=>error===reason);
});

test('output inventory binds nested retained blobs, selected choices and the exact streamed public manifest',{timeout:120000},async t=>{
 const mounted=!!process.env.OBSERVANDA_TEST_SECOND_VOLUME,parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-output-')),book=sampleNotebook();let fixture,placement,runtime,detach;
 t.after(async()=>{await runtime?.close();detach?.();if(fixture?.vault)clearVault(fixture.vault);await placement?.cleanup();assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('observanda-output-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 if(mounted){
  placement=await workspaceDestinationFixture(root);
  runtime=new WorkspaceDatabases({directory:path.join(root,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});detach=installDatabaseProvider(runtime);
 }
 fixture=await encryptedFixture(placement?.root??root,book,undefined,{deviceDirectory:root});
 const workspace=publicationWorkspace(fixture.workspace),outline=await workspace.currentOutline(),releases=new PublicationJobs(workspace);
 const source=await withPublicationCapture(workspace,async(captured,id,finish)=>{const retained=await releases.pin({etag:outline.etag,websitePin:outline.websitePin},{workspace:captured,id});return finish(()=>retained);}),job={id:source.id,lease:{token:randomUUID()}},directory=await releases.directory(job.id,job.lease.token);
 const entries=Array.from({length:600},(_,index)=>({id:randomUUID(),title:'Selected \u00c5 \u03bb \u{1f41d} '+index})),styles=Array.from({length:4},(_,index)=>({kind:'blocks',css:Array.from({length:3000},(_,row)=>'.rule-'+index+'-'+row+'{--caption:"\u00c5 \u03bb \u8702 '+row+'";}').join('\n')}));
 const homeParts=['<!doctype html><title>Home</title>','<main>Retained website<p>',...Array(5000).fill('\u00c5ngstr\u00f6m \u{1f41d} \u6f22\u5b57 '),'</p></main>'],homeBytes=Buffer.concat(homeParts.map(part=>Buffer.from(part)));
 const late=randomUUID(),extra=randomUUID(),open=fixture.workspace.openCatalogue,lock=fixture.workspace.withLock,writeMetadata=fixture.workspace.writeMetadata,batches=[],sqlBatches=[];let opened=0,closed=0,active;
 fixture.workspace.openCatalogue=async function(options){const db=await open.call(this,options),close=db.close,run=db.run;opened++;db.close=async function(){try{return await close.call(this);}finally{closed++;}};db.run=function(sql,...values){if(sql.startsWith('INSERT INTO objects '))sqlBatches.push({rows:values.length/2,bytes:values.filter((_,index)=>index%2===1).reduce((sum,value)=>sum+value.length,0)});return run.call(this,sql,...values);};return db;};
 fixture.workspace.withLock=function(operation,options){return lock.call(this,async(...args)=>{active=[];try{return await operation(...args);}finally{if(active.length)batches.push(active);active=null;}},options);};
 fixture.workspace.writeMetadata=function(file,text){if(active&&file.includes('/release-outputs/'))active.push(Buffer.byteLength(text));return writeMetadata.call(this,file,text);};
 // Observe only this attempt's manifest payload buffers. Partial filesystem
 // writes may repeat a buffer; they do not represent extra source chunks.
 const retaining=new AsyncLocalStorage(),manifestPayloads=new Set(),openFile=filesystem.open;
 const syncGates=[],syncCompleted=[],reverseDone=Promise.withResolvers();let syncing=0,maxSyncing=0,privacyReads=0,maxPrivacyReads=0,privacyCount=0,reverse;
 reverseDone.promise.catch(()=>{});
 const fileMock=t.mock.method(filesystem,'open',async function(file,...args){
  const handle=await openFile.call(this,file,...args);
  const name=retaining.getStore();
  if(name&&name!=='publication.json'&&args[0]==='wx'&&path.dirname(file)===directory){
   const sync=handle.sync;handle.sync=async function(){
    const gate=Promise.withResolvers(),finished=Promise.withResolvers();syncGates.push({name,gate,finished});syncing++;maxSyncing=Math.max(maxSyncing,syncing);
    if(syncGates.length===4){reverse=(async()=>{for(const item of [...syncGates].reverse()){item.gate.resolve();await item.finished.promise;}})();reverse.then(reverseDone.resolve,reverseDone.reject);}
    try{await gate.promise;await sync.call(this);syncCompleted.push(name);}finally{syncing--;finished.resolve();}
   };
  }
  if(args[0]==='r'&&path.dirname(file)===directory&&file.endsWith('.blob')){
   privacyReads++;privacyCount++;maxPrivacyReads=Math.max(maxPrivacyReads,privacyReads);const close=handle.close;
   handle.close=async function(){try{return await close.call(this);}finally{privacyReads--;}};
   // Hold the first readback until all four syncs finish. Other completed files
   // must wait without opening a second whole-file plaintext reader.
   if(privacyCount===1)await reverseDone.promise;
  }
  if(name==='publication.json'&&args[0]==='wx'&&path.dirname(file)===directory){
   const write=handle.write;handle.write=function(bytes,offset,length,position){if(position>=ENCRYPTION_OVERHEAD)manifestPayloads.add(bytes);return write.call(this,bytes,offset,length,position);};
  }
  return handle;
 });syncBuiltinESMExports();
 const releaseHeld=setTimeout(()=>{for(const item of syncGates)item.gate.resolve();reverseDone.resolve();},15000);
 let saved;try{saved=await withPublicationOutputWriter(workspace,source,job,{directory},async writer=>{
 const retain=writer.retain;writer.retain=function(name,...args){return retaining.run(name,()=>retain.call(this,name,...args));};
 async function* home(){assert.equal(await workspace.catalogue(async store=>catalogueRequiresPublicationDocuments(await catalogueFormat(store.db))),true,'The first content is consumed only after older writers are excluded');yield homeParts[0];await writer.retain('.nojekyll','');for(const part of homeParts.slice(1))yield part;}
 await writer.retain('index.html',home());await writer.addChoice('pages','index.html',{path:'index.html',title:'Home'});
 await writer.retain('pages/'+late+'.html',(async function*(){yield '<!doctype html><title>Late page</title>';})());await writer.addChoice('pages','pages/'+late+'.html',{path:'pages/'+late+'.html',title:'Late page'});
 await writer.retain('pages/'+extra+'.html',(async function*(){yield '<!doctype html><title>Extra \u00c5 \u03bb page</title>';})());await writer.addChoice('pages','pages/'+extra+'.html',{path:'pages/'+extra+'.html',title:'Extra page'});
 await writer.retain('index.html',home());assert.equal(writer.count(),4);
 for(const value of entries)await writer.addChoice('entries',value.id,value);
 for(const value of styles)await writer.addChoice('styles',digest(value.css),value);
 return writer.finish({defaultPage:'index.html'});
 });}finally{clearTimeout(releaseHeld);for(const item of syncGates)item.gate.resolve();await reverse?.catch(()=>{});fixture.workspace.openCatalogue=open;fixture.workspace.withLock=lock;fixture.workspace.writeMetadata=writeMetadata;fileMock.mock.restore();syncBuiltinESMExports();}
 assert.equal(maxSyncing,4);assert.deepEqual(syncCompleted,[...syncGates].reverse().map(item=>item.name));assert.equal(syncing,0);assert.equal(maxPrivacyReads,1);assert.equal(privacyReads,0);assert.equal(privacyCount,4);
 assert.ok(opened<=3,'Output repeatedly opened authenticated connections: '+opened);assert.equal(closed,opened,'Output retained a live connection after completion');
 const batchBytes=batch=>batch.reduce((sum,size)=>sum+size,0);
 assert.ok(batches.filter(batch=>batch.length===512).length>=2,'Tiny nodes must fill multiple durable 512-object batches');
 assert.ok(batches.filter((batch,index)=>index+1<batches.length&&batch.length<512&&batchBytes(batch)+batches[index+1][0]>256*1024).length>=2,'Large Unicode nodes must cross multiple byte checkpoints');
 for(const batch of batches){assert.ok(batch.length<=512);assert.ok(batchBytes(batch)<=256*1024);}
 assert.ok(sqlBatches.some(batch=>batch.rows===32));for(const batch of sqlBatches){assert.ok(batch.rows<=32);assert.ok(batch.bytes<=256*1024);}
 t.diagnostic(JSON.stringify({batches:batches.map(batch=>({objects:batch.length,bytes:batchBytes(batch)}))}));
 const stored={version:3,workspaceId:source.workspaceId,websiteId:null,websitePin:outline.websitePin,jobId:job.id,attempt:job.lease.token,reviewId:digest(job.id),etag:outline.etag,...saved,blockedValues:[]},files=await RetainedPublicationFiles.open(workspace,stored),candidate={...stored,files};
 await workspace.catalogue(()=>verifyPublicationCandidate(candidate));assert.equal(files.size,5);
 const output=await openPublicationOutput(workspace,stored),rows=[];for await(const row of publicationFileRows(workspace,stored))rows.push(row.file);assert.deepEqual(rows.map(row=>row.name),['.nojekyll','index.html','pages/'+late+'.html','pages/'+extra+'.html','publication.json']);assert.deepEqual(rows.slice(0,2).map(row=>row.index),[1,0]);
 assert.equal(await files.has('missing.html'),false);assert.equal(await files.get('missing.html'),undefined);assert.deepEqual(await contentBuffer(await files.get('index.html')),homeBytes);
 assert.equal(manifestPayloads.size,1,'The small streamed manifest must use one payload buffer, not one filesystem write per entry');
 assert.equal([...manifestPayloads][0].length,(await files.get('publication.json')).size);
 const manifest=JSON.parse((await contentBuffer(await files.get('publication.json'))).toString());assert.equal(manifest.releaseId,stored.id);assert.equal(manifest.files.length,4);assert.equal(manifest.files[0].path,'.nojekyll');assert.deepEqual(manifest.files.find(file=>file.path==='index.html'),{path:'index.html',bytes:homeBytes.length,sha256:digest(homeBytes)});
 const page=await releases.pageChoices(candidate,{path:'pages/'+late+'.html',limit:1});assert.equal(page.offset,1);assert.equal(page.items[0].title,'Late page');
 await assert.rejects(RetainedPublicationFiles.open(workspace,{...stored,attempt:randomUUID()}),{code:'JOB_DAMAGED'});
 await assert.rejects(output.window('pages',{cursor:(await output.window('files',{limit:1})).next}),{code:'INVALID'});
 await assert.rejects(withPublicationOutputWriter(workspace,source,job,{directory},writer=>writer.addChoice('pages','collision.html',{})),{code:'PUBLICATION_IDENTITY'});
 assert.match((await contentBuffer(await files.get('index.html'))).toString(),/Retained website/);
 const reopened=publicationWorkspace(new Workspace(fixture.workspace.root,fixture.vault));
 await reopened.catalogue(async()=>{
  const output=await openPublicationOutput(reopened,stored);assert.equal(output.count('entries'),entries.length);assert.equal(output.count('styles'),styles.length);
  for(const value of entries)assert.deepEqual(await output.get('entries',value.id),value);
  for(const value of styles)assert.deepEqual(await output.get('styles',digest(value.css)),value);
  const retained=await RetainedPublicationFiles.open(reopened,stored);assert.deepEqual(await contentBuffer(await retained.get('index.html')),homeBytes);
 });
 // Cancel after an automatic durable batch and a blob exist. The ordinary
 // attempt cleanup must erase both while preserving the completed sibling.
 const interrupted={id:job.id,lease:{token:randomUUID()}},failedDirectory=await releases.directory(job.id,interrupted.lease.token),prefix='.observanda/release-outputs/'+job.id+'/'+interrupted.lease.token,controller=new AbortController(),reason=new Error('Interrupted after durable output');
 await assert.rejects(withPublicationOutputWriter(workspace,source,interrupted,{directory:failedDirectory,signal:controller.signal},async writer=>{
  await writer.retain('index.html','<!doctype html><title>Interrupted output</title>');
  for(const value of entries)await writer.addChoice('entries',value.id,value);
  assert.equal((await workspace.metadataPage(prefix,{limit:1})).items.length,1);assert.equal((await readdir(failedDirectory)).length,1);
  controller.abort(reason);return writer.finish({defaultPage:'index.html'});
 }),error=>error===reason);
 await releases.clean(job.id,{only:interrupted.lease.token});
 assert.deepEqual(await workspace.listMetadata(prefix),[]);assert.deepEqual(await readdir(path.dirname(failedDirectory)),[job.lease.token]);
 assert.deepEqual(await contentBuffer(await files.get('index.html')),homeBytes);
 // Attempt failure must wait for every started durable write before its lease
 // closes and ordinary cleanup removes the attempt. The completed sibling stays.
 for(const phase of ['callback','sync','privacy','cancel']){
  const attempt={id:job.id,lease:{token:randomUUID()}},attemptDirectory=await releases.directory(job.id,attempt.lease.token),attemptPrefix='.observanda/release-outputs/'+job.id+'/'+attempt.lease.token,controller=new AbortController(),reason=new Error('Refused output '+phase),ready=Promise.withResolvers(),gates=[],openFile=filesystem.open;let live=0,settled=false;
  const mock=t.mock.method(filesystem,'open',async function(file,...args){
   const handle=await openFile.call(this,file,...args);if(path.dirname(file)!==attemptDirectory)return handle;
   if(args[0]==='wx'){
    live++;const close=handle.close,sync=handle.sync;let closed=false;
    handle.close=async function(){try{return await close.call(this);}finally{if(!closed){closed=true;live--;}}};
    handle.sync=async function(){const gate=Promise.withResolvers();gates.push(gate);if(gates.length===2)ready.resolve();await gate.promise;return sync.call(this);};
   }return handle;
  });syncBuiltinESMExports();
  let pending;const timeout=setTimeout(()=>{for(const gate of gates)gate.resolve();},10000);
  try{
   pending=withPublicationOutputWriter(workspace,source,attempt,{directory:attemptDirectory,signal:controller.signal,blockedValues:['private-observation-marker']},async writer=>{
    await writer.retain('index.html',(async function*(){yield '<!doctype html><title>'+ (phase==='privacy'?'private-observation-marker':'Safe output')+'</title>';})());
    await writer.retain('second.html',(async function*(){yield '<!doctype html><title>Second safe output</title>';})());
    await writer.addChoice('pages','index.html',{path:'index.html',title:'Home'});if(phase==='callback')throw reason;return writer.finish({defaultPage:'index.html'});
   });pending.then(()=>{settled=true;},()=>{settled=true;});
   await ready.promise;if(phase==='cancel')controller.abort(reason);if(phase==='sync')gates[0].reject(reason);else gates[0].resolve();await turn();assert.equal(settled,false);assert.ok(live>0,'The remaining durable write must still be owned');gates[1].resolve();
   await assert.rejects(pending,error=>phase==='privacy'?error.code==='PRIVACY':error===reason);assert.equal(live,0);assert.ok((await readdir(attemptDirectory)).every(name=>name.endsWith('.blob')),'Failed writes must remove their temporary files');
  }finally{clearTimeout(timeout);for(const gate of gates)gate.resolve();await pending?.catch(()=>{});mock.mock.restore();syncBuiltinESMExports();}
  await releases.clean(job.id,{only:attempt.lease.token});assert.deepEqual(await workspace.listMetadata(attemptPrefix),[]);assert.deepEqual(await readdir(path.dirname(attemptDirectory)),[job.lease.token]);
 }
 assert.deepEqual(await contentBuffer(await files.get('index.html')),homeBytes);
});

test('output finalization bounds durable work and drains failures before releasing callers',async()=>{
 const saved={size:1,sha256:'a'.repeat(64)},signal=new AbortController(),finalization=new PublicationOutputFinalization({signal:signal.signal}),durable=[],privacyGate=Promise.withResolvers(),privacyStarted=Promise.withResolvers(),order=[];let active=0,maximum=0,consumed=0;
 function stage(index){const gate=Promise.withResolvers();durable[index]=gate;return finalization.write(async beforeCommit=>{consumed++;await beforeCommit(saved);await gate.promise;return saved;},async()=>{active++;maximum=Math.max(maximum,active);order.push(index);try{if(index===3){privacyStarted.resolve();await privacyGate.promise;}}finally{active--;}});}
 for(let index=0;index<4;index++)await stage(index);
 let fifthReady=false;const fifth=stage(4).then(()=>{fifthReady=true;});await turn();assert.equal(consumed,5);assert.equal(fifthReady,false);
 durable[3].resolve();await privacyStarted.promise;for(const index of [2,1,0]){durable[index].resolve();await turn();}
 assert.equal(fifthReady,false,'A slot stays occupied until privacy readback completes');privacyGate.resolve();await fifth;durable[4].resolve();await finalization.drain();assert.equal(maximum,1);assert.deepEqual(order,[3,2,1,0,4]);
 for(const phase of ['write','privacy','cancel']){
  const controller=new AbortController(),pending=new PublicationOutputFinalization({signal:controller.signal}),first=Promise.withResolvers(),second=Promise.withResolvers(),reason=new Error('Refused '+phase);let settled=false;
  await pending.write(async beforeCommit=>{await beforeCommit(saved);await first.promise;if(phase==='write')throw reason;return saved;},async()=>{if(phase==='privacy')throw reason;});
  await pending.write(async beforeCommit=>{await beforeCommit(saved);await second.promise;return saved;});
  const drained=pending.drain();drained.then(()=>{settled=true;},()=>{settled=true;});if(phase==='cancel')controller.abort(reason);first.resolve();await turn();assert.equal(settled,false,'Drain must retain the second in-flight finalization');second.resolve();await assert.rejects(drained,error=>error===reason);assert.throws(()=>pending.check(),error=>error===reason);
 }
});

// Admission precedes both content consumption and indexed metadata writes.
// An older file workspace must continue using its supported legacy writer.
test('indexed outputs refuse legacy file storage and cancellation before consuming any content',async()=>{
 const job={id:randomUUID(),lease:{token:randomUUID()}},source={workspaceId:randomUUID(),websiteId:null};
 const workspace={root:path.join(os.tmpdir(),'observanda-output-admission'),storageKind:async()=> 'file',writeMetadata(){assert.fail('Unsupported metadata was written');},requireStorageKey(){assert.fail('Unsupported content was written');}};
 const writer=new PublicationOutputWriter(workspace,source,job,{directory:workspace.root});
 async function* content(){assert.fail('Unsupported content was consumed');yield 'unreachable';}
 await assert.rejects(writer.retain('index.html',content()),{code:'FORMAT'});
 await assert.rejects(writer.addChoice('pages','index.html',{path:'index.html',title:'Home'}),{code:'FORMAT'});
 const controller=new AbortController(),reason=new Error('Cancelled before admission');controller.abort(reason);
 const cancelled=new PublicationOutputWriter({...workspace,storageKind(){assert.fail('Cancelled admission touched storage');}},source,job,{directory:workspace.root,signal:controller.signal});
 await assert.rejects(cancelled.retain('index.html',content()),error=>error===reason);
});
