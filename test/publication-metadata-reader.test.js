import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {projectDomainHandoff} from '../src/project-domain-lock.js';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {createNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {WebsiteSites} from '../src/website-sites.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {withPublicationMetadataReader} from '../src/publication-metadata-reader.js';

async function fixture(t){
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-publication-reader-')),f=await encryptedFixture(directory,createNotebook('Scoped publication reader'));
 t.after(async()=>{clearVault(f.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-publication-reader-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 return f;
}
function observe(t,workspace){
 const connections=[],caches=new Map(),admissions={count:0},open=workspace.openCatalogue,create=workspace.catalogueStore,admit=workspace.requireStorageKey;
 t.mock.method(workspace,'requireStorageKey',async function(...args){admissions.count++;return admit.apply(this,args);});
 t.mock.method(workspace,'openCatalogue',async function(...args){
  const db=await open.apply(this,args),entry={db,closed:0},close=db.close;connections.push(entry);
  db.close=async function(){try{return await close.call(this);}finally{entry.closed++;}};return db;
 });
 t.mock.method(workspace,'catalogueStore',function(db,options){if(options?.readCache)caches.set(db,options.readCache);return create.call(this,db,options);});
 return {connections,caches,admissions};
}
function closed(entry,cache){assert.equal(entry.closed,1);assert.equal(cache.rows.size,0);assert.equal(cache.nodes.size,0);assert.equal(cache.proofs.size,0);assert.equal(cache.bytes,0);assert.equal(cache.nodeBytes,0);}

test('base and named-site metadata reuse one fixed reader while current output writes remain visible',{timeout:90000},async t=>{
 const {workspace}=await fixture(t),outline=await workspace.outline(),site=await new WebsiteSites(workspace).change({workspaceId:outline.metadata.id,etag:outline.etag,operation:'create',name:'Independent publication'}),named=websiteWorkspace(workspace,site.id),file='.observanda/release-inputs/'+randomUUID()+'/'+randomUUID()+'.json';
 await workspace.withLock(async()=>{await workspace.writeMetadata(file,'base original');await named.writeMetadata(file,'named original');});
 const observed=observe(t,workspace);
 for(const [owner,label] of [[workspace,'base'],[named,'named']]){
  const before=observed.connections.length;let escaped,entry,cache,contender;
  try{
  const result=await withPublicationMetadataReader(owner,async reader=>{
   escaped=reader;entry=observed.connections.at(-1);cache=observed.caches.get(entry.db);assert.ok(cache);
   assert.equal(reader.root,owner.root);assert.equal(reader.websiteId,owner.websiteId);
   assert.equal(await reader.readMetadata(file,100),label+' original');const admissions=observed.admissions.count;
   for(let index=0;index<80;index++)assert.equal(await reader.readMetadata(file,100),label+' original');
   assert.equal(observed.admissions.count,admissions,'Fixed metadata reads repeated filesystem admission');
   assert.equal(observed.connections.length,before+1,'Repeated source reads opened extra catalogue connections');
   contender=await workspace.openCatalogue();await contender.run('BEGIN');
   await assert.rejects(projectDomainHandoff(contender),{code:'LOCKED'},'A fixed reader must exclude physical owner handoff');
   assert.ok(cache.rows.size<=cache.maxRows);assert.ok(cache.bytes<=cache.maxBytes);assert.ok(cache.nodes.size<=cache.maxRows);assert.ok(cache.nodeBytes<=cache.maxBytes);
   await owner.withLock(()=>owner.writeMetadata(file,label+' updated'));
   assert.equal(await reader.readMetadata(file,100),label+' original');assert.equal(await owner.readMetadata(file,100),label+' updated');
   const output='.observanda/release-outputs/'+randomUUID()+'/'+randomUUID()+'/metadata.json';
   await reader.withLock(()=>reader.writeMetadata(output,'new output'));
   assert.equal(await owner.readMetadata(output,100),'new output','Original output reads leaked into the source snapshot');
   assert.equal(await reader.readMetadata(output,100),null,'The immutable reader advanced to a later write');
   await assert.rejects(owner.withLock(()=>reader.readMetadata(file,100)),{code:'LOCKED'});
   return label;
  });
  assert.equal(result,label);closed(entry,cache);await assert.rejects(escaped.readMetadata(file,100),{code:'INVALID'});
  await projectDomainHandoff(contender);await contender.run('ROLLBACK');
  }finally{await contender?.close();}
 }
 assert.equal(await workspace.readMetadata(file,100),'base updated');assert.equal(await named.readMetadata(file,100),'named updated');
});

test('reader cancellation and callback failure close the connection, clear caches and expire escaped reads',{timeout:90000},async t=>{
 const {workspace}=await fixture(t),file='.observanda/release-inputs/'+randomUUID()+'/'+randomUUID()+'.json';await workspace.withLock(()=>workspace.writeMetadata(file,'retained'));
 const observed=observe(t,workspace),aborted=new AbortController();aborted.abort();let consumed=false;
 await assert.rejects(withPublicationMetadataReader(workspace,()=>{consumed=true;},{signal:aborted.signal}),{name:'AbortError'});assert.equal(consumed,false);assert.equal(observed.connections.length,0);
 for(const mode of ['failure','cancel-after-read','cancel-during-read']){
  const controller=new AbortController(),failure=Error('Deliberate reader failure');let reader,entry,cache,intercept;
  if(mode==='cancel-during-read'){
   const read=workspace.readMetadata;intercept=t.mock.method(workspace,'readMetadata',async function(...args){const value=await read.apply(this,args);controller.abort();return value;});
  }
  try{await assert.rejects(withPublicationMetadataReader(workspace,async proxy=>{
   reader=proxy;entry=observed.connections.at(-1);cache=observed.caches.get(entry.db);assert.ok(cache);
   assert.equal(await proxy.readMetadata(file,100),'retained');
   if(mode==='failure')throw failure;controller.abort();return 'Must not commit';
  },{signal:controller.signal}),error=>mode==='failure'?error===failure:error.name==='AbortError');}
  finally{intercept?.mock.restore();}
  closed(entry,cache);await assert.rejects(reader.readMetadata(file,100),{code:'INVALID'});
 }
});

test('fixed readers reject live owner changes and drain accepted reads before releasing their snapshot',{timeout:90000},async t=>{
 const {workspace}=await fixture(t),file='.observanda/release-inputs/'+randomUUID()+'/'+randomUUID()+'.json';await workspace.withLock(()=>workspace.writeMetadata(file,'retained'));
 const observed=observe(t,workspace);
 for(const mode of ['clear-key','replace-key','project','root']){
  const vault=workspace.vault,key=Buffer.from(vault.key),root=workspace.root,projectId=workspace.projectId;let entry,cache;
  try{
   await assert.rejects(withPublicationMetadataReader(workspace,async reader=>{
    entry=observed.connections.at(-1);cache=observed.caches.get(entry.db);assert.equal(await reader.readMetadata(file,100),'retained');
    if(mode==='clear-key')clearVault(vault);
    else if(mode==='replace-key')vault.key=Buffer.alloc(32,91);
    else if(mode==='project')workspace.projectId=randomUUID();
    else workspace.root=root+'-changed';
    return reader.readMetadata(file,100);
   }),{code:mode==='clear-key'?'ACCESS_LOCKED':mode==='replace-key'?'ACCESS_DENIED':'DATABASE_LOCATION'});
  }finally{vault.key?.fill(0);vault.key=Buffer.from(key);key.fill(0);workspace.root=root;if(projectId===undefined)delete workspace.projectId;else workspace.projectId=projectId;}
  closed(entry,cache);
 }
 for(const mode of ['complete','failure','cancel']){
  const controller=new AbortController(),failure=Error('Failure while selected read is active');let release,entered,entry,cache,escaped,pending,settled=false;
  const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;}),read=workspace.readMetadata;
  const intercept=t.mock.method(workspace,'readMetadata',async function(...args){entered();await gate;return read.apply(this,args);});
  try{
   const scope=withPublicationMetadataReader(workspace,reader=>{
    escaped=reader;entry=observed.connections.at(-1);cache=observed.caches.get(entry.db);
    pending=reader.readMetadata(file,100);pending.catch(()=>{});
    if(mode==='failure')throw failure;return 'finished';
   },{signal:controller.signal});
   const outcome=scope.then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
   await started;await nextTurn();assert.equal(settled,false);assert.equal(entry.closed,0,'Reader closed before an accepted read settled');
   await assert.rejects(escaped.readMetadata(file,100),{code:'INVALID'},'Closing inspection accepted another read');
   if(mode==='cancel')controller.abort();release();const result=await outcome;
   if(mode==='complete'){assert.equal(result.value,'finished');assert.equal(await pending,'retained');}
   else if(mode==='failure'){assert.equal(result.error,failure);assert.equal(await pending,'retained');}
   else{assert.equal(result.error.name,'AbortError');await assert.rejects(pending,{name:'AbortError'});}
   closed(entry,cache);await assert.rejects(escaped.readMetadata(file,100),{code:'INVALID'});
  }finally{release();intercept.mock.restore();}
 }
 const db=await workspace.openCatalogue();try{
  await db.run('BEGIN');let consumed=false;
  await assert.rejects(workspace.withCatalogueInspection(workspace.catalogueStore(db),()=>{consumed=true;}),{code:'INVALID'});assert.equal(consumed,false);
 }finally{await db.close();}
});

test('legacy file storage receives the original workspace without a catalogue reader',async()=>{
 const workspace={async storageKind(){return 'file';},async openCatalogue(){assert.fail('Legacy storage opened a native reader');}};
 assert.equal(await withPublicationMetadataReader(workspace,value=>{assert.equal(value,workspace);return 'legacy';}),'legacy');
});
