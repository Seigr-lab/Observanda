import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
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
 const connections=[],caches=new Map(),open=workspace.openCatalogue,create=workspace.catalogueStore;
 t.mock.method(workspace,'openCatalogue',async function(...args){
  const db=await open.apply(this,args),entry={db,closed:0},close=db.close;connections.push(entry);
  db.close=async function(){try{return await close.call(this);}finally{entry.closed++;}};return db;
 });
 t.mock.method(workspace,'catalogueStore',function(db,options){if(options?.readCache)caches.set(db,options.readCache);return create.call(this,db,options);});
 return {connections,caches};
}
function closed(entry,cache){assert.equal(entry.closed,1);assert.equal(cache.rows.size,0);assert.equal(cache.nodes.size,0);assert.equal(cache.proofs.size,0);assert.equal(cache.bytes,0);assert.equal(cache.nodeBytes,0);}

test('base and named-site metadata reuse one fixed reader while current output writes remain visible',{timeout:90000},async t=>{
 const {workspace}=await fixture(t),outline=await workspace.outline(),site=await new WebsiteSites(workspace).change({workspaceId:outline.metadata.id,etag:outline.etag,operation:'create',name:'Independent publication'}),named=websiteWorkspace(workspace,site.id),file='.observanda/release-inputs/'+randomUUID()+'/'+randomUUID()+'.json';
 await workspace.withLock(async()=>{await workspace.writeMetadata(file,'base original');await named.writeMetadata(file,'named original');});
 const observed=observe(t,workspace);
 for(const [owner,label] of [[workspace,'base'],[named,'named']]){
  const before=observed.connections.length;let escaped,entry,cache;
  const result=await withPublicationMetadataReader(owner,async reader=>{
   escaped=reader;entry=observed.connections.at(-1);cache=observed.caches.get(entry.db);assert.ok(cache);
   assert.equal(reader.root,owner.root);assert.equal(reader.websiteId,owner.websiteId);
   for(let index=0;index<80;index++)assert.equal(await reader.readMetadata(file,100),label+' original');
   assert.equal(observed.connections.length,before+1,'Repeated source reads opened extra catalogue connections');
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

test('legacy file storage receives the original workspace without a catalogue reader',async()=>{
 const workspace={async storageKind(){return 'file';},async openCatalogue(){assert.fail('Legacy storage opened a native reader');}};
 assert.equal(await withPublicationMetadataReader(workspace,value=>{assert.equal(value,workspace);return 'legacy';}),'legacy');
});
