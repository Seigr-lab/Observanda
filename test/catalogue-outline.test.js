import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {legacyCatalogueFixture} from './legacy-catalogue-fixture.js';
import {WorkspaceReader} from '../src/workspace-reader.js';
import {workspaceReader} from '../src/web/workspace-reader.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {RecordReadingIndex} from '../src/record-reading-index.js';
import {RecordQuery} from '../src/record-query.js';
import {recordBrowse} from '../src/web/record-query.js';
import {recordRevision} from '../src/research.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
async function fixture(t,options){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-legacy-outline-')),f=await legacyCatalogueFixture(directory,options);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,directory,reader:new WorkspaceReader(f.workspace)};
}
test('flat catalogues beyond legacy count and byte budgets open an outline and select only requested originals',async t=>{
 for(const count of [60,1200]){
  const f=await fixture(t,{count}),read=ResearchCatalogue.prototype.read,record=ResearchCatalogue.prototype.record,loaded=[];
  ResearchCatalogue.prototype.read=()=>{throw Error('Complete workspace requested');};
  ResearchCatalogue.prototype.record=function(id,...args){loaded.push(id);return record.call(this,id,...args);};
  try{
   const client=workspaceReader((route,data,options)=>route.endsWith('/start')?f.reader.start(options):f.reader.page(data,options)),outline=await client.read({metadataOnly:true});
   assert.equal(outline.outline,true);assert.equal(outline.total,count);assert.deepEqual(Object.values(outline.notebookCounts),[count/2,count/2]);assert.deepEqual(loaded,[]);
   if(count>1000)await assert.rejects(client.read(),{code:'WORKSPACE_READ_LIMIT'});
   const missing=randomUUID(),ids=[f.records.at(-1).id,f.records[0].id,missing],result=await f.reader.selection({workspaceId:f.book.id,ids});
   assert.deepEqual(result.book.entries.map(r=>r.id),ids.slice(0,2));assert.deepEqual(result.recordScope.missing,[missing]);assert.deepEqual(loaded,ids.slice(0,2));
   assert.equal(result.recordScope.total,count);assert.equal(result.book.entries[0].body,f.records.at(-1).body);
   assert.equal((await f.workspace.outline()).etag,f.etag);
  }finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;}
 }
});
test('flat pages remain pinned, resume after interruption and preserve order across later writes and backup',async t=>{
 const f=await fixture(t,{count:46}),start=await f.reader.start(),command={workspaceId:f.book.id,cursor:start.cursor};
 const first=await f.reader.page(command);assert.equal(first.records.length,20);assert.deepEqual(first.records.map(r=>r.record.id),f.records.slice(0,20).map(r=>r.id));
 const selected=await f.reader.selection({workspaceId:f.book.id,ids:[f.records[0].id]}),original=selected.book.entries[0];
 await f.service.save({workspaceId:f.book.id,changes:[{id:original.id,expectedRevision:recordRevision(original),record:{...original,title:'Edited after first page'}}]},{recordIds:[original.id]});
 let interrupt=true,failed,requests=[];
 const client=workspaceReader(async(route,data,options)=>{
  if(route.endsWith('/start'))return start;
  requests.push(data.cursor);
  if(interrupt&&requests.length===2){interrupt=false;failed=data.cursor;throw Error('Interrupted page');}
  return f.reader.page(data,options);
 });
 await assert.rejects(client.read(),/Interrupted page/);const complete=await client.read();assert.equal(requests[2],failed);
 assert.deepEqual(complete.book.entries.map(r=>r.id),f.records.map(r=>r.id));assert.equal(complete.book.entries[0].title,original.title);
 assert.equal((await f.reader.selection({workspaceId:f.book.id,ids:[original.id]})).book.entries[0].title,'Edited after first page');
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'copy')),{vault:f.vault}),reader=new WorkspaceReader(new Workspace(copy,f.vault));
 const restored=await reader.page(command);assert.deepEqual({...restored,nextCursor:null},{...first,nextCursor:null});
 assert.equal((await reader.start({workspaceId:f.book.id,snapshotId:f.etag})).total,46);
});
for(const kind of ['flat','indexed'])test(kind+' missing ownership resolves bounded originals, scopes every record and stays readable after editing',async t=>{
 const f=await fixture(t,{kind,missingOwners:true}),read=ResearchCatalogue.prototype.read;
 ResearchCatalogue.prototype.read=()=>{throw Error('Complete workspace requested');};
 try{
  const start=await f.reader.start();assert.deepEqual(Object.values(start.notebookCounts),[30,30]);
  const query={projectId:null,notebookId:f.book.notebooks[1].id,filter:'all',search:'',browse:recordBrowse({sort:'title'})};
  const first=await new RecordQuery(f.workspace).list({workspaceId:f.book.id,query,limit:20});assert.equal(first.total,30);
  const second=await new RecordQuery(f.workspace).list({workspaceId:f.book.id,query,limit:20,cursor:first.nextCursor});assert.equal(second.records.length,10);
  assert.deepEqual([...first.records,...second.records].map(r=>r.id),f.records.filter((r,i)=>i%2).map(r=>r.id));
  const reading=await f.workspace.catalogue(async store=>Array.fromAsync(new RecordReadingIndex(store).rows(await store.snapshot(),new Set([query.notebookId]),{order:'position'})));
  assert.deepEqual(reading.map(row=>row.position),Array.from({length:30},(_,i)=>i*2+1));
  const next=await f.workspace.catalogue(async store=>Array.fromAsync(new RecordReadingIndex(store).rows(await store.snapshot(),new Set([query.notebookId]),{order:'position',after:reading[19]})));
  assert.deepEqual(next.map(row=>row.id),reading.slice(20).map(row=>row.id));
  const selected=await f.reader.selection({workspaceId:f.book.id,ids:[f.records.at(-1).id]}),original=selected.book.entries[0];
  await f.service.save({workspaceId:f.book.id,changes:[{id:original.id,expectedRevision:recordRevision(original),record:{...original,title:'Changed older owner'}}]},{recordIds:[original.id]});
  const after=await f.reader.start();assert.deepEqual(after.notebookCounts,start.notebookCounts);assert.notEqual(after.etag,start.etag);
  const pinned=await f.reader.selection({workspaceId:f.book.id,ids:[original.id],snapshotId:f.etag});assert.equal(pinned.book.entries[0].title,original.title);
  assert.deepEqual((await f.workspace.catalogue(store=>store.recordOutline())).notebookCounts,start.notebookCounts);
 }finally{ResearchCatalogue.prototype.read=read;}
});
test('legacy cursors reject tampering, invalid positions, source changes and cancelled requests',async t=>{
 const f=await fixture(t),other=await fixture(t,{count:2}),start=await f.reader.start(),command={workspaceId:f.book.id,cursor:start.cursor};
 const bytes=Buffer.from(command.cursor,'base64url');bytes[20]^=1;
 await assert.rejects(f.reader.page({...command,cursor:bytes.toString('base64url')}),{code:'WORKSPACE_READ_CURSOR'});
 await assert.rejects(other.reader.page(command),{code:'WORKSPACE_READ_CURSOR'});
 await assert.rejects(f.reader.start({signal:AbortSignal.abort()}),{name:'AbortError'});
 await assert.rejects(f.reader.page(command,{signal:AbortSignal.abort()}),{name:'AbortError'});
 for(const patch of [{version:1},{after:2,offset:1},{offset:61,after:60},{bytes:1e9}]){
  const cursor=await f.workspace.catalogue(store=>{const value=store.decode('workspace-page',f.book.id,Buffer.from(command.cursor,'base64url'));return store.encode('workspace-page',f.book.id,{...value,...patch}).toString('base64url');});
  await assert.rejects(f.reader.page({...command,cursor}),{code:'WORKSPACE_READ_CURSOR'});
 }
 const original=ResearchCatalogue.prototype.record,controller=new AbortController();let loaded=0;
 ResearchCatalogue.prototype.record=async function(...args){const result=await original.apply(this,args);loaded++;controller.abort();return result;};
 try{await assert.rejects(f.reader.page(command,{signal:controller.signal}),{name:'AbortError'});assert.equal(loaded,1);}
 finally{ResearchCatalogue.prototype.record=original;}
 assert.equal((await f.reader.page(command)).records.length,20);
});
test('declared ownership with a missing authenticated index entry is rejected, never repaired by a fallback',async t=>{
 const f=await fixture(t,{kind:'indexed',missingOwners:true});
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const source=await store.snapshot(),index=new SnapshotIndex(store),row=await store.member(source,f.records[0].id);
  source.membership=await index.change(source.membership,'book:'+row.notebookId+':'+row.id,null);await index.flush(source.membership);
  await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',f.etag,source),f.etag);
 }));
 await assert.rejects(f.reader.start(),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(f.reader.selection({workspaceId:f.book.id,ids:[f.records[0].id]}),{code:'CATALOGUE_DAMAGED'});
});
