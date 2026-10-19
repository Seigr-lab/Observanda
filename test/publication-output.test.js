import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,realpath,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {withPublicationCapture} from '../src/publication-capture.js';
import {Workspace} from '../src/storage.js';
import {PublicationOutputWriter,withPublicationOutputWriter,openPublicationOutput,publicationOutputChunks} from '../src/publication-output.js';
import {RetainedPublicationFiles,verifyPublicationCandidate} from '../src/retained-publication-files.js';
import {publicationFileRows} from '../src/publication-files.js';
import {contentBuffer} from '../src/file-content.js';
import {digest} from '../src/storage-format.js';
import {publicationWorkspace} from '../src/publication-pin.js';
import {catalogueFormat,catalogueRequiresPublicationDocuments} from '../src/catalogue-format.js';

test('HTML byte coalescing preserves Unicode fragment bytes with bounded write chunks',async()=>{
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

test('HTML byte coalescing forwards cancellation and closes the source between bounded writes',async()=>{
 const controller=new AbortController(),reason=new Error('Cancel HTML output');let closed=false,consumed=0;
 async function* fragments(){try{for(let i=0;i<20000;i++){consumed++;yield '<span>\u00c5 \u{1f41d}</span>';}}finally{closed=true;}}
 const chunks=publicationOutputChunks(fragments(),{signal:controller.signal}),first=await chunks.next();assert.equal(first.value.length,64*1024);const before=consumed;
 controller.abort(reason);await assert.rejects(chunks.next(),error=>error===reason);assert.equal(consumed,before);assert.equal(closed,true);
 async function* untouched(){assert.fail('An already cancelled stream was consumed');yield '';}
 await assert.rejects(publicationOutputChunks(untouched(),{signal:controller.signal}).next(),error=>error===reason);
});

test('output inventory binds nested retained blobs, selected choices and the exact streamed public manifest',{timeout:120000},async t=>{
 const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-output-')),book=sampleNotebook(),fixture=await encryptedFixture(root,book);
 t.after(async()=>{clearVault(fixture.vault);assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('observanda-output-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=publicationWorkspace(fixture.workspace),outline=await workspace.currentOutline(),releases=new PublicationJobs(workspace);
 const source=await withPublicationCapture(workspace,async(captured,id,finish)=>{const retained=await releases.pin({etag:outline.etag,websitePin:outline.websitePin},{workspace:captured,id});return finish(()=>retained);}),job={id:source.id,lease:{token:randomUUID()}},directory=await releases.directory(job.id,job.lease.token);
 const entries=Array.from({length:200},(_,index)=>({id:randomUUID(),title:'Selected \u00c5 \u03bb \u{1f41d} '+index})),styles=Array.from({length:4},(_,index)=>({kind:'blocks',css:Array.from({length:3000},(_,row)=>'.rule-'+index+'-'+row+'{--caption:"\u00c5 \u03bb \u8702 '+row+'";}').join('\n')}));
 const homeParts=['<!doctype html><title>Home</title>','<main>Retained website<p>',...Array(5000).fill('\u00c5ngstr\u00f6m \u{1f41d} \u6f22\u5b57 '),'</p></main>'],homeBytes=Buffer.concat(homeParts.map(part=>Buffer.from(part)));
 const late=randomUUID(),open=fixture.workspace.openCatalogue,lock=fixture.workspace.withLock,writeMetadata=fixture.workspace.writeMetadata,batches=[],sqlBatches=[];let opened=0,closed=0,active;
 fixture.workspace.openCatalogue=async function(options){const db=await open.call(this,options),close=db.close,run=db.run;opened++;db.close=async function(){try{return await close.call(this);}finally{closed++;}};db.run=function(sql,...values){if(sql.startsWith('INSERT INTO objects '))sqlBatches.push({rows:values.length/2,bytes:values.filter((_,index)=>index%2===1).reduce((sum,value)=>sum+value.length,0)});return run.call(this,sql,...values);};return db;};
 fixture.workspace.withLock=function(operation,options){return lock.call(this,async(...args)=>{active=[];try{return await operation(...args);}finally{if(active.length)batches.push(active);active=null;}},options);};
 fixture.workspace.writeMetadata=function(file,text){if(active&&file.includes('/release-outputs/'))active.push(Buffer.byteLength(text));return writeMetadata.call(this,file,text);};
 let saved;try{saved=await withPublicationOutputWriter(workspace,source,job,{directory},async writer=>{
 async function* home(){assert.equal(await workspace.catalogue(async store=>catalogueRequiresPublicationDocuments(await catalogueFormat(store.db))),true,'The first content is consumed only after older writers are excluded');yield homeParts[0];await writer.retain('.nojekyll','');for(const part of homeParts.slice(1))yield part;}
 await writer.retain('index.html',home());await writer.addChoice('pages','index.html',{path:'index.html',title:'Home'});
 await writer.retain('pages/'+late+'.html','<!doctype html><title>Late page</title>');await writer.addChoice('pages','pages/'+late+'.html',{path:'pages/'+late+'.html',title:'Late page'});
 await writer.retain('index.html',home());assert.equal(writer.count(),3);
 for(const value of entries)await writer.addChoice('entries',value.id,value);
 for(const value of styles)await writer.addChoice('styles',digest(value.css),value);
 return writer.finish({defaultPage:'index.html'});
 });}finally{fixture.workspace.openCatalogue=open;fixture.workspace.withLock=lock;fixture.workspace.writeMetadata=writeMetadata;}
 assert.ok(opened<=3,'Output repeatedly opened authenticated connections: '+opened);assert.equal(closed,opened,'Output retained a live connection after completion');
 const batchBytes=batch=>batch.reduce((sum,size)=>sum+size,0);
 assert.ok(batches.filter(batch=>batch.length===128).length>=2,'Tiny nodes must fill multiple durable 128-object batches');
 assert.ok(batches.filter((batch,index)=>index+1<batches.length&&batch.length<128&&batchBytes(batch)+batches[index+1][0]>256*1024).length>=2,'Large Unicode nodes must cross multiple byte checkpoints');
 for(const batch of batches){assert.ok(batch.length<=128);assert.ok(batchBytes(batch)<=256*1024);}
 assert.ok(sqlBatches.some(batch=>batch.rows===32));for(const batch of sqlBatches){assert.ok(batch.rows<=32);assert.ok(batch.bytes<=256*1024);}
 t.diagnostic(JSON.stringify({batches:batches.map(batch=>({objects:batch.length,bytes:batchBytes(batch)}))}));
 const stored={version:3,workspaceId:source.workspaceId,websiteId:null,websitePin:outline.websitePin,jobId:job.id,attempt:job.lease.token,reviewId:digest(job.id),etag:outline.etag,...saved,blockedValues:[]},files=await RetainedPublicationFiles.open(workspace,stored),candidate={...stored,files};
 await workspace.catalogue(()=>verifyPublicationCandidate(candidate));assert.equal(files.size,4);
 const output=await openPublicationOutput(workspace,stored),rows=[];for await(const row of publicationFileRows(workspace,stored))rows.push(row.file);assert.deepEqual(rows.map(row=>row.name),['.nojekyll','index.html','pages/'+late+'.html','publication.json']);assert.deepEqual(rows.slice(0,2).map(row=>row.index),[1,0]);
 assert.equal(await files.has('missing.html'),false);assert.equal(await files.get('missing.html'),undefined);assert.deepEqual(await contentBuffer(await files.get('index.html')),homeBytes);
 const manifest=JSON.parse((await contentBuffer(await files.get('publication.json'))).toString());assert.equal(manifest.releaseId,stored.id);assert.equal(manifest.files.length,3);assert.equal(manifest.files[0].path,'.nojekyll');assert.deepEqual(manifest.files.find(file=>file.path==='index.html'),{path:'index.html',bytes:homeBytes.length,sha256:digest(homeBytes)});
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
