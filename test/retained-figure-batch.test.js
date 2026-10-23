import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {clearVault} from '../src/encryption.js';
import {RetainedFigureBlocks,retainedFigureBlockPath} from '../src/retained-figure-blocks.js';
import {metadataBatchIndex} from '../src/metadata-batch.js';
import {digest,serialize} from '../src/storage-format.js';

function blockSet(){
 const items=[],entries=[],plotId=randomUUID(),seriesId=randomUUID(),ordinal=value=>String(value).padStart(16,'0');
 const add=(kind,node)=>{const text=serialize(node),revision=digest(text);items.push({kind,node,text,revision,path:retainedFigureBlockPath(kind,revision)});return revision;};
 for(let i=0;i<32;i++){
  const body=add('value',{type:'inline',value:{x:i,y:i+0.5,error:null}}),revision=add('value',{type:'inline',value:{format:'figure-member',version:1,collection:'points',id:randomUUID(),plotId,seriesId,position:i,ordinal:i,body,texts:{}}});entries.push({id:ordinal(i),revision});
 }
 const children=[];for(let at=0;at<entries.length;at+=16){const page=entries.slice(at,at+16);children.push({hash:add('index',{entries:page}),count:page.length,height:1,first:page[0].id,last:page.at(-1).id});}
 const root={hash:add('index',{children}),count:32,height:2,first:children[0].first,last:children.at(-1).last},revision=add('value',{type:'array',root});return {items,revision};
}

test('figure block batches coalesce authenticated catalogue writes and preserve rollback, collision checks and retry',{timeout:120000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-figure-batch-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider);let vault;
 t.after(async()=>{await provider.close();detach();if(vault)clearVault(vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-figure-batch-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const book=sampleNotebook();book.entries=book.entries.slice(0,1);const fixture=await encryptedFixture(directory,book),workspace=fixture.workspace;vault=fixture.vault;const {items,revision}=blockSet(),rollback=Object.assign(Error('Discard comparison writes'),{code:'SYNTHETIC_ROLLBACK'});
 const head=()=>workspace.catalogue(async store=>serialize(await store.objectIndex().head())),before=await head();
 const measure=async(single,discard)=>{
  const stats={queries:0,indexHeads:0,objectWrites:0},blocks=new RetainedFigureBlocks(workspace,{signal:t.signal});
  const write=workspace.withLock(()=>workspace.catalogue(async store=>{
   const run=store.db.run;store.db.run=async function(sql,...args){stats.queries++;if(sql.startsWith("INSERT INTO state VALUES ('objects',"))stats.indexHeads++;if(sql.startsWith('INSERT INTO objects'))stats.objectWrites++;return run.call(this,sql,...args);};
   try{for(const item of items){assert.equal(await blocks.put(item.kind,item.node),item.revision);if(single)await blocks.flush();}await blocks.flush();assert.equal(blocks.pending.size,0);if(discard)throw rollback;}
   finally{store.db.run=run;}
  }));
  if(discard)await assert.rejects(write,error=>error===rollback);else await write;return stats;
 };
 const individual=await measure(true,true);assert.equal(await head(),before);await workspace.catalogue(async()=>{for(const item of items)assert.equal(await workspace.readMetadata(item.path,65536),null);});
 const batched=await measure(false,false);assert.equal(individual.indexHeads,items.length);assert.equal(batched.indexHeads,Math.ceil(items.length/32));assert.ok(batched.queries<individual.queries/2,JSON.stringify({individual,batched}));assert.ok(batched.objectWrites<individual.objectWrites);
 const reader=new RetainedFigureBlocks(workspace,{readOnly:true,signal:t.signal}),closure=[];await workspace.catalogue(async()=>{for await(const item of reader.closure([revision]))closure.push(item.path);});assert.equal(closure.length,items.length);assert.deepEqual(new Set(closure),new Set(items.map(item=>item.path)));
 t.diagnostic(JSON.stringify({blocks:items.length,individual,batched}));
 // Force real staged SQL rows into the transaction, then fail before publication.
 const pending=new RetainedFigureBlocks(workspace,{write:operation=>workspace.withLock(operation),signal:t.signal});for(let i=0;i<8;i++)await pending.put('value',{type:'inline',value:{rollback:i}});
 const expected=[...pending.pending],pendingBytes=pending.pendingBytes,priorHead=await head(),writeMetadata=workspace.writeMetadata;let writes=0,flushed=0;
 workspace.writeMetadata=async function(relative,text){await writeMetadata.call(this,relative,text);if(++writes===4){await this.catalogue(async store=>{const batch=metadataBatchIndex(store);assert.ok(batch);await batch.flushObjects();flushed=Number((await store.db.get('SELECT count(*) AS count FROM objects WHERE id=ANY($1::text[])',expected.map(([key])=>'metadata:'+key))).count);});throw Object.assign(Error('Synthetic mid-batch disk failure'),{code:'ENOSPC'});}};
 try{await assert.rejects(pending.flush(),{code:'ENOSPC'});}finally{workspace.writeMetadata=writeMetadata;}
 assert.equal(flushed,4);assert.equal(writes,4);assert.equal(await head(),priorHead);assert.deepEqual([...pending.pending],expected);assert.equal(pending.pendingBytes,pendingBytes);
 await workspace.catalogue(async()=>{for(const [key] of expected)assert.equal(await workspace.readMetadata(key,65536),null);});
 await pending.flush();assert.equal(pending.pending.size,0);assert.equal(pending.pendingBytes,0);await workspace.catalogue(async()=>{for(const [key,item] of expected)assert.equal(await workspace.readMetadata(key,65536),item.text);});
 // An authenticated catalogue row at a content address is still checked against
 // that address before an idempotent retry can accept it.
 const collision=new RetainedFigureBlocks(workspace,{write:operation=>workspace.withLock(operation),signal:t.signal}),item=items[0];await collision.put(item.kind,item.node);
 await workspace.withLock(()=>workspace.writeMetadata(item.path,serialize({type:'inline',value:'different authenticated bytes'})));
 await assert.rejects(collision.flush(),{code:'MATERIAL_MISSING'});assert.equal(collision.pending.size,1);
 await workspace.withLock(()=>workspace.writeMetadata(item.path,item.text));await collision.flush();assert.equal(collision.pending.size,0);
 await workspace.catalogue(async store=>{for await(const object of store.verifiedObjects())void object;});
});
